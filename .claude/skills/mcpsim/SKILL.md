---
name: mcpsim
description: "Drive LangWatch's hosted MCP endpoint the way Claude Desktop, Claude Code and Cursor do, with mcpsim: the API key flow and the full OAuth flow (discovery, dynamic client registration, PKCE S256, approval, code exchange, refresh) on /mcp and /sse, through named scenarios (connect, stream, refresh, double-refresh, reconnect, idle, soak) whose every request is recorded with status, latency and pass or fail. Use when someone says 'mcpsim', 'haven sim mcp', 'test the hosted MCP', 'MCP OAuth locally', 'does the MCP session survive a refresh', 'MCP 404 re-initialize', 'MCP proxy drops the stream', 'load the MCP endpoint', or 'MCP console'."
user-invocable: true
---

# mcpsim

Stands in for MCP clients against the hosted MCP endpoint (`<app>/mcp`, and `/sse`, which
now serves the same Streamable HTTP transport). Runs, steps and the OAuth grant live in
memory and are bounded (50 runs, 1000 steps per run, 4096 latency samples): a dev shim,
never expose it. Code: `services/sims/mcpsim`, console `apps/sims/src/mcp`.

## Run it

- Opt-in: `haven up +mcp` (sticky). Runs in the `go` lane by default (see `sims`).
- Console: `https://mcp.<slug>.langwatch.localhost` (`haven sim mcp console`). Setup shows the
  endpoint, key hint, project, callback URL, how auto approval signs in, and the OAuth grant
  (hints only) with **Connect OAuth** and **Forget**. Runs lists every run; one opens with
  its checks, soak counters and every step (kind, flow, transport, method, URL, status, ms).
- Without haven: `make service svc=mcpsim` with `MCPSIM_ENDPOINT`, `MCPSIM_API_KEY`, and for
  OAuth `MCPSIM_PUBLIC_URL` (the sim's own URL; the redirect is `<public>/callback`).

## Flows

- **apikey** (default): `Authorization: Bearer <project key>`; haven passes the seeded key.
- **oauth**: run the connect once (`haven sim mcp oauth`), then any scenario with
  `--flow oauth` uses the grant the sim holds, refreshing on a 401.

The connect does what a real client does: an unauthenticated initialize for the 401 and its
`WWW-Authenticate: Bearer resource_metadata=...`, then
`/.well-known/oauth-protected-resource/mcp`, the authorization server's
`/.well-known/oauth-authorization-server`, `POST /oauth/register` with the sim's callback,
PKCE S256, the `/mcp/authorize` URL, the code exchange at `POST /oauth/token`
(form-encoded), and a first initialize with the new token.

Approval needs a signed-in LangWatch person:

- **interactive**: `haven sim mcp oauth --mode interactive --open` prints (and opens) the
  authorize URL; approve in the browser; the app redirects to the sim's `/callback` and the
  sim finishes the exchange. The run waits up to 10 minutes in state `waiting`.
- **auto**: the sim posts the consent page's own request, `POST /api/mcp/authorize` with
  `{projectId, client_id, redirect_uri, code_challenge, code_challenge_method: "S256", state}`
  and a browser session cookie (`better-auth.session_token=...`), then reads the code off the
  answered `redirect`. The session comes from, in order: `--cookie` (or `MCPSIM_COOKIE`),
  else the sim signs in itself at `POST /api/auth/sign-in/email` with `MCPSIM_SIGNIN_EMAIL` /
  `MCPSIM_SIGNIN_PASSWORD` (local `*.localhost` stacks only). haven sets the stack admin's
  login and `MCPSIM_PROJECT_ID=local-dev-project`, so `haven sim mcp oauth` is automated by
  default. The person must hold a role that may approve MCP for the project (a viewer cannot).

## Scenarios

| Verb             | What it asserts                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connect`        | initialize, notifications/initialized, tools/list, one tool call (`--tool`, default `fetch_langwatch_docs`), DELETE; on /mcp and /sse by default           |
| `stream`         | the GET event stream stays open `--hold <s>` (default 60); reports when a proxy or the server dropped it, and that the session still answers               |
| `refresh`        | oauth: refresh, then the SAME session id answers with the new token (no 401, no re-initialize)                                                             |
| `double-refresh` | oauth: two concurrent refreshes with one refresh token both succeed with the same new pair                                                                 |
| `reconnect`      | an unknown and an ended session id answer 404 (a 401 is reported as a failure: it would force a new sign-in), then re-initialize works with no new sign-in |
| `idle`           | sleep `--idle <s>` (default 30), then the session answers (a 404 re-initializes silently, a 401 refreshes)                                                 |
| `soak`           | `--clients <n>` (default 10, max 500) for `--duration` (default 1m, max 2h), each looping tools/list about once a second; fails on any failed request      |

Every request recovers the way the spec asks: 404 on a session re-initializes without
re-authenticating, 401 refreshes the OAuth token and retries once, 503/502/504 or no answer
backs off (Retry-After up to 5s, else 250ms doubling) up to 3 times. Each attempt is a step,
so the console shows the 404, 401 or 503 and what the client did about it.

## CLI

`haven sim mcp status|list|get <id|latest>|grant|forget|stop <id>|clear|console`, and
`haven sim mcp connect|stream|refresh|double-refresh|reconnect|idle|soak [--flow apikey|oauth]
[--transport /mcp|/sse|both] [--client claude-code|claude-desktop|cursor] [--hold s] [--idle s]
[--clients n] [--duration d] [--tool name] [--target url] [--json]`. Run verbs wait for the
end, print steps and checks, and exit non-zero unless the run passed (`--json` too).
`haven sim mcp oauth [--mode auto|interactive] [--cookie c] [--project id] [--open]`.

## API

`GET /_sim/api/status`, `GET|DELETE /_sim/api/runs`, `POST /_sim/api/runs` (a `RunRequest`;
`wait: true` answers when it ends), `GET|DELETE /_sim/api/runs/{id|latest}`,
`POST /_sim/api/oauth/connect` (a `ConnectRequest`), `GET|DELETE /_sim/api/oauth`,
`GET /callback`. Wire types: `services/sims/mcpsim/api.go`.
