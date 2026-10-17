// Worker do Rank TFT (elorank-games.com.br/rank-tft).
//
// - Página (public/): servida direto pela Cloudflare (Workers Static Assets).
// - API (/api/tft/*, /cmd/tft/*): src/app.js.
//
// Segredos (Settings → Variables and Secrets): RIOT_API_KEY e DATABASE_URL — a
// MESMA DATABASE_URL (Neon) do LoL e do Valorant, por causa da tabela accounts.
import { neon } from "@neondatabase/serverless";
import { criarApp } from "./app.js";
import { criarBanco } from "./banco.js";
import { criarRiot } from "./riot.js";

let cache = null;

// Monta banco + Riot uma vez por instância (e de novo se os segredos mudarem).
function app(env) {
  const chave = `${env.DATABASE_URL}|${env.RIOT_API_KEY}`;
  if (!cache || cache.chave !== chave) {
    const url = env.DATABASE_URL || env.POSTGRES_URL;
    const sql = url ? neon(url) : null;
    const q = (texto, params = []) => {
      if (!sql) throw new Error("DATABASE_URL não configurada");
      return sql.query(texto, params);
    };
    cache = { chave, app: criarApp({ banco: criarBanco(q), riot: criarRiot(env.RIOT_API_KEY) }) };
  }
  return cache.app;
}

// Caminhos da API; o resto é a página (arquivos de public/).
const API = /^\/(api\/tft|cmd\/tft)(\/|$)/;

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    // Normalmente a Cloudflare já entrega os arquivos de public/ antes de
    // chegar aqui. Mas a chamada pode vir do gateway (Service Binding): aí
    // entregamos a página explicitamente, para não depender desse detalhe.
    if (!API.test(pathname) && env.ASSETS) return env.ASSETS.fetch(request);
    return app(env).fetch(request, env, ctx);
  },
};
