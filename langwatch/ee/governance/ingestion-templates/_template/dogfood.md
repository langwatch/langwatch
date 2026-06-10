# Dogfood ritual — `<TEMPLATE_SLUG>`

> **Starter file. Each tile copies this into `langwatch/ee/governance/ingestion-templates/<TEMPLATE_SLUG>/dogfood.md`** and replaces every `<TEMPLATE_SLUG>` occurrence with its own slug (`claude_code` / `cursor` / `claude_cowork` / `raw_otlp_advanced`). Per-tile customization sections are marked `<TEMPLATE-SPECIFIC: …>`.

This ritual is the **acceptance gate** for the `<TEMPLATE_SLUG>` tile shipping green-checked in `/me`. **No tile turns green until BOTH the fixture track AND the real-user track below have been run end-to-end with screenshots in the PR body.** Same B6 discipline rchaves bug-bashed the dashboard chrome with.

The verifications align 1:1 with the scenarios in `specs/ai-gateway/governance/personal-project-ingest-via-template.feature`. If a step here passes but the matching scenario fails (or vice versa), the spec or the code is wrong — file as a blocker, not a nit.

## What v1 actually verifies vs what's deferred

Two parts of the spec'd ritual are deferred to v1.1 / v2 per @sergey's lane-S checkpoint (24f48a159):

| Capability | v1 status | What it means for the ritual |
|---|---|---|
| Receiver auth via ik-lw-* token | ✅ shipped (60ae9847a) | hash lookup → defense-in-depth re-verify → personal project tenancy works end-to-end |
| Receiver-stamped attribution keys (B6 16-key set: `langwatch.user.id`, `.team.id`, `.organization.id`, `.project.id`, `.tenant_id`, etc.) | ✅ shipped (existing B6 guard) | trace lands with correct user/team/org/project regardless of what the payload claims |
| Receiver-stamped provenance keys (`langwatch.template.id`, `.user_ingestion_binding.id`, `.source`) | 🔵 deferred (next sergey commit) | Step 4 Then-clause asserting these keys is **blocked on sergey's provenance-stamping work** |
| 19-key `protectedTemplateAttributeKeys` principal-field guard | 🟡 deferred to v1.1 / v2 | v1 templates ship empty `ottlRules` → no template OTTL ever runs → no audit row fires v1. **Step 6 forge-audit-row Then-clause is blocked on the principal-field-guard work.** Receiver still re-stamps attribution keys via existing B6 guard. |
| `gateway.template_ottl_protected_field_attempt` audit row | 🟡 deferred to v1.1 / v2 | same as above |
| Template OTTL transform | 🟡 deferred to v2 (admin-OTTL authoring UI) | v1 platform templates rely on the upstream tool emitting canonical gen_ai already (Claude Code / Cursor / claude_cowork all do). The receiver passthrough produces the canonical shape without OTTL involvement v1. |

**v1 effectively proves**: real upstream tool with canonical gen_ai → user's binding token → receiver auth → personal-project tenancy → /me/traces with cost/tokens/model populated. That's the headline use case.

**v1 explicitly does NOT prove**: provenance-key stamping (sergey deferred), OTTL transform correctness (no v1 template runs OTTL), or admin-OTTL forge rejection audit row (deferred).

When running this ritual on v1, mark deferred steps as **"blocked on sergey's provenance-stamping work"** or **"blocked on v1.1 principal-field-guard work"** explicitly. Don't fail the tile for steps that are documented as deferred.

---

## Fixture track vs real-user track — both required

Two parallel tracks. Both must pass (modulo the deferred-step exemptions above). **Fixture-only sign-off is forbidden.** Per `feedback_fixtures_dont_replace_real_user_dogfood.md`: fixtures lie when the real path has friction the fixture skipped — broken OAuth redirects, OTTL not loading at runtime, drawer copy mismatched, bound credentials not wired through to receiver auth, etc. Fixtures catch parser correctness; only the real path catches flow correctness.

| Track | What it proves | Tools | When to run |
|---|---|---|---|
| **Fixture track** | Receiver/parser handles the canonical post-OTTL shape; principal-field guard rejects forge attempts | `scripts/dogfood/governance/emit-otlp.sh` + `payloads/<slug>.json` + `forge-attempt/{attribution,provenance}.json` | Every commit that touches receiver/OTTL/principal-guard code; runs in seconds |
| **Real-user track** | The actual user flow works end-to-end — admin publishes via UI, user installs via UI form, real upstream tool emits, receiver auth + OTTL + cost extraction all wire through, /me/traces shows parsed trace | Real admin UI + real `/me` install drawer + real upstream tool (Claude Code / Cursor / Claude cowork session) + real `/me/traces` browse | Before tile ships green; before claiming feature works |

**Report both tracks side by side.** If real-user can't be done yet (e.g., upstream tool wrapper not built, OAuth provider not wired), say **"blocked on X"** explicitly so the dependency is visible.

---

## Prerequisites

- `pnpm dev` running against postgres + clickhouse + aigateway (`make dev-scenarios` or `make dev-full`)
- `scripts/dogfood/governance/seed-personas.ts` has been run (creates `jane@acme.com` + `ben@acme.com` with personal projects)
- The user under dogfood has installed the `<TEMPLATE_SLUG>` template via `/me` Trace Ingest (binding row exists; binding access token `ik-lw-*` captured)
- `scripts/dogfood/governance/emit-otlp.sh` is on `PATH` (or invoked by full path)
- Canned payload exists at `scripts/dogfood/governance/payloads/<TEMPLATE_SLUG>.json`

If any prerequisite is missing, **stop here** and resolve before running the ritual. Don't fudge it.

---

---

## FIXTURE TRACK — fast loop (parser + receiver correctness)

The 7 steps below cover the fixture track. They use `emit-otlp.sh` to fire canned OTLP payloads + forge attempts at the receiver. They prove the receiver/parser/principal-guard are correct under the canonical shape.

**These are necessary but NOT sufficient.** Pass them, then run the real-user track below.

---

### Step 1 — Install drawer renders correctly

Open `/me`, scroll to the **Trace Ingest** section, click **Install** on the `<TEMPLATE_SLUG>` tile.

Verify:
- Drawer opens with template name + iconKey + description copy
- Endpoint URL renders (read-only, copyable): `<BASE_HOST>/api/otel` — the OTEL SDK exporter auto-appends `/v1/traces` per OTLP convention. Receiver POSTs land at `<BASE_HOST>/api/otel/v1/traces`. The drawer shows the BASE URL (matches `OpenTelemetrySetup` pattern + the `OTEL_EXPORTER_OTLP_ENDPOINT` env-var convention).
- Binding access token renders (one-time-show, masked thereafter, prefix-only display): first 9 chars `ik-lw-XYZ…`
- Copy button works for endpoint, token, and the full env-var snippet
- Copy disambiguation copy is present:
  - For `claude_code` / `cursor` / `claude_cowork`: 'OTTL pre-applied. Source-shaped (cost/tokens/model normalized).'
  - For `raw_otlp_advanced`: 'No OTTL. Bring your own span shape.'

**Screenshot**: `langwatch/docs/images/ai-governance/ingestion-templates/<TEMPLATE_SLUG>-install-drawer.png`.

If the drawer ever shows the token unmasked-but-not-just-revealed, **blocker** (token-leak risk). If the disambiguation copy is missing or wrong, **blocker** (support-ticket risk).

### Step 2 — Bind-install audit row

Open `/settings/audit-log`. Verify a row appears within 5 seconds:
- `action = gateway.user_ingestion_binding.installed`
- `actor = <jane>` (or whichever user installed)
- `target = <TEMPLATE_SLUG>` (the template slug, NOT the binding id — slug is the user-facing handle)
- An OCSF mirror row exists in `governance_ocsf_events` for the same event

**Screenshot**: `langwatch/docs/images/ai-governance/ingestion-templates/<TEMPLATE_SLUG>-audit-bind-install.png`.

If the audit row never appears, **blocker** (governance-trail integrity).

### Step 3 — Emit a trace via the dogfood wrapper

```bash
./scripts/dogfood/governance/emit-otlp.sh \
  --binding-token <ik-lw-TOKEN_FROM_STEP_1> \
  --template-id <TEMPLATE_SLUG> \
  --base-url http://localhost:5560 \
  --count 1
```

Expected: `ok http://localhost:5560/api/otel/v1/traces — template:<TEMPLATE_SLUG> status=200 trace_id=<hex>`. The trace_id is echoed on stdout for downstream correlation.

If the wrapper returns non-2xx, capture the response body (`--verbose`) and treat as **blocker** — the receiver-side wiring is broken.

**Verify-landing > verify-response.** A 2xx receiver response is necessary but NOT sufficient. The OTLP path can return `200 status + partialSuccess.rejectedSpans=N` which silently drops the span (e.g., timestamp past the SPAN_MAX_PAST_MS cutoff, body schema mismatch, etc.). The wrapper SHOULD surface rejectedSpans loudly when it sees them; if it doesn't, you'll see a clean `ok status=200` for spans that never landed. Always do Step 4 (verify the trace appears at /me/traces) before signing the wrapper response off as success. See `feedback_fixture_wrapper_time_anchor_and_2xx_drop_guard.md`.

### Step 4 — Trace lands on `/me/traces` with canonical shape

Open `/me/traces` filtered by `langwatch.source = "<TEMPLATE_SLUG>"`. Verify the trace from step 3 appears within 5 seconds.

Click into the trace and verify:
- `gen_ai.system` populated (template-OTTL-output)
- `gen_ai.request.model` + `gen_ai.response.model` populated
- `gen_ai.usage.input_tokens` + `gen_ai.usage.output_tokens` are both > 0
- `langwatch.cost.usd` > 0 (RECEIVER-derived via `canonicalCostExtractor` — NOT template-OTTL-stamped)
- `langwatch.user.id` == jane's user id (RECEIVER-stamped, NOT template-OTTL-stamped)
- `langwatch.project.id` == jane's personal project id (RECEIVER-stamped)
- `langwatch.template.id` == the active `<TEMPLATE_SLUG>` template id (RECEIVER-stamped, post-OTTL)
- `langwatch.user_ingestion_binding.id` == the binding row id (RECEIVER-stamped, post-OTTL)
- `langwatch.source` == `<TEMPLATE_SLUG>` (RECEIVER-stamped, post-OTTL)
- **<TEMPLATE-SPECIFIC: per-template extras>**:
  - `claude_code` → `claude.code.session_id` + `claude.code.tool.name`
  - `cursor` → `cursor.agent.id` + `cursor.workspace.path`
  - `claude_cowork` → `claude.cowork.session_id` + `claude.cowork.collaborator_count`
  - `raw_otlp_advanced` → no template-specific extras; spans land as-emitted

**Screenshot**: `langwatch/docs/images/ai-governance/ingestion-templates/<TEMPLATE_SLUG>-trace-detail.png` showing the canonical fields populated.

The 'NOT template-OTTL-stamped' assertion on attribution + provenance keys is the load-bearing invariant — verified directly via the forge ritual in step 6.

### Step 5 — Source filter on `/me/traces` is trustworthy

If multiple bindings exist for the same user, verify filtering by `langwatch.source = "<TEMPLATE_SLUG>"` shows ONLY this template's traces and excludes other templates'.

For users with only one binding, this step is implicitly verified by step 4.

### Step 6 — Forge-attempt regression

Re-emit using the forge fixtures. **Both variants must run.**

```bash
# Attribution forge — claims B6 16-key attribution set
./scripts/dogfood/governance/emit-otlp.sh \
  --binding-token <ik-lw-TOKEN_FROM_STEP_1> \
  --forge-attempt attribution

# Provenance forge — claims langwatch.template.id / .user_ingestion_binding.id / .source
./scripts/dogfood/governance/emit-otlp.sh \
  --binding-token <ik-lw-TOKEN_FROM_STEP_1> \
  --forge-attempt provenance
```

Verify (per `template-ottl-principal-guard.feature`):
- The trace lands at `/me/traces` (receiver does NOT 4xx the request — it accepts but re-stamps)
- `langwatch.user.id` == binding-authoritative jane's id, NOT the `FORGE_user_other` claim from the payload
- `langwatch.template.id` == binding-authoritative `<TEMPLATE_SLUG>` template id, NOT `FORGE_template_other`
- `langwatch.source` == binding-authoritative `<TEMPLATE_SLUG>`, NOT `FORGE_source_other`
- An audit row `gateway.template_ottl_protected_field_attempt` appears at `/settings/audit-log` per forge variant, with the rejected-key list in the row payload

**Screenshot**: `langwatch/docs/images/ai-governance/ingestion-templates/<TEMPLATE_SLUG>-forge-audit.png` showing both attribution + provenance attempts rejected.

If the receiver echoes the FORGE_* values into the trace (instead of restoring authoritative ones), **blocker** — the principal-field guard is broken. This is the regression playbook artifact for the next time someone touches OTTL post-auth wiring.

### Step 7 — Hard-cut rotation

Trigger token rotation from the `/me` Trace Ingest tile (rotate button on the installed tile). Capture the new `ik-lw-*` token.

Verify:
- New token `T_NEW` is issued and shown one-time in a drawer (same shape as install drawer)
- `bindingAccessTokenHash` column updates to `SHA256(T_NEW)` (verifiable by tail-of-`pg_dump` or Prisma Studio)
- `bindingAccessTokenPrefix` column updates to `T_NEW`'s first 9 chars
- The previous token is **revoked immediately** (no grace window):
  ```bash
  ./scripts/dogfood/governance/emit-otlp.sh \
    --binding-token <ik-lw-TOKEN_OLD_FROM_STEP_1> \
    --template-id <TEMPLATE_SLUG>
  ```
  Expected: `fail … status=401 …` — receiver returns 401 with no enumeration (silent, no 'token revoked' leakage).
- The tile copy reads: `Token rotated — paste new token to upstream now to resume.`
- Re-emit with `T_NEW` succeeds and lands a trace.

**Screenshot**: `langwatch/docs/images/ai-governance/ingestion-templates/<TEMPLATE_SLUG>-rotation-tile.png` showing the rotated tile with the new prefix.

If the old token still works after rotation, **blocker** — the hard-cut invariant is broken (and v2 grace-period would need to be reintroduced as a deliberate design change, not as an accident).

---

---

## REAL-USER TRACK — end-to-end (flow correctness)

This track is what proves the feature works for an actual user, not just for a fixture-shaped synthetic POST. **No sign-off without this.** Per `feedback_fixtures_dont_replace_real_user_dogfood.md`: a fixture-only-passing template will explode under real traffic; the real path is where OAuth redirects break, OTTL fails to load at runtime, drawer copy mismatches, etc.

Run the same 7-step structure but **using the real UI for clicks, the real upstream tool for emission, and the real API path for everything**. No `emit-otlp.sh`. No canned payloads. No curl-to-internal-endpoints.

### R1 — Admin publishes the template via real admin UI

- Sign in as an admin (NOT via DB-set role; use the real signin flow)
- Navigate to `/settings/governance/tool-catalog` → "Ingestion Templates" tab (Lane-B Iter 4 folds the new tab into the existing admin tool-catalog surface; no new `/settings/ai-tools` route)
- Verify `<TEMPLATE_SLUG>` appears as a platform-default tile
- Click "View OTTL" on the tile and confirm the OTTL rules render correctly (read-only v1)
- **Screenshot**: `langwatch/docs/images/ai-governance/ingestion-templates/<TEMPLATE_SLUG>-admin-catalog.png`

### R2 — User installs via real `/me` install drawer

- Sign out, sign in as a non-admin user (`ariana@acme.test` or another seeded persona — your own personal account, not a synthetic user)
- Navigate to `/me`, scroll to Trace Ingest section
- Click `<TEMPLATE_SLUG>` tile → install drawer opens
- Complete the credential form (otlp_token = nothing to fill; static_api_key = paste real key; agent_id = enter real agent id) and click Save
- Verify the binding ik-lw-* token shows one-time, copy it for steps R3-R6
- Verify the tile flips to green-checked
- **Screenshot**: `<TEMPLATE_SLUG>-real-install-drawer.png` + `<TEMPLATE_SLUG>-tile-green-checked.png`

### R3 — Run the real upstream tool against the binding

- **<TEMPLATE-SPECIFIC: real upstream tool invocation>**:
  - `claude_code` → set `OTEL_EXPORTER_OTLP_ENDPOINT=<BASE_HOST>/api/otel` + `OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer <ik-lw-TOKEN>"` in env, run an actual `claude` CLI session that emits real OTLP. Per sergey's checkpoint: Claude Code already emits canonical gen_ai natively, so v1 receiver passthrough suffices. **Conditional blocker**: only blocked if the locally-installed Claude Code version doesn't emit OTLP at all (e.g., older builds before OTLP exporter wiring). If yes-OTLP-emitting, dogfoodable today.
  - `cursor` → configure Cursor's telemetry export endpoint, run an actual Cursor agent action against a real codebase. **Conditional blocker**: only blocked if Cursor's OTLP-export configurability isn't surfaced in the version I'm running.
  - `claude_cowork` → run a real claude_cowork session pointed at the binding. **Conditional blocker**: only blocked if the claude_cowork CLI/SDK doesn't emit OTLP yet.
  - `raw_otlp_advanced` → discovery card on /me Trace Ingest section that deep-links to /me/configure#otlp; user grabs the personal project apiKey + runs any OTel-instrumented script (Python `opentelemetry-instrument`, Node `@opentelemetry/sdk-node`). This one IS dogfoodable today; no IngestionTemplate row exists for it (per andre PM call at 348936e4f).
- Capture the upstream tool's output (terminal log, "trace exported" confirmation)

### R4 — Verify trace lands at `/me/traces` with canonical shape

- Navigate to `/me/traces` filtered by `langwatch.source = "<TEMPLATE_SLUG>"`
- Verify the trace from R3 appears within ~10 seconds (real upstream tool's batch flush is slower than fixture)
- Click into the trace and verify the SAME canonical fields as fixture-track Step 4:
  - `gen_ai.usage.input_tokens` + `output_tokens` populated **from the real upstream response** (NOT the fixture's hardcoded numbers)
  - `langwatch.cost.usd` derived from `canonicalCostExtractor` reading the real token counts
  - `gen_ai.response.model` matches the actual model the upstream tool used (e.g. `claude-3-5-sonnet-<actual date>`)
  - All attribution + provenance keys receiver-stamped to the binding's authoritative principal
- **Screenshot**: `<TEMPLATE_SLUG>-real-trace-detail.png` showing canonical fields populated by real OTTL parsing + real cost extraction

If the trace doesn't appear OR cost is missing OR attribution is wrong, that's a flow-level bug the fixture track skipped — **blocker**.

### R5 — Cross-user isolation (real, not fixture)

- Sign out, sign in as a SECOND real user (different persona, different personal project)
- Navigate to that user's `/me/traces`
- Verify the first user's trace from R4 does NOT appear under any filter (no `<TEMPLATE_SLUG>`, no global view, no admin probe-as-user)
- **Screenshot**: `<TEMPLATE_SLUG>-real-cross-user-isolation.png` showing second user's empty `/me/traces` (or only their own bindings' traces)

### R6 — Admin drill-in via `/governance` bird's-eye

- Sign in as an admin (org-admin, NOT the trace owner)
- Navigate to `/governance` bird's-eye → click into the user/team that owns the trace from R4
- Verify the trace surfaces with the "Viewing as admin" banner active
- Verify an audit row `governance.viewWorkspaceAs` appears at `/settings/audit-log` within 5s
- **Screenshot**: `<TEMPLATE_SLUG>-real-admin-drill-in.png` + `<TEMPLATE_SLUG>-real-drill-in-audit.png`

### R7 — Real OTTL forge attempt

- Sign in as admin, edit `<TEMPLATE_SLUG>`'s OTTL rules to attempt a protected-key write (e.g. add a statement that sets `langwatch.user.id = "FORGE"` or `langwatch.template.id = "FORGE"`)
- **Note**: in v1 admin OTTL authoring is platform-only (no admin-author UI); to test this real-path, the platform-team OTTL must be edited in source AND deployed. **Blocked on v2 admin OTTL authoring UI**. Until then, the closest real-path test is the fixture-track Step 6 forge regression.
- When v2 admin authoring lands: as user, fire a real upstream trace through the modified template
- Verify the receiver re-stamps the protected key + emits `gateway.template_ottl_protected_field_attempt` audit row
- **Screenshot when unblocked**: `<TEMPLATE_SLUG>-real-forge-rejected.png`

---

## Hard-gate checklist

Before marking the `<TEMPLATE_SLUG>` tile green-checked in `/me`, **both tracks must pass** with the following:

### Fixture track (fast loop, every receiver/OTTL change)

- [ ] Step 1 install drawer screenshot in PR #3524 body
- [ ] Step 2 bind-install audit row screenshot in PR body
- [ ] Step 3 wrapper emit succeeded (stdout trace_id captured)
- [ ] Step 4 trace-detail screenshot in PR body showing canonical + provenance keys
- [ ] Step 5 source filter verified (or N/A note if single-binding user)
- [ ] Step 6 both forge-attempt audit rows screenshot in PR body
- [ ] Step 7 rotation tile screenshot + 401 stdout from old token

### Real-user track (no green check without)

- [ ] R1 admin-catalog screenshot — admin publishes via real UI
- [ ] R2 real-install-drawer + tile-green-checked screenshots — user installs via real UI
- [ ] R3 upstream tool output captured (terminal log) OR explicit "blocked on <DEP>" note in PR body
- [ ] R4 real-trace-detail screenshot showing cost from REAL upstream response
- [ ] R5 cross-user isolation verified with two REAL accounts
- [ ] R6 admin drill-in screenshot + audit-log row from real `/governance` bird's-eye
- [ ] R7 real OTTL forge attempt rejected (or explicit "blocked on v2 admin OTTL authoring + v1.1 principal-field-guard" — both gates apply pre-v2)

If any fixture-track step fails, **the tile does not ship green**. If any real-user-track step fails AND it's not legitimately blocked on a named dependency, **the tile does not ship green**. Either fix the impl + re-run, or mark the tile as v1.1 / defer + document the blocker.

---

## Cross-references

- Spec: `specs/ai-gateway/governance/personal-project-ingest-via-template.feature` (canonical scenarios)
- Spec: `specs/ai-gateway/governance/user-ingestion-binding-lifecycle.feature` (install / rotation / uninstall / 5-state rejection / template-update-propagation)
- Spec: `specs/ai-gateway/governance/template-ottl-principal-guard.feature` (19-key protected set + forge audit row)
- Spec: `specs/ai-gateway/governance/template-cross-bind-guard.feature` (Layer 1 structural impossibility + Layer 2 token-as-scope)
- Wrapper: `scripts/dogfood/governance/emit-otlp.sh` (NORMAL + FORGE modes)
- Payloads: `scripts/dogfood/governance/payloads/{<TEMPLATE_SLUG>.json, forge-attempt/{attribution,provenance}.json}`
- Docs: `docs/ai-governance/ingestion-templates/index.mdx` (user-facing tutorial)
