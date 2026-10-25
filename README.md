# Rank TFT — EloRank Games

Rank de **Teamfight Tactics** de qualquer jogador e comando pronto para o chat da
live (StreamElements). Endereço: **https://elorank-games.com.br/rank-tft**

Roda em **Cloudflare Workers**. O gateway do domínio (repositório
`elorank-games`) repassa `/rank-tft` e as APIs `/api/tft/*`, `/cmd/tft/*` e
`api.elorank-games.com.br/tft/*` para este Worker.

## Estrutura

```
src/
  index.js     entrada do Worker (monta banco Neon + Riot com os segredos)
  app.js       rotas da API (Hono)
  banco.js     SQL: tft_players + accounts (compartilhada com LoL e Valorant)
  riot.js      API da Riot (conta e liga de TFT) e regiões
  template.js  monta o texto do comando (funções puras)
public/
  index.html   página (visual do design system EloRank: /ds/elorank.css)
test/          testes (npm test)
wrangler.jsonc configuração do Worker
server.js      servidor ANTIGO (Express na Vercel) — ver "Transição"
```

## Rotas

| Rota | O que faz |
|---|---|
| `GET /api/tft/health` | Saúde do serviço |
| `POST /api/tft/register` | `{ gameName, tagLine, region }` → registra e devolve o ID EloRank (`account_id`) |
| `POST /api/tft/puuid` | Mesmo corpo; só consulta |
| `POST /api/tft/preview` | `{ riot_puuid, msg, mode, lang }` → texto do comando |
| `GET /api/tft/cmd/:id` | Comando do bot (texto puro). `:id` = ID EloRank ou puuid antigo |
| `GET /cmd/tft/:id` | O mesmo, caminho antigo |
| `GET /api/tft/cmd?player=Nome%23Tag&region=br1` | Comando por nome ("!rank Nome#Tag") |

Parâmetros do comando: `msg` (template; aspas externas são removidas), `mode`
(`tft`, `tft_double_up`, `tft_turbo`), `lang` (`pt`, `en`), `region`.

Comando gerado pelo site:
```
$(customapi https://api.elorank-games.com.br/tft/cmd/ID?msg="(player) está (rank) com (pontos) pontos")
```

### Variáveis do template

`(player)` `(tag)` `(region)` `(modo)` · `(rank)` `(tier)` `(divisao)` `(pontos)` ·
`(vitorias)` `(derrotas)` `(winrate)` `(jogos)` — também `{var}`. No TFT,
`(vitorias)` é top 1 e `(derrotas)` é do 2º ao 8º (é como a Riot devolve).

## Endpoints de um comando só

Cada comando do bot chama um endereço que faz uma coisa só (`src/endpoints.js`;
documentação pública em **elorank-games.com.br/docs**).

| Rota | O que faz | Busca em |
|---|---|---|
| `GET /api/tft/elo/nick?player=Nome%23Tag` (ou `/elo/nick/Nome/Tag`) | Elo pelo nick | Riot (sem banco) |
| `GET /api/tft/elo/puuid/:puuid` | Elo pelo PUUID | Riot (sem banco) |
| `GET /api/tft/elo/id/:id` | Elo pelo ID EloRank | 1 leitura da `accounts` + Riot |
| `GET /api/tft/puuid?player=Nome%23Tag` | Só o PUUID | Riot |
| `GET /api/tft/status` | Saúde da API, do banco e da Riot (`?format=text` para o chat) | banco + da Riot |

Parâmetros: `region` (br1 padrão), `msg`, `format=json`, `mode` (tft, tft_double_up, tft_turbo), `lang`. Texto sai sempre
com status 200 (o bot imprime até o erro); respostas boas ficam em cache curto.

```
${customapi https://api.elorank-games.com.br/tft/elo/nick?player=${queryescape ${1:}}&region=br1}
```

## Publicar (Cloudflare)

1. **Workers & Pages → Create → Import a repository** → `Asrus21/rank-tft`.
   O nome do Worker precisa ser **`rank-tft`**. Comando de deploy:
   `npx wrangler deploy`.
2. **Settings → Variables and Secrets** do Worker, como *Secret*:
   - `RIOT_API_KEY` — a mesma chave da Riot de hoje;
   - `DATABASE_URL` — a **mesma** do LoL e do Valorant (Neon), por causa da
     tabela `accounts` compartilhada.
3. Confira no endereço `rank-tft.<sua-conta>.workers.dev/api/tft/health`.
4. No repositório `elorank-games`, ative o binding `RANK_TFT` no
   `wrangler.jsonc`. A partir daí, `elorank-games.com.br/rank-tft` vem deste
   Worker.

## Desenvolvimento

```sh
npm install
npm test                 # rotas e template (banco e Riot falsos)
npm run check            # valida o build do Worker
npx wrangler dev         # local; segredos em .dev.vars (não vai para o git)
```

Para testar o SQL de verdade contra um Postgres descartável:
`TEST_DATABASE_URL=postgres://... npm test` (as tabelas são apagadas).

## Transição

`server.js` + `vercel.json` são o servidor antigo, ainda publicado na Vercel
(`rank-tft.vercel.app`). Os comandos de bot antigos (`api.asrus.app/tft/...`,
`asrus.app/cmd/tft/...`) dependem dele. Quando o `asrus.app` passar a repassar
esses caminhos para o domínio novo, apague `server.js`, `vercel.json` e as
dependências do Express, e desligue o projeto na Vercel.

## Aviso

EloRank Games não é endossado pela Riot Games e não reflete as opiniões da Riot
Games ou de quem está envolvido oficialmente com seus produtos. Riot Games,
Teamfight Tactics e todas as marcas associadas são marcas registradas da Riot
Games, Inc.
