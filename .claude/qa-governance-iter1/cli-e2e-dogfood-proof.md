# `langwatch` CLI — full e2e dogfood proof

**Date:** 2026-04-26
**Branch:** `feat/governance-platform`
**Worktree:** `wise-mixing-zebra`
**Servers:** pnpm dev `:5660` (Vite frontend + API), aigateway `:5563`

## ⚠️ POST-AUDIT NOTE — read this first

The original proof below was captured against a **Go CLI at
`services/cli/`** that has since been **deleted in its entirety**.
@rchaves's review correctly flagged it as a duplicate of the
unified `langwatch` CLI that already lives at `typescript-sdk/`.
The wire shape, env-var injection map, exit codes, and Screen-8
budget rendering are unchanged — they're all encoded in
`specs/ai-gateway/governance/*.feature` and ported into
`typescript-sdk/src/cli/commands/{login,whoami,dashboard,
request-increase,wrap,logout-device,init-shell}.ts` plus
`typescript-sdk/src/cli/utils/governance/{device-flow,config,
budget,wrapper}.ts`.

Status of the unified TS CLI port (10/11 subcommands):
| Subcommand | Status |
|---|---|
| `langwatch login --device` | ✅ ported |
| `langwatch whoami` | ✅ ported |
| `langwatch dashboard --trace` | ✅ ported |
| `langwatch request-increase` | ✅ ported |
| `langwatch claude` / `codex` / `cursor` / `gemini` | ✅ ported |
| `langwatch logout-device` | ✅ ported |
| `langwatch init-shell <zsh\|bash\|fish\|cmd\|pwsh>` | ✅ ported |
| `langwatch shell` (spawn subshell) | ⏳ deferred (nice-to-have) |

36 vitest cases passing across the four governance utility modules.
Re-running this dogfood proof against the TS CLI is the next
verification slice — what's below stands as the design proof and
the bug-discovery record.

---

**HEAD at original Go-CLI proof:** `58f417771 fix(gateway): include projectId in routingPolicyId-bind update where clause`
**Subsequent fixes incorporated:** `e552d3f1a` (RoutingPolicyService provider org-ownership validation + PVK integration-test fixture), `f5d99106d` (Vite router fix — see §6 "Browser /cli/auth path" below)

## 1. Pre-state — fresh terminal, no config

```
$ test -f /tmp/lw-dogfood.json && echo "exists" || echo "missing"
missing
```

## 2. `langwatch login` — RFC 8628 device-code flow

```
$ LANGWATCH_URL=http://localhost:5660 \
  LANGWATCH_GATEWAY_URL=http://localhost:5563 \
  LANGWATCH_BROWSER=none \
  LANGWATCH_CLI_CONFIG=/tmp/lw-dogfood.json \
  tmp/langwatch login

Opening browser to authenticate...
Verification URL: http://localhost:5660/cli/auth?user_code=PVMR-QDQK
If your browser does not open, paste the URL above and enter code: PVMR-QDQK

⠋ Waiting for you to log in
```

(In a real run the user would visit the URL in the browser, complete
SSO + Auth0 MFA, and click Approve. For this run we drove approval
programmatically via a one-off `tmp/approve-device-code.ts` helper
that calls `PersonalVirtualKeyService.ensureDefault` and
`approveDeviceCode` directly — Sergey's REST probe matrix already
verifies the live browser path on `:5660`.)

After approval:

```
✓ Logged in as rogerio@langwatch.ai
  Organization: acme-demo
  Gateway: http://localhost:5563

Try it:
  langwatch claude         # use Claude Code
  langwatch codex          # use Codex
  langwatch cursor         # use Cursor
  langwatch dashboard      # open your dashboard
```

## 3. `~/.langwatch/config.json` — persisted, 0600

```
$ ls -l /tmp/lw-dogfood.json
-rw-------  ...  /tmp/lw-dogfood.json

$ cat /tmp/lw-dogfood.json | jq . (redacted)
{
  "gateway_url": "http://localhost:5563",
  "control_plane_url": "http://localhost:5660",
  "access_token": "lw_at_UIXM…REDACTED",
  "refresh_token": "lw_rt_cnzb…REDACTED",
  "expires_at": 1777234915,
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
    "secret": "lw_vk_live_…REDACTED"
  }
}
```

## 4. `langwatch whoami` — reads config, prints identity

```
$ LANGWATCH_CLI_CONFIG=/tmp/lw-dogfood.json tmp/langwatch whoami
User:         rogerio@langwatch.ai
Name:         Rogerio Chaves
Organization: acme-demo
Gateway:      http://localhost:5563
Dashboard:    http://localhost:5660
```

## 5. `langwatch init zsh` — env-injection proof

```
$ LANGWATCH_CLI_CONFIG=/tmp/lw-dogfood.json tmp/langwatch init zsh
export ANTHROPIC_BASE_URL=http://localhost:5563/api/v1/anthropic
export ANTHROPIC_AUTH_TOKEN=lw_vk_live_…REDACTED
export OPENAI_BASE_URL=http://localhost:5563/api/v1/openai
export OPENAI_API_KEY=lw_vk_live_…REDACTED
export GOOGLE_GENAI_API_BASE=http://localhost:5563/api/v1/gemini
export GEMINI_API_KEY=lw_vk_live_…REDACTED
```

These env vars are exactly what `langwatch claude`, `langwatch codex`,
`langwatch cursor`, `langwatch gemini` would inject (via `exec` on
Unix) before launching the underlying tool. Tools see the gateway
as their AI provider with the personal VK as the bearer token.

## 6. Browser `/cli/auth` path — discovered + fixed by Alexis

The original proof at the top of this doc covered the **CLI side** of
the device flow end-to-end (mint → poll → exchange → config persist
→ whoami → init). The **browser approval** half (where a real user
clicks **Approve** at `/cli/auth?user_code=…`) was driven by a
local helper script in this proof, not by the live page.

When Alexis ran her screenshot pass for the populated `/me`
dashboard, she discovered that `/cli/auth` (along with `/me`,
`/me/settings`, `/settings/routing-policies`) was **never registered
in the Vite router** — those routes were falling through the
`/:project` catch-all and bouncing the visitor to a project page.
Fixed in `f5d99106d fix(governance): register /me, /me/settings,
/cli/auth, /settings/routing-policies in Vite router + scope OTP
redirects`.

After her fix:
- `GET http://localhost:5660/cli/auth?user_code=4X3T-MQ7R` → `200`
  (Vite serves the React shell; the page-level handler reads
  `router.query.user_code` and renders the approve confirmation
  card after SSO).
- `POST http://localhost:5660/api/auth/cli/device-code` returns
  `verification_uri_complete=http://localhost:5660/cli/auth?user_code=…`
  pointing at the now-reachable page.
- The CLI exchange path is unchanged from `58f417771`; the original
  CLI-side proof at §1–§5 above stands without modification.

**Why this run was still helper-authenticated**, even with the route
fix in place:

1. **Auth0 callback URL not configured for `:5660`.** The running
   pnpm dev has `NEXTAUTH_URL=http://localhost:5660` (Sergey's
   restart), but Auth0's allowlist points at the prod hosts. An
   unauthenticated visitor to `/cli/auth` is bounced through
   `/auth/signin` → Auth0 → `callback URL mismatch` and never
   reaches the approve button. This is expected on local dev.
2. **Shared-worktree browser lock.** Alexis's screenshot pass had
   the Playwright Chrome cache locked while taking screenshots of
   `/me` and `/me/settings`; both my `mcp__playwright` and
   `mcp__playwright-headed` invocations errored with
   `Browser is already in use`. Driving a second browser would
   require `--isolated`, which we deferred.

The orchestrator-accepted bar for this PR is therefore: **CLI
exchange/config/whoami/init proven end-to-end (above), and `/cli/auth`
route registration proven via HTTP 200 + commit `f5d99106d`.**
Approval through the live browser remains a self-host smoke test
documented in `docs/ai-gateway/governance/cli-reference.mdx#verifying-a-fresh-install-end-to-end`.

## Bugs found during dogfood + fixed

| # | Bug | Discovered by | Fix commit |
|---|---|---|---|
| 1 | RoutingPolicy missing from `EXEMPT_MODELS` in dbMultiTenancyProtection.ts (every query throws "requires projectId") | Andre | `77f8aee76` |
| 2 | PersonalVirtualKeyService.issue dropped `policy.providerCredentialIds` on the floor (VK creation rejected with "At least one provider credential is required") | Andre | `3111d8a2e` |
| 3 | `tx.virtualKey.update` missing `projectId` in where clause when binding `routingPolicyId` (multi-tenancy guard rejected) | Andre | `58f417771` |
| 4 | `/cli/auth`, `/me`, `/me/settings`, `/settings/routing-policies` never registered in Vite router — all 4 routes were falling through `/:project` catch-all and redirecting to a project page | Alexis (during screenshot pass) | `f5d99106d` |
| 5 | RoutingPolicyService.create/update did not validate `providerCredentialIds` belong to the policy's organization (privilege escalation surface) | Master orchestrator review of fix #2 | `e552d3f1a` |
| 6 | PersonalVirtualKeyService integration test fixture didn't seed a default RoutingPolicy → red on main + on every iteration of fix #2 | Sergey (during fix #2 testing) | `e552d3f1a` |
| 7 | `user.personalContext`/`user.personalUsage`/`personalVirtualKeys.list/issuePersonal/revokePersonal` used bare `skipPermissionCheck` while accepting `organizationId` — silent tRPC rejection masked by `/me` empty-state copy | Alexis (during screenshot pass) | `e52651123` |

## What's verified

- ✅ CLI binary builds (`make cli`); 0 lint, 17/17 unit tests pass
- ✅ `langwatch login` mints device-code, polls /exchange, persists
  `~/.langwatch/config.json` (mode 0600, atomic rename)
- ✅ `langwatch whoami` reads + prints real identity (rogerio@langwatch.ai
  / acme-demo) from disk
- ✅ `langwatch init zsh` injects ANTHROPIC + OPENAI + GEMINI base URLs
  + auth tokens pointing at `http://localhost:5563` (the gateway)
- ✅ Server contracts (Sergey's REST probe matrix at `7ff02f2a0` +
  this dogfood):
  - device-code: `200` with spec shape
  - exchange: `428` pending → `200` after approval; `408` expired,
    `410` denied, `429` slow_down
  - refresh: `200` with rotated tokens; `401` invalid_grant
  - logout: `200` idempotent
  - lookup/approve/deny: session-protected; `401` unauthenticated
- ✅ `/cli/auth` route registered after `f5d99106d`; HTTP 200 confirms
  Vite serves the page (browser-level rendering + approve click is
  the only piece left for self-host smoke test)
- ✅ `/me`, `/me/settings`, `/settings/routing-policies` populated
  end-to-end on `:5660` post-`e52651123` — Alexis's screenshots prove
  the bug-#7 fix unblocked real `personalContext`/`personalUsage`/
  `personalVirtualKeys.list` data flow:
  - https://i.img402.dev/h6e31g1r4b.png — /me dashboard
  - https://i.img402.dev/bhs7kgzt2q.png — /me/settings (real Profile)
  - https://i.img402.dev/lbt3bb3f43.png — /settings/routing-policies admin

## What's not in this proof (and why)

- ❌ Live browser approval of /cli/auth: Auth0 callback URL not
  configured for `:5660` on local dev (expected); separately, the
  Playwright Chrome cache was locked by Alexis's parallel screenshot
  session. Self-host smoke test in cli-reference.mdx covers the live
  path.
- ❌ A real `/v1/chat/completions` round-trip through the gateway:
  the personal VK secret in the local config is a placeholder
  (helper-script idempotent re-run path can't recover the
  hashed-at-rest secret minted on the first call). For a real round
  trip, wipe the personal VK + reissue, OR run the self-host
  walkthrough end-to-end with a fresh user.
