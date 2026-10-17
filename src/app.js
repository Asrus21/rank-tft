// Rotas da API do Rank TFT. Recebe banco e Riot prontos (criarApp), para os
// testes trocarem os dois por versões falsas.
//
// Rotas (as mesmas do servidor antigo na Vercel):
//   GET  /api/tft/health
//   POST /api/tft/register       nick#tag → registra e devolve o ID
//   POST /api/tft/puuid          nick#tag → só consulta (também grava a conta)
//   POST /api/tft/preview        prévia do texto do comando
//   GET  /api/tft/cmd/:id        comando do bot (texto puro)
//   GET  /cmd/tft/:id            o mesmo, caminho antigo
//   GET  /api/tft/cmd?player=    comando por nome: "!rank Nome#Tag"
import { Hono } from "hono";
import { cors } from "hono/cors";
import { REGION_ROUTING, mapValToRiot } from "./riot.js";
import { MODOS, applyTemplate, limparMsg, porFila, templatePadrao } from "./template.js";

export const SITE = "elorank-games.com.br/rank-tft";

export function criarApp({ banco, riot }) {
  const app = new Hono();

  app.use("/api/*", cors());

  // Garante as tabelas antes de qualquer rota que usa o banco.
  app.use("*", async (c, next) => {
    if (c.req.path === "/api/tft/health") return next();
    await banco.garantirSchema();
    return next();
  });

  // Nome/tag atuais + ranks de TFT. Atualiza o nome salvo se o jogador trocou.
  async function dadosDoJogador(player) {
    const routing = REGION_ROUTING[player.region];
    if (!routing) throw new Error("invalid region");

    let conta;
    try {
      conta = await riot.contaPorPuuid(routing.regional, player.riot_puuid);
    } catch {
      conta = { gameName: player.game_name, tagLine: player.tag_line }; // tolerante: usa o salvo
    }
    if (conta.gameName !== player.game_name || conta.tagLine !== player.tag_line) {
      await banco.atualizarJogador(player.custom_uuid, { gameName: conta.gameName, tagLine: conta.tagLine });
      player = { ...player, game_name: conta.gameName, tag_line: conta.tagLine };
    }

    let entradas = [];
    try {
      entradas = await riot.ligaTft(player.region, player.riot_puuid);
    } catch {
      entradas = [];
    }

    await banco.vincularContaRiot({
      riotPuuid: player.riot_puuid,
      gameName: player.game_name,
      tagLine: player.tag_line,
      riotRegion: player.region,
    });

    return { player, ranks: porFila(entradas) };
  }

  async function lerCorpo(c) {
    try {
      return (await c.req.json()) || {};
    } catch {
      return {};
    }
  }

  function validarBusca({ gameName, tagLine, region }) {
    if (!gameName || !tagLine || !region) return "gameName, tagLine e region são obrigatórios";
    if (!REGION_ROUTING[region]) return "região inválida";
    return null;
  }

  const naoEncontrado = "Jogador não encontrado. Verifique o nick, a tag e a região.";

  function textoPuro(c, texto, status = 200) {
    c.header("Content-Type", "text/plain; charset=utf-8");
    c.header("Cache-Control", "no-store");
    return c.body(texto, status);
  }

  app.get("/api/tft/health", (c) => c.json({ ok: true, service: "rank-tft", time: new Date().toISOString() }));

  app.post("/api/tft/register", async (c) => {
    const { gameName, tagLine, region } = await lerCorpo(c);
    const invalido = validarBusca({ gameName, tagLine, region });
    if (invalido) return c.json({ error: invalido }, 400);

    try {
      let conta;
      try {
        conta = await riot.contaPorRiotId(REGION_ROUTING[region].regional, gameName, tagLine);
      } catch (err) {
        if (err.status === 404) return c.json({ error: naoEncontrado }, 404);
        throw err;
      }

      // ID compartilhado (vale para os 3 jogos).
      const accountId = await banco.vincularContaRiot({
        riotPuuid: conta.puuid,
        gameName: conta.gameName,
        tagLine: conta.tagLine,
        riotRegion: region,
      });

      const existente = await banco.jogadorPorPuuid(conta.puuid);
      if (existente) {
        await banco.atualizarJogador(existente.custom_uuid, { gameName: conta.gameName, tagLine: conta.tagLine, region });
        return c.json({
          account_id: accountId,
          custom_uuid: existente.custom_uuid,
          riot_puuid: existente.riot_puuid,
          game_name: conta.gameName,
          tag_line: conta.tagLine,
          region,
          is_new: false,
        });
      }

      const customUuid = crypto.randomUUID();
      await banco.inserirJogador({ customUuid, puuid: conta.puuid, gameName: conta.gameName, tagLine: conta.tagLine, region });
      return c.json({
        account_id: accountId,
        custom_uuid: customUuid,
        riot_puuid: conta.puuid,
        game_name: conta.gameName,
        tag_line: conta.tagLine,
        region,
        is_new: true,
      });
    } catch (err) {
      console.error("[register]", err.status, err.corpo || err.message);
      return c.json({ error: "Erro ao registrar jogador", detail: err.message }, 500);
    }
  });

  app.post("/api/tft/puuid", async (c) => {
    const { gameName, tagLine, region } = await lerCorpo(c);
    const invalido = validarBusca({ gameName, tagLine, region });
    if (invalido) return c.json({ error: invalido }, 400);

    try {
      let conta;
      try {
        conta = await riot.contaPorRiotId(REGION_ROUTING[region].regional, gameName, tagLine);
      } catch (err) {
        if (err.status === 404) return c.json({ error: naoEncontrado }, 404);
        throw err;
      }
      const accountId = await banco.vincularContaRiot({
        riotPuuid: conta.puuid,
        gameName: conta.gameName,
        tagLine: conta.tagLine,
        riotRegion: region,
      });
      return c.json({ account_id: accountId, riot_puuid: conta.puuid, game_name: conta.gameName, tag_line: conta.tagLine, region });
    } catch (err) {
      console.error("[puuid]", err.status, err.corpo || err.message);
      return c.json({ error: "Erro ao buscar PUUID", detail: err.message }, 500);
    }
  });

  app.post("/api/tft/preview", async (c) => {
    const { riot_puuid, msg, mode, lang } = await lerCorpo(c);
    if (!riot_puuid) return c.json({ error: "riot_puuid obrigatório" }, 400);

    try {
      const modo = MODOS.includes(mode) ? mode : "tft";
      const idioma = lang === "en" ? "en" : "pt";
      const template = (msg && String(msg).trim()) || templatePadrao(idioma);

      const jogador = await banco.jogadorPorPuuid(riot_puuid);
      if (!jogador) {
        return c.json({ error: "PUUID ainda não está vinculado. Use a busca por Nick + Tag para registrar primeiro." }, 404);
      }
      const { player, ranks } = await dadosDoJogador(jogador);
      return c.json({ result: applyTemplate(template, player, ranks, modo, idioma), game_mode: modo, template, lang: idioma });
    } catch (err) {
      console.error("[preview]", err.status, err.corpo || err.message);
      return c.json({ error: "Erro ao gerar preview", detail: err.message }, 500);
    }
  });

  // Comando consumido pelo bot ($(customapi ...)). O :id é o account_id (mesmo
  // ID nos 3 jogos) ou, por compatibilidade, o puuid real. Se a conta veio do
  // LoL/Valorant, resolve o puuid do TFT e grava a linha local.
  async function comandoPorId(c) {
    const id = c.req.param("id");
    const idioma = c.req.query("lang") === "en" ? "en" : "pt";
    const modo = MODOS.includes(c.req.query("mode")) ? c.req.query("mode") : "tft";
    const template = limparMsg(c.req.query("msg")).trim() || templatePadrao(idioma);

    try {
      let jogador = await banco.jogadorPorPuuid(id);

      if (!jogador) {
        const acc = await banco.contaCompartilhada(id);
        if (acc) {
          const region = (c.req.query("region") || acc.riot_region || mapValToRiot(acc.val_region) || "").toLowerCase();
          let riotPuuid = acc.riot_puuid;
          // Conta veio só do Valorant: resolve o puuid oficial agora.
          if (!riotPuuid && acc.game_name && acc.tag_line && REGION_ROUTING[region]) {
            try {
              const a = await riot.contaPorRiotId(REGION_ROUTING[region].regional, acc.game_name, acc.tag_line);
              riotPuuid = a.puuid;
              await banco.vincularContaRiot({ riotPuuid, gameName: a.gameName, tagLine: a.tagLine, riotRegion: region });
            } catch {
              /* tratado abaixo */
            }
          }
          if (!riotPuuid || !REGION_ROUTING[region]) {
            return textoPuro(
              c,
              idioma === "pt"
                ? "Conta conhecida em outro jogo. Informe a região do TFT: ?region=br1"
                : "Account known from another game. Add the TFT region: ?region=br1",
              400
            );
          }
          await banco.inserirJogador({
            customUuid: crypto.randomUUID(),
            puuid: riotPuuid,
            gameName: acc.game_name || "",
            tagLine: acc.tag_line || "",
            region,
          });
          jogador = await banco.jogadorPorPuuid(riotPuuid);
        }
      }

      if (!jogador) {
        return textoPuro(c, idioma === "pt" ? `ID não registrado em ${SITE}` : `ID not registered at ${SITE}`, 404);
      }

      const { player, ranks } = await dadosDoJogador(jogador);
      return textoPuro(c, applyTemplate(template, player, ranks, modo, idioma));
    } catch (err) {
      console.error("[cmd]", err.status, err.corpo || err.message);
      return textoPuro(c, "Erro interno", 500);
    }
  }

  // "!rank Nome#Tag": o espectador passa o nick, o streamer fixa a região.
  async function comandoPorNome(c) {
    const idioma = c.req.query("lang") === "en" ? "en" : "pt";
    const modo = MODOS.includes(c.req.query("mode")) ? c.req.query("mode") : "tft";
    const template = limparMsg(c.req.query("msg")).trim() || templatePadrao(idioma);

    let nick = (c.req.query("nick") || "").trim();
    let tag = (c.req.query("tag") || "").trim();
    const junto = (c.req.query("player") || c.req.query("riot") || "").trim();
    if ((!nick || !tag) && junto.includes("#")) {
      const h = junto.lastIndexOf("#");
      nick = junto.slice(0, h).trim();
      tag = junto.slice(h + 1).trim();
    }
    const region = (c.req.query("region") || "").toLowerCase();

    if (!nick || !tag) return textoPuro(c, idioma === "pt" ? "Use: !rank Nome#Tag" : "Use: !rank Name#Tag");
    if (!REGION_ROUTING[region]) {
      return textoPuro(
        c,
        idioma === "pt" ? "Configure a região do TFT no comando (ex.: &region=br1)" : "Set the TFT region in the command (e.g. &region=br1)"
      );
    }

    try {
      const conta = await riot.contaPorRiotId(REGION_ROUTING[region].regional, nick, tag);
      await banco.vincularContaRiot({ riotPuuid: conta.puuid, gameName: conta.gameName, tagLine: conta.tagLine, riotRegion: region });
      await banco.inserirJogador({
        customUuid: crypto.randomUUID(),
        puuid: conta.puuid,
        gameName: conta.gameName,
        tagLine: conta.tagLine,
        region,
      });
      const jogador = await banco.jogadorPorPuuid(conta.puuid);
      const { player, ranks } = await dadosDoJogador(jogador);
      return textoPuro(c, applyTemplate(template, player, ranks, modo, idioma));
    } catch (err) {
      if (err.status === 404) return textoPuro(c, idioma === "pt" ? "Jogador não encontrado" : "Player not found");
      console.error("[cmd byname]", err.status, err.corpo || err.message);
      return textoPuro(c, idioma === "pt" ? "Erro ao processar o comando" : "Error processing command");
    }
  }

  app.get("/api/tft/cmd", comandoPorNome);
  app.get("/api/tft/cmd/:id", comandoPorId);
  app.get("/cmd/tft/:id", comandoPorId);

  app.notFound((c) => c.text("Não encontrado", 404));
  // Os comandos aparecem direto no chat: erro neles é sempre texto puro.
  app.onError((err, c) => {
    console.error("[erro]", err.message);
    if (c.req.path.includes("/cmd")) return textoPuro(c, "Erro interno", 500);
    return c.json({ error: "Erro interno" }, 500);
  });

  return app;
}
