# Dogfood ritual — `<TEMPLATE_SLUG>`

> **Starter file. Each tile copies this into `langwatch/ee/governance/ingestion-templates/<TEMPLATE_SLUG>/dogfood.md`** and replaces every `<TEMPLATE_SLUG>` occurrence with its own slug (`claude_code` / `cursor` / `claude_cowork` / `raw_otlp_advanced`). Per-tile customization sections are marked `<TEMPLATE-SPECIFIC: …>`.

This ritual is the **acceptance gate** for the `<TEMPLATE_SLUG>` tile shipping green-checked in `/me`. **No tile turns green until every step below has been run end-to-end with a screenshot in the PR body.** Same B6 discipline rchaves bug-bashed the dashboard chrome with.

The verifications align 1:1 with the scenarios in `specs/ai-gateway/governance/personal-project-ingest-via-template.feature`. If a step here passes but the matching scenario fails (or vice versa), the spec or the code is wrong — file as a blocker, not a nit.

---

## Prerequisites

- `pnpm dev` running against postgres + clickhouse + aigateway (`make dev-scenarios` or `make dev-full`)
- `scripts/dogfood/governance/seed-personas.ts` has been run (creates `jane@acme.com` + `ben@acme.com` with personal projects)
- The user under dogfood has installed the `<TEMPLATE_SLUG>` template via `/me` Trace Ingest (binding row exists; binding access token `lwub_*` captured)
- `scripts/dogfood/governance/emit-otlp.sh` is on `PATH` (or invoked by full path)
- Canned payload exists at `scripts/dogfood/governance/payloads/<TEMPLATE_SLUG>.json`

If any prerequisite is missing, **stop here** and resolve before running the ritual. Don't fudge it.

---

## Ritual — 7 steps

### Step 1 — Install drawer renders correctly

Open `/me`, scroll to the **Trace Ingest** section, click **Install** on the `<TEMPLATE_SLUG>` tile.

Verify:
- Drawer opens with template name + iconKey + description copy
- Endpoint URL renders (read-only, copyable): `<BASE_HOST>/v1/traces`
- Binding access token renders (one-time-show, masked thereafter, prefix-only display): `lwub_<8-char-prefix>…`
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
  --binding-token <lwub_TOKEN_FROM_STEP_1> \
  --template-id <TEMPLATE_SLUG> \
  --base-url http://localhost:5560 \
  --count 1
```

Expected: `ok http://localhost:5560/api/otel/v1/traces — template:<TEMPLATE_SLUG> status=200 trace_id=<hex>`. The trace_id is echoed on stdout for downstream correlation.

If the wrapper returns non-2xx, capture the response body (`--verbose`) and treat as **blocker** — the receiver-side wiring is broken.

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
  --binding-token <lwub_TOKEN_FROM_STEP_1> \
  --forge-attempt attribution

# Provenance forge — claims langwatch.template.id / .user_ingestion_binding.id / .source
./scripts/dogfood/governance/emit-otlp.sh \
  --binding-token <lwub_TOKEN_FROM_STEP_1> \
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

Trigger token rotation from the `/me` Trace Ingest tile (rotate button on the installed tile). Capture the new `lwub_*` token.

Verify:
- New token `T_NEW` is issued and shown one-time in a drawer (same shape as install drawer)
- `bindingAccessTokenHash` column updates to `SHA256(T_NEW)` (verifiable by tail-of-`pg_dump` or Prisma Studio)
- `bindingAccessTokenPrefix` column updates to `T_NEW`'s first 8 chars
- The previous token is **revoked immediately** (no grace window):
  ```bash
  ./scripts/dogfood/governance/emit-otlp.sh \
    --binding-token <lwub_TOKEN_OLD_FROM_STEP_1> \
    --template-id <TEMPLATE_SLUG>
  ```
  Expected: `fail … status=401 …` — receiver returns 401 with no enumeration (silent, no 'token revoked' leakage).
- The tile copy reads: `Token rotated — paste new token to upstream now to resume.`
- Re-emit with `T_NEW` succeeds and lands a trace.

**Screenshot**: `langwatch/docs/images/ai-governance/ingestion-templates/<TEMPLATE_SLUG>-rotation-tile.png` showing the rotated tile with the new prefix.

If the old token still works after rotation, **blocker** — the hard-cut invariant is broken (and v2 grace-period would need to be reintroduced as a deliberate design change, not as an accident).

---

## Hard-gate checklist

Before marking the `<TEMPLATE_SLUG>` tile green-checked in `/me`, **all** of the following must be true:

- [ ] Step 1 install drawer screenshot in PR #3524 body
- [ ] Step 2 bind-install audit row screenshot in PR body
- [ ] Step 3 wrapper emit succeeded (stdout trace_id captured)
- [ ] Step 4 trace-detail screenshot in PR body showing canonical + provenance keys
- [ ] Step 5 source filter verified (or N/A note if single-binding user)
- [ ] Step 6 both forge-attempt audit rows screenshot in PR body
- [ ] Step 7 rotation tile screenshot + 401 stdout from old token
- [ ] **Cross-user isolation regression** — pair this ritual with the matching run as the second user (`ben@acme.com`); jane's traces MUST NOT appear on ben's `/me/traces`. See `specs/ai-gateway/governance/personal-project-ingest-via-template.feature @cross-user-isolation` and `specs/ai-gateway/governance/template-cross-bind-guard.feature` for the contract.

If a step fails, **the tile does not ship green**. Either fix the underlying impl + re-run the ritual, or mark the tile as v1.1 / defer.

---

## Cross-references

- Spec: `specs/ai-gateway/governance/personal-project-ingest-via-template.feature` (canonical scenarios)
- Spec: `specs/ai-gateway/governance/user-ingestion-binding-lifecycle.feature` (install / rotation / uninstall / 5-state rejection / template-update-propagation)
- Spec: `specs/ai-gateway/governance/template-ottl-principal-guard.feature` (19-key protected set + forge audit row)
- Spec: `specs/ai-gateway/governance/template-cross-bind-guard.feature` (Layer 1 structural impossibility + Layer 2 token-as-scope)
- Wrapper: `scripts/dogfood/governance/emit-otlp.sh` (NORMAL + FORGE modes)
- Payloads: `scripts/dogfood/governance/payloads/{<TEMPLATE_SLUG>.json, forge-attempt/{attribution,provenance}.json}`
- Docs: `docs/ai-governance/ingestion-templates/index.mdx` (user-facing tutorial)
