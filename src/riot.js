// Acesso à API da Riot (conta + liga de TFT).

// Platform routing → onde fica a conta no jogo (TFT-LEAGUE-V1)
// Regional routing → onde fica o "account global" (ACCOUNT-V1)
export const REGION_ROUTING = {
  br1: { regional: "americas" },
  na1: { regional: "americas" },
  la1: { regional: "americas" },
  la2: { regional: "americas" },
  euw1: { regional: "europe" },
  eun1: { regional: "europe" },
  tr1: { regional: "europe" },
  ru: { regional: "europe" },
  me1: { regional: "europe" },
  kr: { regional: "asia" },
  jp1: { regional: "asia" },
  tw2: { regional: "sea" },
  sg2: { regional: "sea" },
  vn2: { regional: "sea" },
  oc1: { regional: "sea" },
};

export function mapRiotToVal(region) {
  const m = {
    br1: "br", na1: "na", la1: "latam", la2: "latam",
    euw1: "eu", eun1: "eu", tr1: "eu", ru: "eu", me1: "eu",
    kr: "kr", jp1: "ap", oc1: "ap", ph2: "ap", sg2: "ap", th2: "ap", tw2: "ap", vn2: "ap",
  };
  return m[(region || "").toLowerCase()] || null;
}

export function mapValToRiot(region) {
  const m = { br: "br1", na: "na1", latam: "la1", eu: "euw1", kr: "kr" };
  return m[(region || "").toLowerCase()] || null;
}

// Erro com o status HTTP da Riot (404 = jogador não existe).
export class ErroRiot extends Error {
  constructor(status, corpo) {
    super(`Riot API ${status}`);
    this.status = status;
    this.corpo = corpo;
  }
}

export function criarRiot(apiKey, fetchImpl = fetch) {
  async function get(host, path) {
    const res = await fetchImpl(`https://${host}.api.riotgames.com${path}`, {
      headers: { "X-Riot-Token": apiKey || "" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new ErroRiot(res.status, await res.text().catch(() => ""));
    return res.json();
  }

  return {
    // nome#tag → { puuid, gameName, tagLine }
    contaPorRiotId: (regional, gameName, tagLine) =>
      get(regional, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`),
    // puuid → nome e tag atuais
    contaPorPuuid: (regional, puuid) => get(regional, `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`),
    // TFT-LEAGUE-V1: entradas de todas as filas ranqueadas de TFT
    ligaTft: (platform, puuid) => get(platform, `/tft/league/v1/by-puuid/${encodeURIComponent(puuid)}`),
  };
}
