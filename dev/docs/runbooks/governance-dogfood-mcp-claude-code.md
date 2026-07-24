# Real-user MCP dogfood — Claude Code provisions governance via MCP only

> **Why this exists**: PR #3524 ships the LangWatch governance MCP toolset
> (Ask B-MCP at 7639b6c2b + audit-uniform 66fd35162 + dev proxy fix
> 82375478e). The fixture-track is locked via `mcp-client-probe.ts` against
> the running stack. The real-user track — the one rchaves explicitly
> asked for, "Claude Code agent provisions virtual keys + budgets +
> anomaly rules + ingestion-source OTTL via MCP only, no UI clicks" — is
> what this runbook walks through. Closes the agent-end-to-end gate from
> `specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature`
> @governance-mcp.

## Prerequisites

- `make dev` running (or `make dev-scenarios`) — both Vite (FRONTEND_PORT
  default 5560) and the API (FRONTEND_PORT + 1000 = 6560) up. The Vite
  proxy at vite.config.ts forwards `/mcp`, `/sse`, `/messages`,
  `/oauth/*`, `/.well-known/oauth-*` from 5560 to the API port — so
  external MCP clients hit the canonical 5560.
- Claude Code CLI installed (`claude --version`).
- Logged in as a user that is org ADMIN with a RoleBinding on the org
  scope (post-alexis 0614a16c6 — see
  `feedback_test_seed_rolebinding_for_admin_perms.md`). For local dev,
  the seed populates rogerio@langwatch.ai with the right combo.

## Step 1 — Add the LangWatch MCP server to Claude Code

```bash
claude mcp add langwatch http://localhost:5560/mcp
```

For OAuth-PKCE flows that mint a session with `ctx.callerUserId` (so
governance write tools work, not just read tools), use the OAuth flow
explicitly when prompted by the MCP client. The PKCE entrypoint is
`/api/mcp/authorize` — `claude mcp add` can be configured to start at
that URL; it will redirect through `/auth/signin` if the browser
session isn't already established. The `userId` lands in the OAuth
token cache and propagates through `resolveSessionContext` → 
`registerGovernanceMcpTools` → `ctx.callerUserId`.

After `claude mcp add`, `claude mcp list` should show `langwatch`
and 11 tools prefixed `mcp__langwatch__governance_*` should appear in
the next conversation.

## Step 2 — Read-tool walkthrough (project-apiKey-only sessions work)

In a fresh `claude` session:

> "Use the LangWatch governance MCP tools to list the ingestion templates
> on my org, then dump the platform OTTL for the claude_code template."

Claude Code should call:

1. `mcp__langwatch__governance_ingestion_templates_admin_list` (returns 3 platform
   rows with `ottlRules` populated)
2. `mcp__langwatch__governance_ingestion_templates_get` with `id: <claude_code-id>`
   (returns a single row)

**Verify** — query Postgres:

```sql
SET search_path TO mydb;
SELECT action, "createdAt"::timestamp(0), metadata
FROM "AuditLog"
WHERE action LIKE 'gateway.ingestion_template.%'
ORDER BY "createdAt" DESC LIMIT 5;
```

Read tools don't emit audit rows by design (no state change). Skip to
Step 3 for the audit assertions.

## Step 3 — Write-tool walkthrough (OAuth-authenticated session required)

Same `claude` session:

> "Clone the platform claude_code template into an editable org row,
> then update its OTTL rules to add a single statement that strips
> claude.code.session_id from spans, then archive it."

Claude Code should call:

1. `mcp__langwatch__governance_ingestion_templates_clone_from_platform`
   with `source_template_id: <claude_code-id>` → returns new org-authored
   row with id `<custom-id>`
2. `mcp__langwatch__governance_ingestion_templates_update_ottl_rules`
   with `id: <custom-id>` and `ottl_rules: 'delete_key(attributes,
   "claude.code.session_id")'`
3. `mcp__langwatch__governance_ingestion_templates_archive` with
   `id: <custom-id>`

**Verify the audit trail** — three rows MUST land with
`metadata.surface = 'mcp'`:

```sql
SET search_path TO mydb;
SELECT action, "createdAt"::timestamp(0), metadata->>'surface' AS surface, metadata
FROM "AuditLog"
WHERE action IN (
  'gateway.ingestion_template.cloned_from_platform',
  'gateway.ingestion_template.ottl_updated',
  'gateway.ingestion_template.archived'
)
ORDER BY "createdAt" DESC LIMIT 3;
```

Expected: three rows, all with `surface=mcp`. Same shape as the tRPC
flow at `1d5ddb1fe` (Ask A dogfood) and the Hono flow at sergey's
`60f769498` (B-6) — only `metadata.surface` differs. Locks the
@audit-uniform contract for the agent end-to-end path.

## Step 4 — Bind a binding via MCP

Same `claude` session:

> "Install a UserIngestionBinding for me on the claude_code template
> and print the ik-lw- token."

Claude Code calls:

1. `mcp__langwatch__governance_user_ingestion_bindings_install`
   with `template_id: <claude_code-id>` → returns
   `{ binding: {...}, token: "ik-lw-..." }`

The ik-lw- token is shown ONCE — `claude` will print it inline. Copy it
into your Anthropic / Claude Code OTel telemetry config (e.g. via
`OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer ik-lw-...`) and start
emitting traces.

**Verify**: `gateway.user_ingestion_binding.installed` audit row with
`metadata.surface=mcp`.

## Step 5 — Negative case (fail-closed without OAuth)

Run `claude mcp remove langwatch` then re-add via the project-apiKey
path (no OAuth). In a fresh session:

> "Try to clone the claude_code template via MCP."

Expected: the tool returns `AUTH_REQUIRED: This governance MCP tool
requires an OAuth-authenticated session...`. NO audit row appears for
the would-be clone. This is the fail-closed contract from
`src/mcp/governance-tools.ts:requirePermission`.

## Step 6 — Report back

Paste in the channel:

- All 11 governance tools shown in `claude mcp list` (or whatever the
  CLI reports for tool inventory).
- The 3 audit rows with `surface=mcp` from Step 3.
- The 1 binding-install audit row with `surface=mcp` from Step 4.
- The AUTH_REQUIRED string from Step 5.

If anything diverges from the expected behavior, ping with the actual
output + the diff vs `mcp.mdx` + this runbook. mcp.mdx is the contract
of record (andre 199226d77 + 5fcadd586 + 391cfd989).

---

## Cross-references

- `langwatch/scripts/dogfood/governance/mcp-client-probe.ts` — the
  fixture-fast-loop equivalent of this runbook (no OAuth, project-apiKey
  Bearer only — read tools + AUTH_REQUIRED negative case).
- `langwatch/src/mcp/__tests__/governance-tools.audit-uniform.integration.test.ts` —
  service-layer audit-uniform regression (asserts metadata.surface=mcp
  on create + install).
- `feedback_fixtures_dont_replace_real_user_dogfood.md` — rchaves nudge
  memory; this runbook is the real-user-track companion to the probe.
- `feedback_tsx_watch_no_auto_reload_on_git_pull.md` — if the tools
  appear missing in `claude mcp list`, the docker app container may be
  running stale code. `docker restart wise-mixing-zebra-app-1` and
  re-verify.
