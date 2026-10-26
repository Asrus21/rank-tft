import { test } from "node:test";
import assert from "node:assert/strict";
import { criarApp } from "../src/app.js";
import { ErroRiot } from "../src/riot.js";
import { applyTemplate, limparMsg, porFila, templatePadrao } from "../src/template.js";

// ---------- Falsos ----------

function bancoFalso() {
  const jogadores = new Map(); // puuid -> linha tft_players
  const contas = new Map(); // account_id -> linha accounts
  let seq = 0;
  return {
    jogadores,
    contas,
    async garantirSchema() {},
    async jogadorPorPuuid(p) {
      return jogadores.get(p) || null;
    },
    async inserirJogador({ customUuid, puuid, gameName, tagLine, region }) {
      if (!jogadores.has(puuid)) jogadores.set(puuid, { custom_uuid: customUuid, riot_puuid: puuid, game_name: gameName, tag_line: tagLine, region });
    },
    async atualizarJogador(uuid, { gameName, tagLine, region }) {
      for (const j of jogadores.values()) {
        if (j.custom_uuid === uuid) Object.assign(j, { game_name: gameName, tag_line: tagLine }, region ? { region } : {});
      }
    },
    async contaCompartilhada(id) {
      return contas.get(id) || [...contas.values()].find((a) => a.riot_puuid === id || a.val_puuid === id) || null;
    },
    async vincularContaRiot({ riotPuuid, gameName, tagLine, riotRegion }) {
      const acc = [...contas.values()].find((a) => a.riot_puuid === riotPuuid);
      if (acc) return acc.account_id;
      const id = `acc-${++seq}`;
      contas.set(id, { account_id: id, game_name: gameName, tag_line: tagLine, riot_puuid: riotPuuid, riot_region: riotRegion });
      return id;
    },
  };
}

const LIGA = [
  { queueType: "RANKED_TFT", tier: "DIAMOND", rank: "II", leaguePoints: 64, wins: 10, losses: 30 },
  { queueType: "RANKED_TFT_TURBO", ratedTier: "PURPLE", ratedRating: 3200, wins: 5, losses: 5 },
];

function riotFalso({ contas = { "asrus#BR1": { puuid: "P1", gameName: "asrus", tagLine: "BR1" } } } = {}) {
  const chamadas = [];
  return {
    chamadas,
    async contaPorRiotId(regional, nome, tag) {
      chamadas.push(["riotid", regional, nome, tag]);
      const c = contas[`${nome}#${tag}`];
      if (!c) throw new ErroRiot(404, "");
      return c;
    },
    async contaPorPuuid(regional, puuid) {
      const c = Object.values(contas).find((x) => x.puuid === puuid);
      if (!c) throw new ErroRiot(404, "");
      return c;
    },
    async ligaTft() {
      return LIGA;
    },
  };
}

const post = (app, url, corpo) =>
  app.request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });

// ---------- Template ----------

test("template padrão e variáveis (pt)", () => {
  const player = { game_name: "asrus", tag_line: "BR1", region: "br1", custom_uuid: "u1" };
  const texto = applyTemplate(templatePadrao("pt"), player, porFila(LIGA), "tft", "pt");
  assert.equal(texto, "asrus está Diamante 2 com 64 pontos");
  assert.equal(applyTemplate("{winrate} em (jogos) — (modo)", player, porFila(LIGA), "tft", "pt"), "25% em 40 — TFT Ranqueado");
});

test("Hyper Roll usa a cor e o rating; sem rank vira 'Sem rank'", () => {
  const player = { game_name: "a", tag_line: "b", region: "br1", custom_uuid: "u" };
  assert.equal(applyTemplate("(rank) (pontos)", player, porFila(LIGA), "tft_turbo", "pt"), "Roxo 3200");
  assert.equal(applyTemplate("(rank)", player, porFila(LIGA), "tft_double_up", "pt"), "Sem rank");
  assert.equal(applyTemplate("(rank)", player, porFila(LIGA), "tft_double_up", "en"), "Unranked");
});

test("Mestre+ não mostra divisão; msg com aspas é limpa", () => {
  const player = { game_name: "a", tag_line: "b", region: "br1", custom_uuid: "u" };
  const ranks = porFila([{ queueType: "RANKED_TFT", tier: "MASTER", rank: "I", leaguePoints: 212, wins: 1, losses: 1 }]);
  assert.equal(applyTemplate("(rank)", player, ranks, "tft", "pt"), "Mestre");
  assert.equal(limparMsg('"oi (player)"'), "oi (player)");
});

// ---------- Rotas ----------

test("health responde sem tocar no banco", async () => {
  const app = criarApp({ banco: { garantirSchema: () => Promise.reject(new Error("sem banco")) }, riot: riotFalso() });
  const res = await app.request("/api/tft/health");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).service, "rank-tft");
});

test("register: valida, registra novo e reconhece quem já existe", async () => {
  const banco = bancoFalso();
  const app = criarApp({ banco, riot: riotFalso() });

  assert.equal((await post(app, "/api/tft/register", { gameName: "asrus" })).status, 400);
  assert.equal((await post(app, "/api/tft/register", { gameName: "a", tagLine: "b", region: "xx" })).status, 400);
  const nao = await post(app, "/api/tft/register", { gameName: "ninguem", tagLine: "BR1", region: "br1" });
  assert.equal(nao.status, 404);

  const r1 = await (await post(app, "/api/tft/register", { gameName: "asrus", tagLine: "BR1", region: "br1" })).json();
  assert.equal(r1.is_new, true);
  assert.equal(r1.account_id, "acc-1");
  assert.equal(r1.riot_puuid, "P1");

  const r2 = await (await post(app, "/api/tft/register", { gameName: "asrus", tagLine: "BR1", region: "br1" })).json();
  assert.equal(r2.is_new, false);
  assert.equal(r2.custom_uuid, r1.custom_uuid);
});

test("preview usa o template e exige jogador registrado", async () => {
  const banco = bancoFalso();
  const app = criarApp({ banco, riot: riotFalso() });
  assert.equal((await post(app, "/api/tft/preview", { riot_puuid: "P1" })).status, 404);
  await post(app, "/api/tft/register", { gameName: "asrus", tagLine: "BR1", region: "br1" });
  const r = await (await post(app, "/api/tft/preview", { riot_puuid: "P1", msg: "(player): (rank)", mode: "tft" })).json();
  assert.equal(r.result, "asrus: Diamante 2");
});

test("comando por ID: account_id, puuid antigo, caminho legado e ID desconhecido", async () => {
  const banco = bancoFalso();
  const app = criarApp({ banco, riot: riotFalso() });
  await post(app, "/api/tft/register", { gameName: "asrus", tagLine: "BR1", region: "br1" });

  const porConta = await app.request('/api/tft/cmd/acc-1?msg="(player) (rank)"');
  assert.equal(porConta.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(await porConta.text(), "asrus Diamante 2");

  assert.equal(await (await app.request("/cmd/tft/P1?mode=tft_turbo&msg=(rank)")).text(), "Roxo");
  assert.equal(await (await app.request("/api/tft/cmd/P1?lang=en")).text(), "asrus is Diamond 2 with 64 points");

  const nao = await app.request("/api/tft/cmd/xyz");
  assert.equal(nao.status, 404);
  assert.equal(await nao.text(), "ID não registrado em elorank-games.com.br/rank-tft");
});

test("comando por ID de conta vinda do Valorant resolve o puuid do TFT", async () => {
  const banco = bancoFalso();
  banco.contas.set("acc-val", { account_id: "acc-val", game_name: "asrus", tag_line: "BR1", val_puuid: "V1", val_region: "br" });
  const app = criarApp({ banco, riot: riotFalso() });
  assert.equal(await (await app.request("/api/tft/cmd/acc-val?msg=(player) (rank)")).text(), "asrus Diamante 2");
  assert.ok(banco.jogadores.has("P1"));
});

test("comando por nome", async () => {
  const app = criarApp({ banco: bancoFalso(), riot: riotFalso() });
  assert.equal(await (await app.request("/api/tft/cmd")).text(), "Use: !rank Nome#Tag");
  assert.equal(await (await app.request("/api/tft/cmd?player=asrus%23BR1")).text(), "Configure a região do TFT no comando (ex.: &region=br1)");
  assert.equal(await (await app.request("/api/tft/cmd?player=asrus%23BR1&region=br1")).text(), "asrus está Diamante 2 com 64 pontos");
  assert.equal(await (await app.request("/api/tft/cmd?player=x%23y&region=br1")).text(), "Jogador não encontrado");
});

test("+ na msg vira espaço e %2B vira +, como no servidor antigo", async () => {
  const banco = bancoFalso();
  const app = criarApp({ banco, riot: riotFalso() });
  await post(app, "/api/tft/register", { gameName: "asrus", tagLine: "BR1", region: "br1" });
  assert.equal(await (await app.request("/api/tft/cmd/acc-1?msg=(rank)+%2B1")).text(), "Diamante 2 +1");
});

test("banco fora do ar: comando responde texto puro, API responde JSON", async () => {
  const app = criarApp({ banco: { garantirSchema: () => Promise.reject(new Error("sem banco")) }, riot: riotFalso() });
  const cmd = await app.request("/api/tft/cmd/abc");
  assert.equal(cmd.status, 500);
  assert.equal(cmd.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(await cmd.text(), "Erro interno");
  const api = await post(app, "/api/tft/register", { gameName: "a", tagLine: "b", region: "br1" });
  assert.equal(api.status, 500);
  assert.equal((await api.json()).error, "Erro interno");
});
