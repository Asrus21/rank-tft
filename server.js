require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const RIOT_API_KEY = process.env.RIOT_API_KEY;

// ============================================
// POSTGRES
// ============================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ============================================
// REGIÕES (TFT usa as mesmas que LoL)
// ============================================
// Platform routing → onde fica a conta no jogo (TFT-LEAGUE-V1)
// Regional routing → onde fica o "account global" (ACCOUNT-V1)
const REGION_ROUTING = {
  br1:  { regional: 'americas' },
  na1:  { regional: 'americas' },
  la1:  { regional: 'americas' },
  la2:  { regional: 'americas' },
  euw1: { regional: 'europe' },
  eun1: { regional: 'europe' },
  tr1:  { regional: 'europe' },
  ru:   { regional: 'europe' },
  me1:  { regional: 'europe' },
  kr:   { regional: 'asia' },
  jp1:  { regional: 'asia' },
  tw2:  { regional: 'sea' },
  sg2:  { regional: 'sea' },
  vn2:  { regional: 'sea' },
  oc1:  { regional: 'sea' }
};

// ============================================
// TRADUÇÃO DE TIERS (PT-BR)
// ============================================
const TIER_PT = {
  'IRON': 'Ferro',
  'BRONZE': 'Bronze',
  'SILVER': 'Prata',
  'GOLD': 'Ouro',
  'PLATINUM': 'Platina',
  'EMERALD': 'Esmeralda',
  'DIAMOND': 'Diamante',
  'MASTER': 'Mestre',
  'GRANDMASTER': 'Grão-Mestre',
  'CHALLENGER': 'Desafiante',
  // TFT Hyper Roll (Turbo) usa tiers de cor
  'GRAY': 'Cinza',
  'GREEN': 'Verde',
  'BLUE': 'Azul',
  'PURPLE': 'Roxo',
  'ORANGE': 'Laranja'
};

const DIVISION_NUM = { 'I': '1', 'II': '2', 'III': '3', 'IV': '4' };

function traduzirTier(tier, lang = 'pt') {
  if (!tier) return lang === 'pt' ? 'Sem rank' : 'Unranked';
  if (lang === 'en') return tier;
  return TIER_PT[tier.toUpperCase()] || tier;
}

function traduzirDivisao(div) {
  if (!div) return '';
  return DIVISION_NUM[div] || div;
}

// ============================================
// MIDDLEWARES
// ============================================
app.use(cors({
  origin: (process.env.CORS_ORIGIN || '*').split(','),
  credentials: false
}));
app.use(express.json());

// ============================================
// DATABASE INIT
// ============================================
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      custom_uuid     TEXT PRIMARY KEY,
      riot_puuid      TEXT UNIQUE NOT NULL,
      game_name       TEXT NOT NULL,
      tag_line        TEXT NOT NULL,
      region          TEXT NOT NULL,
      created_at      TIMESTAMP DEFAULT NOW(),
      updated_at      TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('[db] players table ready');
}

// ============================================
// RIOT API HELPERS
// ============================================
async function riotGet(host, path) {
  const url = `https://${host}.api.riotgames.com${path}`;
  return axios.get(url, {
    headers: { 'X-Riot-Token': RIOT_API_KEY },
    timeout: 8000
  });
}

// Resolve gameName#tagLine → account (puuid + gameName + tagLine)
async function getAccountByRiotId(regional, gameName, tagLine) {
  const r = await riotGet(
    regional,
    `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
  );
  return r.data;
}

// Refresh: dado um puuid, retornar gameName + tagLine atuais
async function getAccountByPuuid(regional, puuid) {
  const r = await riotGet(regional, `/riot/account/v1/accounts/by-puuid/${puuid}`);
  return r.data;
}

// TFT-LEAGUE-V1: entradas de league por puuid (RANKED_TFT, RANKED_TFT_DOUBLE_UP, RANKED_TFT_TURBO)
async function getTftLeagueByPuuid(platform, puuid) {
  const r = await riotGet(platform, `/tft/league/v1/by-puuid/${puuid}`);
  return r.data; // Array de LeagueEntryDTO
}

// ============================================
// FETCH RANK PARA UM JOGADOR (resolve nome atual + TFT ranks)
// ============================================
async function fetchPlayerData(player) {
  const routing = REGION_ROUTING[player.region];
  if (!routing) throw new Error('invalid region');

  // 1. Atualiza gameName + tagLine atuais (caso tenha trocado)
  let account = null;
  try {
    account = await getAccountByPuuid(routing.regional, player.riot_puuid);
  } catch (e) {
    // tolerante: se Riot falhar aqui, usa o que está salvo
    account = { gameName: player.game_name, tagLine: player.tag_line };
  }

  // Se o nome mudou, persiste
  if (account.gameName !== player.game_name || account.tagLine !== player.tag_line) {
    await pool.query(
      `UPDATE players SET game_name=$1, tag_line=$2, updated_at=NOW() WHERE custom_uuid=$3`,
      [account.gameName, account.tagLine, player.custom_uuid]
    );
    player.game_name = account.gameName;
    player.tag_line = account.tagLine;
  }

  // 2. Busca entradas de league de TFT por puuid
  let leagueEntries = [];
  try {
    leagueEntries = await getTftLeagueByPuuid(player.region, player.riot_puuid);
  } catch (e) {
    leagueEntries = [];
  }

  // Separa por queueType
  const byQueue = {
    tft: leagueEntries.find(e => e.queueType === 'RANKED_TFT') || null,
    tft_double_up: leagueEntries.find(e => e.queueType === 'RANKED_TFT_DOUBLE_UP') || null,
    tft_turbo: leagueEntries.find(e => e.queueType === 'RANKED_TFT_TURBO') || null
  };

  return { player, ranks: byQueue };
}

// ============================================
// APLICAR TEMPLATE
// (substitui variáveis no template — tolerante a () e {})
// ============================================
function applyTemplate(template, player, ranks, mode, lang = 'pt') {
  const entry = ranks[mode] || null;

  let tier = '';
  let divisao = '';
  let pontos = 0;
  let vitorias = 0;
  let derrotas = 0;
  let winrate = 0;
  let jogos = 0;
  let rankStr = lang === 'pt' ? 'Sem rank' : 'Unranked';

  if (entry) {
    if (mode === 'tft_turbo') {
      // Hyper Roll: ratedTier (cor) + ratedRating
      tier = traduzirTier(entry.ratedTier, lang);
      pontos = entry.ratedRating || 0;
      vitorias = entry.wins || 0;
      derrotas = entry.losses || 0;
      jogos = vitorias + derrotas;
      winrate = jogos > 0 ? Math.round((vitorias / jogos) * 100) : 0;
      rankStr = tier; // sem divisão no Hyper Roll
    } else {
      tier = traduzirTier(entry.tier, lang);
      divisao = traduzirDivisao(entry.rank);
      pontos = entry.leaguePoints || 0;
      vitorias = entry.wins || 0;   // wins = top 1
      derrotas = entry.losses || 0; // losses = 2º a 8º
      jogos = vitorias + derrotas;
      winrate = jogos > 0 ? Math.round((vitorias / jogos) * 100) : 0;

      // Master, Grandmaster, Challenger não têm divisão visível
      const semDivisao = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes((entry.tier || '').toUpperCase());
      rankStr = semDivisao ? tier : `${tier} ${divisao}`.trim();
    }
  }

  const modoLabel = {
    tft: lang === 'pt' ? 'TFT Ranqueado' : 'Ranked TFT',
    tft_double_up: lang === 'pt' ? 'Double Up' : 'Double Up',
    tft_turbo: 'Hyper Roll'
  }[mode] || mode;

  const vars = {
    player: player.game_name,
    nick: player.game_name,
    tag: player.tag_line,
    region: player.region.toUpperCase(),
    rank: rankStr,
    tier: tier,
    divisao: divisao,
    pontos: String(pontos),
    lp: String(pontos),
    pdl: String(pontos),
    vitorias: String(vitorias),
    derrotas: String(derrotas),
    winrate: `${winrate}%`,
    jogos: String(jogos),
    top1: String(vitorias),
    top4: String(vitorias), // No TFT, wins já representa top1 (1º lugar)
    top4rate: `${winrate}%`,
    modo: modoLabel,
    mode: modoLabel,
    uuid: player.custom_uuid
  };

  // substitui (var) e {var}
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`(${k})`).join(v);
    out = out.split(`{${k}}`).join(v);
  }
  return out;
}

// ============================================
// ROUTES — API
// ============================================

// Saúde do servidor
app.get('/api/tft/health', (req, res) => {
  res.json({ ok: true, service: 'rank-tft', time: new Date().toISOString() });
});

// Registrar jogador via Riot ID (nick + tag + região)
// Body: { gameName, tagLine, region }
// Retorna: { custom_uuid, riot_puuid, game_name, tag_line, region, is_new }
app.post('/api/tft/register', async (req, res) => {
  try {
    const { gameName, tagLine, region } = req.body || {};

    if (!gameName || !tagLine || !region) {
      return res.status(400).json({ error: 'gameName, tagLine e region são obrigatórios' });
    }
    if (!REGION_ROUTING[region]) {
      return res.status(400).json({ error: 'região inválida' });
    }

    const routing = REGION_ROUTING[region];

    // 1. Resolve nick+tag → puuid
    let account;
    try {
      account = await getAccountByRiotId(routing.regional, gameName, tagLine);
    } catch (err) {
      if (err.response?.status === 404) {
        return res.status(404).json({ error: 'Jogador não encontrado. Verifique o nick, a tag e a região.' });
      }
      throw err;
    }

    // 2. Verifica se já existe no banco (pelo puuid)
    const existing = await pool.query('SELECT * FROM players WHERE riot_puuid = $1', [account.puuid]);

    if (existing.rows.length > 0) {
      // Já existe — só atualiza nome+tag+região e devolve
      const player = existing.rows[0];
      await pool.query(
        `UPDATE players SET game_name=$1, tag_line=$2, region=$3, updated_at=NOW() WHERE custom_uuid=$4`,
        [account.gameName, account.tagLine, region, player.custom_uuid]
      );
      return res.json({
        custom_uuid: player.custom_uuid,
        riot_puuid: player.riot_puuid,
        game_name: account.gameName,
        tag_line: account.tagLine,
        region,
        is_new: false
      });
    }

    // 3. Novo jogador
    const custom_uuid = uuidv4();
    await pool.query(
      `INSERT INTO players (custom_uuid, riot_puuid, game_name, tag_line, region)
       VALUES ($1, $2, $3, $4, $5)`,
      [custom_uuid, account.puuid, account.gameName, account.tagLine, region]
    );

    res.json({
      custom_uuid,
      riot_puuid: account.puuid,
      game_name: account.gameName,
      tag_line: account.tagLine,
      region,
      is_new: true
    });
  } catch (err) {
    console.error('[register]', err.response?.status, err.response?.data || err.message);
    res.status(500).json({ error: 'Erro ao registrar jogador', detail: err.message });
  }
});

// Buscar PUUID via nick+tag (sem registrar)
// Body: { gameName, tagLine, region }
// Retorna: { riot_puuid, game_name, tag_line, region }
app.post('/api/tft/puuid', async (req, res) => {
  try {
    const { gameName, tagLine, region } = req.body || {};

    if (!gameName || !tagLine || !region) {
      return res.status(400).json({ error: 'gameName, tagLine e region são obrigatórios' });
    }
    if (!REGION_ROUTING[region]) {
      return res.status(400).json({ error: 'região inválida' });
    }

    const routing = REGION_ROUTING[region];

    try {
      const account = await getAccountByRiotId(routing.regional, gameName, tagLine);
      return res.json({
        riot_puuid: account.puuid,
        game_name: account.gameName,
        tag_line: account.tagLine,
        region
      });
    } catch (err) {
      if (err.response?.status === 404) {
        return res.status(404).json({ error: 'Jogador não encontrado. Verifique o nick, a tag e a região.' });
      }
      throw err;
    }
  } catch (err) {
    console.error('[puuid]', err.response?.status, err.response?.data || err.message);
    res.status(500).json({ error: 'Erro ao buscar PUUID', detail: err.message });
  }
});

// Preview do template — recebe { puuid, msg, mode, lang } e retorna texto
// Body: { riot_puuid, msg, mode (tft|tft_double_up|tft_turbo), lang (pt|en) }
app.post('/api/tft/preview', async (req, res) => {
  try {
    const { riot_puuid, msg, mode, lang } = req.body || {};
    if (!riot_puuid) return res.status(400).json({ error: 'riot_puuid obrigatório' });

    const safeMode = ['tft', 'tft_double_up', 'tft_turbo'].includes(mode) ? mode : 'tft';
    const safeLang = lang === 'en' ? 'en' : 'pt';
    const defaultTpl = safeLang === 'pt'
      ? '(player) está (rank) com (pontos) pontos'
      : '(player) is (rank) with (pontos) points';
    const template = (msg && msg.trim()) || defaultTpl;

    // procura no banco; se não tiver, registra automaticamente para futuras chamadas
    let { rows } = await pool.query('SELECT * FROM players WHERE riot_puuid = $1', [riot_puuid]);
    let player = rows[0];

    if (!player) {
      return res.status(404).json({
        error: 'PUUID ainda não está vinculado. Use a busca por Nick + Tag para registrar primeiro.'
      });
    }

    const { ranks } = await fetchPlayerData(player);
    const result = applyTemplate(template, player, ranks, safeMode, safeLang);

    res.json({
      result,
      game_mode: safeMode,
      template,
      lang: safeLang
    });
  } catch (err) {
    console.error('[preview]', err.response?.status, err.response?.data || err.message);
    res.status(500).json({ error: 'Erro ao gerar preview', detail: err.message });
  }
});

// ============================================
// ROUTE — /cmd (consumida pelo StreamElements)
// ============================================
// Formato:  /cmd/tft/{riot_puuid}?msg=template&mode=tft&lang=pt
// O bot manda essa URL via $(customapi ...) e o servidor responde texto puro.
//
// Se ?msg ausente → usa default "(player) está (rank) com (pontos) pontos"
// Se ?mode ausente → tft
// Se ?lang ausente → pt
app.get('/cmd/tft/:puuid', async (req, res) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Cache-Control', 'no-store');

  try {
    const { puuid } = req.params;
    const rawMsg = req.query.msg ? String(req.query.msg) : '';
    const mode = ['tft', 'tft_double_up', 'tft_turbo'].includes(req.query.mode) ? req.query.mode : 'tft';
    const lang = req.query.lang === 'en' ? 'en' : 'pt';

    const defaultTpl = lang === 'pt'
      ? '(player) está (rank) com (pontos) pontos'
      : '(player) is (rank) with (pontos) points';
    const template = rawMsg.trim() || defaultTpl;

    const { rows } = await pool.query('SELECT * FROM players WHERE riot_puuid = $1', [puuid]);
    if (rows.length === 0) {
      return res.status(404).send(lang === 'pt'
        ? 'PUUID não registrado em asrus.app/rank-tft'
        : 'PUUID not registered at asrus.app/rank-tft');
    }

    const { player, ranks } = await fetchPlayerData(rows[0]);
    const result = applyTemplate(template, player, ranks, mode, lang);
    return res.send(result);
  } catch (err) {
    console.error('[cmd]', err.response?.status, err.response?.data || err.message);
    return res.status(500).send('Erro interno');
  }
});

// ============================================
// START
// ============================================
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[rank-tft] running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('[startup] init db failed', err);
    process.exit(1);
  });
