# Governance Dogfood Runbook

Single source of truth for repeatable QA of the AI Governance Platform surfaces
(IngestionTemplates, UserIngestionBindings, /me portal, Trace Ingest, direct
OTLP, cross-tenant isolation, forge-attempt rejection, admin drill-in, fresh
user walkthrough).

Pair this runbook with the BDD specs under `specs/ai-gateway/governance/` —
specs describe behavior; this runbook describes how to drive it and what to
inspect.

## Pre-flight

| Item | Value |
|---|---|
| App container | `wise-mixing-zebra-app-1` (run heavy scripts inside, NOT host — host `.env` DATABASE_URL points at AWS RDS in dev worktrees) |
| Postgres | `wise-mixing-zebra-postgres-1` |
| ClickHouse | `wise-mixing-zebra-clickhouse-1` |
| App URL | `http://localhost:5560` |
| Playwright auth state | `langwatch/e2e/auth.json` (rogerio@langwatch.ai session) |
| Demo org (Ariana Zone Co) | `organization_0000HrVrdhNtZNrM5ysajP4tyK9Cq` |
| Personal project | `project_0007LMBuNNJ3P88cRMPkIJnKhJbTF` |
| Virtual key | `vk_AHkS1MesrtEMTr2HqFDQeA` |
| Budget | `QtIsx2A8KVDJF-jT4BIV8` |

Common gotcha: any `pnpm tsx scripts/dogfood/...` run from the host hits AWS
RDS and silently no-ops on local data. Always:

```bash
docker exec wise-mixing-zebra-app-1 pnpm tsx scripts/dogfood/governance/<script>.ts <args>
```

## Personas

| Persona | Account | What they see |
|---|---|---|
| Admin (rogerio) | rogerio@langwatch.ai | Full /me + Governance + AI Gateway sidebar, admin drill-in, all tenant data scoped via RoleBinding |
| Fresh user | new sign-up | Empty /me tile grid (no bindings yet), no governance sidebar until role granted |
| Cross-tenant probe | second org | Used to verify isolation — emit OTLP with forged tenant_id and confirm receiver clamps it back |

## Flows

### 1. /me portal walkthrough

**Walker:** `langwatch/e2e/full-uiqa-walkthrough.ts` (19 surfaces).
**Out dir:** `/tmp/uiqa-walkthrough/`.

Gates:
- Sidebar shows GOVERN section with AI Gateway (Beta blue) + Governance (Preview purple)
- /me lands on tile grid (no auth bounce)
- Trace Ingest section renders 3 install tiles (claude_code, cursor, claude_cowork) + raw_otlp_advanced dashed tile
- My Usage panel shows spend, by-tool breakdown, recent activity
- No leak of /me-only components under `/[project]` chrome (catalog no-leak invariant)

### 2. Per-template install ritual

**Walker:** `langwatch/e2e/dogfood-claude-code-install.ts` (claude_code).
**Out dir:** `/tmp/dogfood-claude-code/`.

For cursor + claude_cowork: copy + adjust `data-tile-slug` selector. Sibling
walkers are a TODO — parameterize by slug.

Gates:
- Tile click opens drawer
- "Issue binding token" mints `ik-lw-<base32>` token (captured via tRPC response body regex `/"token":"(ik-lw-[A-Za-z0-9_]+)"/`)
- "Rotate token" path works when tile is already installed (no 409 CONFLICT)
- Token shown ONCE — does not survive page reload
- Tile renders green Check + Installed badge + token prefix after install

### 3. Trace ingest verification

**Seed:** `seed-heavy-usage.ts` (model variance + weekend decimation).
**Fast-path emit:** `emit-otlp.sh` with canned payloads under `payloads/{claude_code,cursor,claude_cowork}.json`.

```bash
docker exec wise-mixing-zebra-app-1 \
  pnpm tsx scripts/dogfood/governance/seed-heavy-usage.ts \
  --personal-project project_0007LMBuNNJ3P88cRMPkIJnKhJbTF \
  --virtual-key vk_AHkS1MesrtEMTr2HqFDQeA \
  --budget QtIsx2A8KVDJF-jT4BIV8 \
  --days 30 --rows 250
```

Gates:
- Traces land in ClickHouse with `TenantId` = binding's org
- `TotalCost` populated (not NULL) — verified via `canonicalCostExtractor` + `llmModels.json` alias lookup
- `model` parsed (not raw upstream string)
- `total_tokens` populated
- Span name matches one of: `claude-code.completion`, `cursor.agent.completion`, `claude-cowork.completion`
- `langwatch.origin` attribute present

Model registry sanity: payloads MUST use current-gen aliases (claude-sonnet-4.6,
gpt-5.4, claude-haiku-4-5, gemini-2-5-pro). Legacy aliases
(claude-3-5-sonnet-20241022, gpt-4o-2024-08-06) → TotalCost=NULL silently.

### 4. Direct OTLP (raw_otlp_advanced fallback)

Discovery card on /me → deep links to `/me/settings#otlp`. User mints raw OTLP
token, posts to `/api/otel/v1/traces` with `Authorization: Bearer <token>`.
No OTTL parsing — span shape is whatever client emits.

Gate: trace lands, but `gen_ai.*` fields only populate if client already shapes them.

### 5. Cross-tenant isolation

```bash
docker exec wise-mixing-zebra-app-1 \
  bash scripts/dogfood/governance/emit-otlp.sh \
  --token ik-lw-<binding-of-org-A> \
  --forge-tenant-id <org-B-id>
```

Gate: receiver clamps `TenantId` back to org-A (binding-authoritative stamp).
Verify in ClickHouse:

```sql
SELECT TenantId, count() FROM Trace
WHERE BindingId = '<binding-of-org-A>'
GROUP BY TenantId;
-- expected: single row with TenantId = org-A
```

### 6. Forge-attempt categories

Three forge axes — all must be receiver-clamped:

| Axis | Flag | Expected |
|---|---|---|
| Forged tenant_id | `--forge-tenant-id <other>` | Clamped to binding's org |
| Forged project_id | `--forge-project-id <other>` | Clamped to binding's project |
| Forged user_id | `--forge-user-id <other>` | Clamped to binding's user |

All three: zero acceptance of forged value, zero "rejectedSpans" — silent clamp.

### 7. Admin drill-in

**Surfaces:**
- `/settings/routing-policies` (NOT `/settings/governance/routing-policies` — that 404s; GovernanceLayout sub-nav links to flat path)
- `/[project]/governance/*` — birdeye, audit log, anomalies, recent activity
- Budget management, virtual key management

Gate: admin sees all tenant data via RoleBinding(scope=ORGANIZATION, role=ADMIN).
OrganizationUser.role=ADMIN alone returns FORBIDDEN — seed RoleBinding too.

### 8. Screenshot recapture

**Walker:** `capture-my-usage-scrolled.ts` (1440x2400 viewport, data-aware waits on model row text not networkidle).
**Out dir:** `/tmp/post-bypass-my-usage/`.

Quality gates per rchaves Step 6b feedback:
- ≥7 days span (no single-day chart)
- ≥3 models in By-tool breakdown
- Current-gen aliases only
- Weekend 60% decimation visible in spend chart

Light-theme recipe (alexis): `localStorage.setItem('theme','light')` before
capture; force `overflow:visible + maxHeight:none` on scroll ancestors to
unfold to single ~2128px page; `screencapture -x -o -R 0,30,1440,1050`.

### 9. Fresh-user walkthrough

Manual: sign up with throwaway email, land on /me, verify:
- Empty tile grid (no green-check badges)
- No GOVERN sidebar section (no RoleBinding yet)
- Click claude_code tile → drawer mints first binding → green-check appears
- Emit one OTLP trace → My Usage populates within ~5s

## Artifact upload

Screenshots go to `https://img402.dev/`:

```bash
curl -F image=@screenshot.png https://img402.dev/api/free
```

Embed returned URL in PR body. **Never commit screenshots to repo** unless
they're docs assets under `docs/images/ai-governance/`.

## Known-failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Walker times out on "By tool" selector | Dev stack 502 or auth expired | Restart `wise-mixing-zebra-app-1`, re-seed auth.json |
| `Cannot find module '.prisma/client'` | Generated types missing in worktree | `cd langwatch && pnpm start:prepare:files` |
| Install drawer returns 409 CONFLICT | Tile already has binding | Drawer should auto-route to Rotate path; if not, check `hasExistingBinding` prop wiring |
| TotalCost = NULL on trace | Legacy model alias not in llmModels.json | Bump payload to current-gen alias |
| `pnpm tsx scripts/...` silently no-ops | Host `.env` DATABASE_URL points at AWS RDS | Run inside `docker exec wise-mixing-zebra-app-1` |
| /me/settings 404 | tsx watch didn't pick up route | Hard-kill API pid, restart `pnpm dev` |

## TODO (out-of-scope for this runbook drop)

- Parameterize `dogfood-claude-code-install.ts` by slug → single walker for all 3 templates
- Add fresh-user walker (currently manual)
- Add automated assertion runner that consumes ClickHouse query gates (currently visual diff only)
