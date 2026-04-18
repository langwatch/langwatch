# Lane C (Andr) — Ralph Iteration 4 Learnings

## What shipped (4 commits)

- `d5d6012a7` — CLI groups: `langwatch gateway-budgets {list,create,archive}` + `langwatch gateway-providers {list,create,disable}` + two new service classes (`GatewayBudgetsApiService`, `GatewayProvidersApiService`). `pnpm typecheck` green.
- `5e8d4e46b` — `docs/ai-gateway/cli/langwatch-cli.mdx` re-synced with actually-shipped flag surface (was drifting from iter-2 aspirational spec).
- Pending commit — `docs/ai-gateway/observability.mdx` gains a "Trace-id propagation — concrete handshake" section citing @sergey's Lane A iter 4 pt1 response headers + a copy-paste curl recipe.
- Pending commit — `specs/ai-gateway/public-rest-api.feature` written (BDD scenarios for auth, VK/budget/provider CRUD, DTO-parity with tRPC, machine-actor audit attribution, hono-openapi roadmap).

## Team coordination log (iter 4)

- @alexis iter 5 shipped `c34577f2f` — BudgetCreateDrawer + ProviderBindingCreateDrawer wired into `/gateway/{budgets,providers}`, 45/45 unit tests, guardrail-check plumbing stub. Confirmed:
  - `Slot` is a free-text field in provider binding (not enum).
  - `+1` on Lane C doing budgets + providers CLI — aligned with her iter 5 REST routes.
  - Dev-auth bypass is NOT in gateway scope — would be a separate lane (NEXTAUTH_URL → LOCAL_DEV_BYPASS_AUTH behind NODE_ENV=development).
  - Iter 6 Lane B queue: observability_endpoint on GatewayConfig (unblocks @sergey's RouterExporter.EndpointResolver), VK edit drawer, Budget edit drawer, /gateway/usage real-spend page, describeRoute OpenAPI for /api/gateway/v1/*.
- @sergey iter 4 pt1 shipped `e9b04e6` + `134878648` — W3C traceparent propagation, per-tenant OTel router, 8 trace-propagation BDD scenarios. Asked Lane C to cite concrete response headers in SDK docs; done in iter 3 follow-up.
- Channel signed off; no direct blockers on Lane C for iter 5.

## Locked decisions (iter 4 additions)

1. **`langwatch gateway-budgets` CLI uses scope-kind-specific id flags**: `--project <id>`, `--team <id>`, `--organization <id>`, `--virtual-key <id>`, `--principal <id>` — driven by `--scope <kind>`. Rejected the `--scope-id` alternative because it forces the user to pick the kind twice and can't be validated at parse time.
2. **`langwatch gateway-budgets archive`, NOT `delete`**: matches Alexis's soft-archive implementation. Delete is deliberately not exposed at the REST or CLI layer — preserves ledger history.
3. **`langwatch gateway-providers` slot is free-text**: per Alexis's note. CLI help examples show `primary`, `eu-region`, `canary` as conventions.
4. **DTO parity = shared service, split mappers**: codified in `specs/ai-gateway/public-rest-api.feature`. Only `virtualKey.dto.ts` holds the two mappers; business logic is in one place (`VirtualKeyService`) and called from both Hono + tRPC.
5. **No VK `update` CLI yet**: waiting for Alexis's iter-6 VK edit drawer. Rotate+revoke+create cover most flows; edit is for changing aliases / cache mode / fallback.

## Open items for iter 5

- [ ] Dogfood blocked on Auth0 — **unchanged from iter 3/4**. Alexis may implement `LOCAL_DEV_BYPASS_AUTH` behind `NODE_ENV=development`; doc side is owned by Lane C once it lands.
- [ ] `langwatch virtual-keys update <id>` CLI — wait for Alexis's VK edit drawer to land (iter 6 Lane B).
- [ ] `docs/ai-gateway/self-hosting/config.mdx` — add `observability_endpoint` once @sergey/@alexis plumb the per-project routing knob.
- [ ] `docs/ai-gateway/observability.mdx` update with per-project routing example (same trigger).
- [ ] Finally run the CLI against a real dev server — needs auth unblock + @sergey's bifrost dispatcher live. Earliest: iter 5–6.
- [ ] Scenario test for the CLI happy path using `scenario` framework + real Claude Code / Codex / opencode runs through the gateway.

## Useful file pointers (additions to iter 1–3)

- CLI budgets: `typescript-sdk/src/cli/commands/gateway-budgets/{list,create,archive}.ts`
- CLI providers: `typescript-sdk/src/cli/commands/gateway-providers/{list,create,disable}.ts`
- Budget service: `typescript-sdk/src/client-sdk/services/gateway-budgets/gateway-budgets-api.service.ts`
- Provider service: `typescript-sdk/src/client-sdk/services/gateway-providers/gateway-providers-api.service.ts`
- Public REST spec: `specs/ai-gateway/public-rest-api.feature`

## What to do when iter 5 fires

1. Read `.claude/LANE-C-ITER-{1,2,3,4}.md`.
2. `kanban channel history langwatch-ai-gateway -n 30` for overnight activity.
3. Check if Alexis's iter-6 shipped `observability_endpoint` — if yes, update `docs/ai-gateway/self-hosting/config.mdx` + `docs/ai-gateway/observability.mdx` per-tenant-routing section.
4. Check if `LOCAL_DEV_BYPASS_AUTH` landed — if yes, attempt browser dogfood of VK list + drawer + budget page + provider page. 6+ screenshots as originally planned.
5. Check if @sergey's fallback engine + circuit breaker shipped — if yes, update `docs/ai-gateway/providers/fallback-chains.mdx` with the concrete sliding-window / failure-threshold values.
6. If all above blocked, consider: writing a cookbook `docs/ai-gateway/cookbooks/ci-dogfood.mdx` showing the curl-based end-to-end smoke test from the langwatch-cli doc, or writing the OpenAPI spec by hand for `/api/gateway/v1/*`.
