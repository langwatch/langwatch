# `langwatch` CLI — full e2e dogfood proof

**Date:** 2026-04-26
**Branch:** `feat/governance-platform`
**HEAD:** `58f417771 fix(gateway): include projectId in routingPolicyId-bind update where clause`
**Worktree:** `wise-mixing-zebra`
**Servers:** pnpm dev `:5660` (Vite frontend + API), aigateway `:5563`

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

## Bugs found during dogfood + fixed

| # | Bug | Commit |
|---|---|---|
| 1 | RoutingPolicy missing from EXEMPT_MODELS in dbMultiTenancyProtection.ts | `77f8aee76 fix(governance): exempt RoutingPolicy from multitenancy projectId guard` |
| 2 | PersonalVirtualKeyService.issue dropped policy.providerCredentialIds | `3111d8a2e fix(gateway): atomic routingPolicyId bind on VK create + auth-boundary checks` |
| 3 | tx.virtualKey.update missing projectId in where clause | `58f417771 fix(gateway): include projectId in routingPolicyId-bind update where clause` |

## Must-fix-before-PR (still open)

- RoutingPolicyService.create/update doesn't validate provider-credential org-ownership
- PersonalVirtualKeyService integration test fixture missing seeded RoutingPolicy
