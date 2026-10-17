// Testa o SQL de verdade (src/banco.js) contra um Postgres. Só roda com
// TEST_DATABASE_URL apontando para um banco DESCARTÁVEL — as tabelas são
// apagadas no começo. Ex.:
//   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { criarApp } from "../src/app.js";
import { criarBanco } from "../src/banco.js";
import { ErroRiot } from "../src/riot.js";

const URL_TESTE = process.env.TEST_DATABASE_URL;
const pular = !URL_TESTE && "defina TEST_DATABASE_URL para testar o SQL";

let pool;
let q;

before(async () => {
  if (pular) return;
  pool = new pg.Pool({ connectionString: URL_TESTE });
  q = (texto, params = []) => pool.query(texto, params).then((r) => r.rows);
  await q("DROP TABLE IF EXISTS tft_players, accounts");
});
after(async () => pool?.end());

const riot = {
  async contaPorRiotId(_r, nome, tag) {
    if (`${nome}#${tag}`.toLowerCase() !== "asrus#br1") throw new ErroRiot(404, "");
    return { puuid: "P1", gameName: "asrus", tagLine: "BR1" };
  },
  async contaPorPuuid() {
    return { puuid: "P1", gameName: "asrus2", tagLine: "BR1" }; // trocou de nome
  },
  async ligaTft() {
    return [{ queueType: "RANKED_TFT", tier: "GOLD", rank: "IV", leaguePoints: 10, wins: 1, losses: 3 }];
  },
};

const post = (app, url, corpo) =>
  app.request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });

test("fluxo completo com o SQL real", { skip: pular }, async () => {
  const banco = criarBanco(q);
  const app = criarApp({ banco, riot });

  // schema idempotente
  await banco.garantirSchema();
  await criarBanco(q).garantirSchema();

  const r1 = await (await post(app, "/api/tft/register", { gameName: "asrus", tagLine: "BR1", region: "br1" })).json();
  assert.equal(r1.is_new, true);
  const r2 = await (await post(app, "/api/tft/register", { gameName: "ASRUS", tagLine: "br1", region: "br1" })).json();
  assert.equal(r2.is_new, false);
  assert.equal(r2.account_id, r1.account_id);

  // comando pelo account_id: busca o nome atual e grava a troca
  assert.equal(await (await app.request(`/api/tft/cmd/${r1.account_id}`)).text(), "asrus2 está Ouro 4 com 10 pontos");
  assert.equal((await q("SELECT game_name FROM tft_players WHERE riot_puuid='P1'"))[0].game_name, "asrus2");
  assert.equal((await q("SELECT game_name FROM accounts WHERE account_id=$1", [r1.account_id]))[0].game_name, "asrus2");

  // conta que só existia no Valorant ganha a linha do TFT
  await q("INSERT INTO accounts (account_id, game_name, tag_line, val_puuid, val_region) VALUES ('val-1','asrus','BR1','V1','br')");
  await q("DELETE FROM tft_players");
  await q("UPDATE accounts SET riot_puuid = NULL WHERE account_id = $1", [r1.account_id]);
  assert.equal(await (await app.request("/api/tft/cmd/val-1?msg=(rank)")).text(), "Ouro 4");
  assert.equal((await q("SELECT count(*)::int AS n FROM tft_players"))[0].n, 1);

  // comando por nome não duplica a linha
  assert.equal(await (await app.request("/api/tft/cmd?player=asrus%23BR1&region=br1&msg=(rank)")).text(), "Ouro 4");
  assert.equal((await q("SELECT count(*)::int AS n FROM tft_players"))[0].n, 1);
});
