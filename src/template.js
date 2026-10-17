// Monta o texto do comando a partir do rank. Funções puras (sem rede nem
// banco), testadas em test/template.test.js.

const TIER_PT = {
  IRON: "Ferro",
  BRONZE: "Bronze",
  SILVER: "Prata",
  GOLD: "Ouro",
  PLATINUM: "Platina",
  EMERALD: "Esmeralda",
  DIAMOND: "Diamante",
  MASTER: "Mestre",
  GRANDMASTER: "Grão-Mestre",
  CHALLENGER: "Desafiante",
  // TFT Hyper Roll (Turbo) usa tiers de cor
  GRAY: "Cinza",
  GREEN: "Verde",
  BLUE: "Azul",
  PURPLE: "Roxo",
  ORANGE: "Laranja",
};

const DIVISION_NUM = { I: "1", II: "2", III: "3", IV: "4" };

export const MODOS = ["tft", "tft_double_up", "tft_turbo"];

export function traduzirTier(tier, lang = "pt") {
  if (!tier) return lang === "pt" ? "Sem rank" : "Unranked";
  if (lang === "en") return tier;
  return TIER_PT[tier.toUpperCase()] || tier;
}

export function traduzirDivisao(div) {
  if (!div) return "";
  return DIVISION_NUM[div] || div;
}

export function templatePadrao(lang) {
  return lang === "pt" ? "(player) está (rank) com (pontos) pontos" : "(player) is (rank) with (pontos) points";
}

// O site manda msg="texto" (com aspas, para ficar legível no comando).
export function limparMsg(raw) {
  let msg = raw ? String(raw) : "";
  if (msg.length >= 2 && msg.startsWith('"') && msg.endsWith('"')) msg = msg.slice(1, -1);
  return msg;
}

// Separa as entradas da liga por fila.
export function porFila(entradas) {
  const lista = Array.isArray(entradas) ? entradas : [];
  return {
    tft: lista.find((e) => e.queueType === "RANKED_TFT") || null,
    tft_double_up: lista.find((e) => e.queueType === "RANKED_TFT_DOUBLE_UP") || null,
    tft_turbo: lista.find((e) => e.queueType === "RANKED_TFT_TURBO") || null,
  };
}

// Substitui as variáveis do template — aceita (var) e {var}.
export function applyTemplate(template, player, ranks, mode, lang = "pt") {
  const entry = ranks[mode] || null;

  let tier = "";
  let divisao = "";
  let pontos = 0;
  let vitorias = 0;
  let derrotas = 0;
  let winrate = 0;
  let jogos = 0;
  let rankStr = lang === "pt" ? "Sem rank" : "Unranked";

  if (entry) {
    vitorias = entry.wins || 0; // wins = top 1
    derrotas = entry.losses || 0; // losses = 2º a 8º
    jogos = vitorias + derrotas;
    winrate = jogos > 0 ? Math.round((vitorias / jogos) * 100) : 0;

    if (mode === "tft_turbo") {
      // Hyper Roll: ratedTier (cor) + ratedRating, sem divisão
      tier = traduzirTier(entry.ratedTier, lang);
      pontos = entry.ratedRating || 0;
      rankStr = tier;
    } else {
      tier = traduzirTier(entry.tier, lang);
      divisao = traduzirDivisao(entry.rank);
      pontos = entry.leaguePoints || 0;
      // Mestre, Grão-Mestre e Desafiante não têm divisão visível
      const semDivisao = ["MASTER", "GRANDMASTER", "CHALLENGER"].includes((entry.tier || "").toUpperCase());
      rankStr = semDivisao ? tier : `${tier} ${divisao}`.trim();
    }
  }

  const modoLabel =
    {
      tft: lang === "pt" ? "TFT Ranqueado" : "Ranked TFT",
      tft_double_up: "Double Up",
      tft_turbo: "Hyper Roll",
    }[mode] || mode;

  const vars = {
    player: player.game_name,
    nick: player.game_name,
    tag: player.tag_line,
    region: player.region.toUpperCase(),
    rank: rankStr,
    tier,
    divisao,
    pontos: String(pontos),
    lp: String(pontos),
    pdl: String(pontos),
    vitorias: String(vitorias),
    derrotas: String(derrotas),
    winrate: `${winrate}%`,
    jogos: String(jogos),
    top1: String(vitorias),
    top4: String(vitorias), // No TFT, wins já representa top 1
    top4rate: `${winrate}%`,
    modo: modoLabel,
    mode: modoLabel,
    uuid: player.custom_uuid,
  };

  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`(${k})`).join(v);
    out = out.split(`{${k}}`).join(v);
  }
  return out;
}
