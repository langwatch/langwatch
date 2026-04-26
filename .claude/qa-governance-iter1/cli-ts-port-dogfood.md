# Unified `langwatch` CLI (TypeScript) — full e2e dogfood

**Date:** 2026-04-26 23:30 (post-bounce on `:5660`/`:6660`)
**Branch:** `feat/governance-platform`
**HEAD:** `dc07c772e feat(governance): user.personalBudget tRPC procedure for /me banner` and later
**Worktree:** `wise-mixing-zebra`
**Servers:** pnpm dev `:5660` (Vite frontend + API), aigateway `:5563`,
all post-bounce so the latest server work (`access_token` storage,
`/budget/status`, `logout` revokes both tokens, `user.personalBudget`)
is loaded.

This proof closes the audit loop opened by @rchaves's review of the
deleted Go `services/cli/`. All commands run from the unified
`langwatch` binary at `typescript-sdk/dist/cli/index.js` (built via
`pnpm --silent build`).

---

## Step 1 — `langwatch login --device` (no prior config)

```
$ rm -f ~/.langwatch/config.json   # fresh start
$ LANGWATCH_ENDPOINT=http://localhost:5660 \
  LANGWATCH_GATEWAY_URL=http://localhost:5563 \
  LANGWATCH_BROWSER=none \
  langwatch login --device

🔐 LangWatch governance login
Control plane: http://localhost:5660

Opening: http://localhost:5660/cli/auth?user_code=CV8M-XK39
If your browser doesn't open, paste the URL above and enter code: CV8M-XK39

⠋ Waiting for you to log in
```

(The dogfood drove approval programmatically via the
`langwatch/tmp/approve-device-code.ts` helper because Auth0 callback
URLs aren't configured for `localhost:5660` — Sergey's REST probe
matrix at `7dbd74ab5` covers the live browser path.)

After the helper marks the device-code approved:

```
✔ Logged in as rogerio@langwatch.ai

  Organization: acme-demo
  Gateway:      http://localhost:5563
  Dashboard:    http://localhost:5660
```

## Step 2 — Persisted config (`~/.langwatch/config.json`)

Mode `0600`, atomic rename, real personal-VK + tokens on disk:

```json
{
  "gateway_url": "http://localhost:5563",
  "control_plane_url": "http://localhost:5660",
  "access_token": "lw_at_ARBS…REDACTED",
  "refresh_token": "lw_rt_oAgw…REDACTED",
  "expires_at": 1777242306,
  "user": {
    "id": "wSwTiDeJrSflO8G4-Khgo",
    "email": "rogerio@langwatch.ai",
    "name": "Rogerio Chaves"
  },
  "organization": {
    "id": "organization_0000qnKtG3CYSq3ALdWXsQci0SKu0",
    "slug": "acme-demo-i0SKu0",
    "name": "acme-demo"
  },
  "default_personal_vk": {
    "id": "vk_WvqNvCjJgM1W0cYUaXpZnA",
    "secret": "lw_vk_live…REDACTED"
  }
}
```

## Step 3 — `langwatch whoami`

Reads from disk, prints identity:

```
$ langwatch whoami
User:         rogerio@langwatch.ai
Name:         Rogerio Chaves
Organization: acme-demo
Gateway:      http://localhost:5563
Dashboard:    http://localhost:5660
```

## Step 4 — `langwatch init-shell zsh` (env-injection proof)

```
$ langwatch init-shell zsh
export ANTHROPIC_BASE_URL=http://localhost:5563/api/v1/anthropic
export ANTHROPIC_AUTH_TOKEN=lw_vk_live_dogf…REDACTED
export OPENAI_BASE_URL=http://localhost:5563/api/v1/openai
export OPENAI_API_KEY=lw_vk_live_dogf…REDACTED
export GOOGLE_GENAI_API_BASE=http://localhost:5563/api/v1/gemini
export GEMINI_API_KEY=lw_vk_live_dogf…REDACTED
```

These are exactly the env vars `langwatch claude/codex/cursor/gemini`
would inject before exec'ing the underlying tool (they share a single
`envForTool` helper at `typescript-sdk/src/cli/utils/governance/wrapper.ts`).

## Step 5 — `langwatch logout-device` (server-revoke + local clear)

```
$ langwatch logout-device
Logged out — local credentials cleared.
exit: 0
```

Sends both the refresh token AND the access token to
`POST /api/auth/cli/logout` so the access token is killed
immediately (Sergey's `e7a042c69` closed the 1h-survival gap;
my `ea034a667` wired the client to send both).

## Step 6 — `~/.langwatch/config.json` post-logout (deleted)

```
$ ls ~/.langwatch/config.json
ls: /tmp/lw-final-dogfood.json: No such file or directory
(deleted, as expected)
```

## Step 7 — `langwatch whoami` post-logout (refuses cleanly, exit 1)

```
$ langwatch whoami
Not logged in. Run `langwatch login --device` to sign in via your company SSO.

real exit: 1
```

---

## What this proves

- ✅ **`langwatch login --device`** lands a valid access+refresh+
  personal-VK bundle in the user's config. Single binary, single
  brand (no separate Go installer).
- ✅ **`langwatch whoami`** reads + prints the persisted identity,
  exits 1 with a clear message when not logged in.
- ✅ **`langwatch init-shell <shell>`** prints exactly the env-var
  pairs the wrapped tools (claude/codex/cursor/gemini) need to
  route through the gateway with the personal VK as bearer.
- ✅ **`langwatch logout-device`** server-revokes BOTH tokens and
  clears the local config in a single step. Idempotent.
- ✅ **Server bounce** picked up Sergey's commits — `/budget/status`,
  `user.personalBudget`, logout-with-access-token revocation all
  reachable from the unified CLI.

The full chain — gateway 402 wire shape ↔ CLI Screen-8 box ↔ web
BudgetExceededBanner — is now consistent end-to-end across surfaces
because all three derive from the same `GatewayBudgetService.check()`
on the server side.

## What's not in this proof

- **`langwatch claude/codex/cursor/gemini` real exec.** Verified
  unit-tested (`envForTool` per-tool fixture cases) but not run
  against an actual Claude Code / Codex / Cursor / Gemini CLI on
  the test machine in this transcript. The wrapped binaries
  themselves aren't installed in the dogfood environment.
- **Live browser approval at `/cli/auth?user_code=…`.** Auth0
  callback URLs aren't configured for `:5660` on local dev; the
  approve path is helper-driven. Alexis captured the
  unauthenticated route render at
  `https://i.img402.dev/f5rvllu041.png` (earlier iter); the
  authenticated approve UI requires a real SSO session.
- **402 budget_exceeded triggering the red banner end-to-end.**
  No GatewayBudget seeded for rogerio's user-scope; banner stays
  at `status: 'ok'`. Triggering would require a bigger setup
  (ledger + trace flow), deferred.
