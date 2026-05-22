# Rank TFT — asrus.app

Ferramenta para streamers da Twitch exibirem o próprio rank de **Teamfight Tactics** no chat em tempo real, via comandos customizados do StreamElements.

Acessível em: **https://www.asrus.app/rank-tft**

---

## Diferença para o `rank-lol`

O `rank-tft` segue **a mesma arquitetura**, mas com uma mudança importante na geração de comandos:

- **rank-lol:** o template é salvo no banco, o link `/cmd/UUID/comando` lê de lá.
- **rank-tft:** o template viaja **na própria URL** via query string. Nada é salvo. Cada comando é único.

Formato do comando gerado pelo site:
```
$(customapi https://www.asrus.app/cmd/tft/PUUID?msg=(player) está (rank) com (pontos) pontos)
```

Se o usuário não preencher template e clicar em "Testar comando", é usado o padrão:
- **PT:** `(player) está (rank) com (pontos) pontos`
- **EN:** `(player) is (rank) with (pontos) points`

---

## Funcionalidades

- ✅ Bilíngue **PT/EN** (toggle no canto superior direito)
- ✅ Botão de retorno ao portfólio (`asrus.app/portifolio`) no canto superior esquerdo
- ✅ Busca por **Nick + Tag** (registra e gera o UUID persistente)
- ✅ Busca por **PUUID** (apenas lookup, sem registrar)
- ✅ Três filas TFT suportadas: **Ranqueado**, **Double Up**, **Hyper Roll (Turbo)**
- ✅ Variáveis clicáveis (12 disponíveis)
- ✅ Preview em tempo real estilo chat da Twitch
- ✅ Comando pronto para colar — sem persistência, cada montagem gera nova URL
- ✅ Tradução automática de elos para português
- ✅ PUUID permanente (não muda quando o jogador renomeia)

---

## Arquitetura

```
┌───────────────────────────────────────────┐
│  Vercel — asrus.app                        │
│  • Landing (raiz)                          │
│  • Rewrites:                               │
│      /api/*       → Railway                │
│      /cmd/*       → Railway                │
│      /rank-lol/*  → projeto rank-lol-tft   │
│      /rank-tft/*  → projeto rank-tft       │  ← NOVO
└───────────────────────────────────────────┘
                    ↓
┌───────────────────────────────────────────┐
│  Vercel — rank-tft                         │
│  Frontend estático (index.html)            │
│  Acessível em www.asrus.app/rank-tft       │
└───────────────────────────────────────────┘
                    ↓ fetch /api/* /cmd/*
┌───────────────────────────────────────────┐
│  Railway — lol-tft-rank-production         │
│  Backend Node.js + Express (compartilhado) │
│  • /api/tft/register                       │
│  • /api/tft/puuid                          │
│  • /api/tft/preview                        │
│  • /cmd/tft/:puuid?msg=...                 │
│  • PostgreSQL para persistir players       │
└───────────────────────────────────────────┘
```

> **Backend é compartilhado com o rank-lol** — todas as rotas TFT vivem com prefixo `/api/tft/` e `/cmd/tft/` no mesmo serviço Railway `lol-tft-rank-production`, então não precisa criar novo Railway. Só adicionar os arquivos novos.

---

## Estrutura do repositório

```
.
├── server.js              # Backend Express (cole as rotas tft no server.js do rank-lol)
├── package.json
├── public/
│   └── index.html         # Frontend (Vercel - projeto rank-tft)
├── vercel.json            # Configuração do projeto Vercel rank-tft
├── vercel-asrus-app.json  # Rewrites atualizados do projeto pai asrus.app
└── README.md
```

---

## Endpoints do backend

### `POST /api/tft/register`
Busca por nick+tag, gera (ou recupera) UUID persistente, salva no banco.

```json
// body
{ "gameName": "asrus", "tagLine": "BR1", "region": "br1" }

// 200
{
  "custom_uuid": "...",
  "riot_puuid": "...",
  "game_name": "asrus",
  "tag_line": "BR1",
  "region": "br1",
  "is_new": true
}
```

### `POST /api/tft/puuid`
**Apenas lookup** — não salva no banco. Útil para quem quer só ver o PUUID.

```json
// body
{ "gameName": "asrus", "tagLine": "BR1", "region": "br1" }

// 200
{
  "riot_puuid": "...",
  "game_name": "asrus",
  "tag_line": "BR1",
  "region": "br1"
}
```

### `POST /api/tft/preview`
Renderiza o template no servidor (para a prévia da Twitch no site).

```json
// body
{ "riot_puuid": "...", "msg": "(player) está (rank)", "mode": "tft", "lang": "pt" }

// 200
{ "result": "asrus está Diamante 2", "game_mode": "tft", "template": "...", "lang": "pt" }
```

> ⚠️ Para o `/preview` funcionar o jogador precisa **já estar registrado** (chamou `/register` antes). Se for buscado só via `/puuid`, dá 404 ao tentar testar.

### `GET /cmd/tft/:puuid?msg=...&mode=...&lang=...`
Endpoint consumido pelo StreamElements. Retorna **texto puro** com o template renderizado.

- `msg` (opcional) — template; se vazio, usa o padrão
- `mode` (opcional) — `tft` | `tft_double_up` | `tft_turbo` (default: `tft`)
- `lang` (opcional) — `pt` | `en` (default: `pt`)

---

## Variáveis do template

**Identidade:** `(player)` · `(tag)` · `(region)` · `(modo)`
**Ranqueado:** `(rank)` · `(tier)` · `(divisao)` · `(pontos)`
**Stats:** `(vitorias)` · `(derrotas)` · `(winrate)` · `(jogos)`

Aceita `(var)` e `{var}` — funcionam iguais.

> No TFT, `(vitorias)` representa "top 1" (1º lugar) e `(derrotas)` representa todas as partidas onde não foi top 1 (do 2º ao 8º), pois é como a Riot retorna na API.

---

## Variáveis de ambiente (Railway)

| Variável | Descrição |
|---|---|
| `RIOT_API_KEY` | Personal API Key da Riot (a mesma do `rank-lol` serve para TFT) |
| `DATABASE_URL` | Injetada automaticamente pelo PostgreSQL do Railway |
| `NODE_ENV` | `production` |
| `CORS_ORIGIN` | `https://www.asrus.app,https://asrus.app,https://rank-tft.vercel.app` |
| `PORT` | Injetada automaticamente pelo Railway |

---

## Deploy

### 1. Backend (Railway)
O backend é o **mesmo** já existente em `lol-tft-rank-production`. Você tem duas opções:

**Opção A — Recomendada: integrar no server.js existente do rank-lol**
Cole as rotas do `server.js` deste repositório (todas com prefixo `/api/tft/` e `/cmd/tft/`) dentro do `server.js` atual do rank-lol. Elas compartilham a tabela `players` — mesmo schema, é só garantir que existe.

**Opção B — Subir como serviço separado**
Cria um novo serviço Railway com este `server.js` apontando para outro Postgres. Aí no `vercel-asrus-app.json` o rewrite `/api/tft/*` e `/cmd/tft/*` precisam ser ajustados para o novo domínio Railway.

### 2. Frontend (Vercel)
1. Cria novo projeto no Vercel com nome `rank-tft`
2. Conecta este repositório (ou faz upload manual de `public/index.html` + `vercel.json`)
3. Após o deploy, anota o domínio gerado (`rank-tft.vercel.app` ou similar)
4. Se o domínio for diferente, atualiza no `vercel-asrus-app.json` os rewrites de `/rank-tft` e `/rank-tft/:path*`

### 3. Projeto asrus.app (root)
Substitui o `vercel.json` do projeto root pelo `vercel-asrus-app.json` deste repositório (já contém **todos** os rewrites antigos + os novos do `/rank-tft`).

---

## Disclaimer

asrus.app não é endossado pela Riot Games e não reflete as opiniões da Riot Games ou de quem está envolvido oficialmente com seus produtos. Riot Games e todas as marcas associadas são marcas registradas da Riot Games, Inc.
