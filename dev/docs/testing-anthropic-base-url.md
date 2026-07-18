# Testando: Anthropic provider com base URL custom (self-hosted /v1/messages)

Guia de teste manual da feature que roteia tráfego `/v1/messages` de um
provider Anthropic para um servidor self-hosted que fala a Anthropic
Messages API nativamente (vLLM >= 0.24, proxies Claude-compatible), em vez
de `api.anthropic.com`. Caso de uso: Claude Code contra modelo local,
mantendo Virtual Keys, budgets e tracing do LangWatch.

Commits: `070a1eae3` (gateway Go), `1a39537d5` (control-plane / materialiser).

## Como funciona (resumo)

```
UI: provider Anthropic + campo "Anthropic Base URL"
  → ModelProvider.customKeys.ANTHROPIC_BASE_URL (Postgres, criptografado)
  → materialiser emite slot.base_url no bundle da VK
  → gateway Go lê cred.Extra["base_url"]
  → deriva provider custom por endpoint (base Anthropic) no Bifrost
  → /v1/messages (sync + streaming SSE) vai pro seu servidor
```

Sem base URL configurada, nada muda: tráfego segue pra `api.anthropic.com`.

## Pré-requisitos

- Stack local rodando: `pnpm dev` em `langwatch/` (sobe app :5560 + gateway :5563)
  — gateway precisa de `LW_GATEWAY_INTERNAL_SECRET`, `LW_GATEWAY_JWT_SECRET`,
  `LW_GATEWAY_BASE_URL` no `.env` (ver bloco "AI GATEWAY" do `.env.example`)
- Menu do gateway visível na UI: `FEATURE_FLAG_FORCE_ENABLE=release_ui_ai_gateway_menu_enabled`
- Um servidor Anthropic-compatible. Ex. vLLM >= 0.24:

```bash
vllm serve Qwen/Qwen3-8B --port 8000
# expõe POST /v1/messages (Anthropic Messages API) além do /v1/chat/completions
```

Smoke test do servidor antes de envolver o LangWatch:

```bash
curl -s http://localhost:8000/v1/messages \
  -H 'content-type: application/json' \
  -d '{"model":"Qwen/Qwen3-8B","max_tokens":32,"messages":[{"role":"user","content":"oi"}]}'
```

Se isso não responder shape Anthropic (`{"type":"message","content":[...]}`),
resolva antes de continuar.

## Passo 1 — Configurar o provider

Settings → Model Providers → Anthropic:

| Campo | Valor |
|---|---|
| Anthropic API Key | a key do seu servidor; se ele roda sem auth, use um placeholder (ex. `none`) — a UI exige key não-vazia; o servidor ignora o header |
| Anthropic Base URL | `http://localhost:8000` |

Sufixo `/v1` na URL é aceito e normalizado (o gateway monta `/v1/messages`
sozinho — `.../v1` não vira `.../v1/v1/...`).

## Passo 2 — Criar Virtual Key

Settings → Virtual Keys → criar VK que resolva esse provider (direto ou via
routing policy). Copie o segredo (`lw_vk_...`).

Nota: bundles de VK têm cache — se o provider foi editado depois da VK
existir e o gateway parecer usar config velha, re-salve o provider ou
aguarde o TTL do cache de auth.

## Passo 3 — curl no gateway

```bash
# sync
curl -s http://localhost:5563/v1/messages \
  -H "x-api-key: lw_vk_SEU_SEGREDO" \
  -H 'content-type: application/json' \
  -d '{"model":"Qwen/Qwen3-8B","max_tokens":64,"messages":[{"role":"user","content":"diga ola"}]}'

# streaming (frames SSE nativos: message_start, content_block_delta, ...)
curl -sN http://localhost:5563/v1/messages \
  -H "x-api-key: lw_vk_SEU_SEGREDO" \
  -H 'content-type: application/json' \
  -d '{"model":"Qwen/Qwen3-8B","max_tokens":64,"stream":true,"messages":[{"role":"user","content":"conte ate 5"}]}'
```

Verificações:
- resposta veio do modelo local (conteúdo/latência denunciam)
- log do vLLM mostra o hit em `/v1/messages`
- `api.anthropic.com` nunca foi tocado (confira que funciona até sem internet)

## Passo 4 — Claude Code contra o gateway

```bash
export ANTHROPIC_BASE_URL=http://localhost:5563
export ANTHROPIC_API_KEY=lw_vk_SEU_SEGREDO
claude
```

O gateway aceita a VK via `Authorization: Bearer`, `x-api-key` ou
`x-goog-api-key`.

## Passo 5 — Verificar o lado LangWatch

- Tracing: requests aparecem no projeto da VK
- Budget/usage: tokens contabilizados (usage vem do `message_start`/`message_delta` do stream)
- Provider sem base URL continua roteando pra `api.anthropic.com` (regressão)

## Testes automatizados

```bash
# gateway Go — inclui e2e in-process com servidor fake
cd services/aigateway && go test ./adapters/providers/

# materialiser — precisa de docker (testcontainers) + postgres dev na 5432
# (make quickstart migration) + goose no PATH (go install github.com/pressly/goose/v3/cmd/goose@latest)
cd langwatch && DATABASE_URL="postgresql://prisma:prisma@localhost:5432/mydb?schema=mydb" \
  pnpm test:integration src/server/gateway/__tests__/config.materialiser.integration.test.ts
```

Specs: `specs/ai-gateway/custom-provider-base-url.feature` (seção Anthropic).

## Troubleshooting

| Sintoma | Causa provável |
|---|---|
| Request foi pra `api.anthropic.com` | `ANTHROPIC_BASE_URL` não salvo no provider, ou bundle da VK em cache — re-salve o provider |
| 404 no servidor local | URL configurada com path extra; deixe só `http://host:porta` (com ou sem `/v1`) |
| Erro de key no dispatch | Servidor exige auth e a key configurada não bate; ou UI com placeholder e servidor validando key de verdade |
| `no keys found for provider` | Key da credential vazia chegando no gateway sem o flag keyless — cheque se o provider foi salvo depois dos commits acima |
| Stream corta no primeiro chunk | Cliente esperando shape OpenAI; `/v1/messages` emite frames Anthropic nativos — use SDK/cliente Anthropic |
