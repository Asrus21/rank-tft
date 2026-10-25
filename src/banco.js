// Banco Postgres (Neon). `q(texto, params)` devolve as linhas.
//
// Tabelas:
//   tft_players — jogadores do TFT (puuid da Riot, nome e região)
//   accounts    — COMPARTILHADA entre LoL, TFT e Valorant. `account_id` é um ID
//                 gerado do zero (não é o puuid da Riot nem da HenrikDev); é o
//                 ID que vai nas URLs dos comandos dos 3 jogos. Exige a MESMA
//                 DATABASE_URL nos 3 projetos.
import { mapRiotToVal } from "./riot.js";

export function criarBanco(q) {
  let schemaPronto = null;

  async function criarSchema() {
    await q(`
      CREATE TABLE IF NOT EXISTS tft_players (
        custom_uuid     TEXT PRIMARY KEY,
        riot_puuid      TEXT UNIQUE NOT NULL,
        game_name       TEXT NOT NULL,
        tag_line        TEXT NOT NULL,
        region          TEXT NOT NULL,
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW()
      )`);
    await q(`
      CREATE TABLE IF NOT EXISTS accounts (
        account_id  TEXT PRIMARY KEY,
        game_name   TEXT,
        tag_line    TEXT,
        riot_puuid  TEXT,
        riot_region TEXT,
        val_puuid   TEXT,
        val_region  TEXT,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      )`);
    await q(`CREATE INDEX IF NOT EXISTS accounts_riotid ON accounts (LOWER(game_name), LOWER(tag_line))`);
    await q(`CREATE INDEX IF NOT EXISTS accounts_riot_puuid ON accounts (riot_puuid)`);
    await q(`CREATE INDEX IF NOT EXISTS accounts_val_puuid ON accounts (val_puuid)`);
  }

  return {
    // Uma vez por instância do Worker; se falhar, tenta de novo na próxima.
    garantirSchema() {
      if (!schemaPronto) {
        schemaPronto = criarSchema().catch((e) => {
          schemaPronto = null;
          throw e;
        });
      }
      return schemaPronto;
    },

    // Checagem do /api/tft/status.
    ping: () => q("SELECT 1"),

    async jogadorPorPuuid(puuid) {
      const rows = await q("SELECT * FROM tft_players WHERE riot_puuid = $1", [puuid]);
      return rows[0] || null;
    },

    async inserirJogador({ customUuid, puuid, gameName, tagLine, region }) {
      await q(
        `INSERT INTO tft_players (custom_uuid, riot_puuid, game_name, tag_line, region)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (riot_puuid) DO NOTHING`,
        [customUuid, puuid, gameName, tagLine, region]
      );
    },

    async atualizarJogador(customUuid, { gameName, tagLine, region }) {
      if (region) {
        await q(`UPDATE tft_players SET game_name=$1, tag_line=$2, region=$3, updated_at=NOW() WHERE custom_uuid=$4`, [
          gameName, tagLine, region, customUuid,
        ]);
      } else {
        await q(`UPDATE tft_players SET game_name=$1, tag_line=$2, updated_at=NOW() WHERE custom_uuid=$3`, [
          gameName, tagLine, customUuid,
        ]);
      }
    },

    // Aceita o account_id e, por compatibilidade, os puuids reais.
    async contaCompartilhada(id) {
      if (!id) return null;
      try {
        const rows = await q("SELECT * FROM accounts WHERE account_id = $1 OR riot_puuid = $1 OR val_puuid = $1 LIMIT 1", [id]);
        return rows[0] || null;
      } catch (err) {
        console.warn("[accounts] leitura falhou:", err.message);
        return null;
      }
    },

    // Upsert do lado Riot (LoL/TFT). Acha a conta pelo puuid e, se não achar,
    // pelo nome#tag; senão cria com um ID novo. Devolve o account_id.
    async vincularContaRiot({ riotPuuid, gameName, tagLine, riotRegion }) {
      const valRegion = mapRiotToVal(riotRegion);
      try {
        let rows = await q("SELECT * FROM accounts WHERE riot_puuid = $1 LIMIT 1", [riotPuuid]);
        if (rows.length === 0 && gameName && tagLine) {
          rows = await q("SELECT * FROM accounts WHERE LOWER(game_name) = LOWER($1) AND LOWER(tag_line) = LOWER($2) LIMIT 1", [
            gameName, tagLine,
          ]);
        }
        if (rows.length > 0) {
          const acc = rows[0];
          await q(
            `UPDATE accounts SET
               game_name = $1, tag_line = $2, riot_puuid = $3, riot_region = $4,
               val_region = COALESCE(val_region, $5), updated_at = NOW()
             WHERE account_id = $6`,
            [gameName, tagLine, riotPuuid, riotRegion, valRegion, acc.account_id]
          );
          return acc.account_id;
        }
        const accountId = crypto.randomUUID();
        await q(
          `INSERT INTO accounts (account_id, game_name, tag_line, riot_puuid, riot_region, val_region)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [accountId, gameName, tagLine, riotPuuid, riotRegion, valRegion]
        );
        return accountId;
      } catch (err) {
        console.warn("[accounts] upsert (riot) falhou:", err.message);
        return null;
      }
    },
  };
}
