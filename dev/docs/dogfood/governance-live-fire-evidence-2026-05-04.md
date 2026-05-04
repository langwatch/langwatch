# Governance Live-Fire Dogfood Evidence — 2026-05-04

End-to-end production-path evidence for the AI Governance Platform PR
(#3524). Captured during the post-CI-fix dogfood pivot per @rchaves
"where are the actual screenshots? gogogo" directive.

**Distinct from the earlier Phase-7 smoke (commit `987a19bfc`) which used
synthetic OTLP traces.** This run drives REAL OpenAI completions through
the Go gateway and verifies every link in the chain lands cleanly with
real cost data.

## Setup

```
persona:           p4 (admin)
user_id:           ImguhCA5rHvJqLsQPoivq8l4ul4605Yj  (alexis-dogfood@acme.invalid)
organization_id:   kfdwbfXJpF0IrP_zkKiF_
team_id:           ZjBgVK9Evn6K9ofepE4cj
project_id:        -oo-X0fVw8xve1SUcM6kl  (org workspace)
personal_project:  project_0006IWOV8h4vOh9TQ39skXXJd30sr  (TenantId for VK traffic)
virtual_key_id:    vk_XDc7r6c5-VM-slajDpMk3g
virtual_key_secret: lw_vk_live_01KQSRG0J9Y04DSBVQGJ4Y7Z51
gateway_base_url:  http://localhost:5563
budget_id:         budget_dogfood_sergey_live  (PRINCIPAL scope, $1.00/MONTH, BLOCK)
```

## Chain exercised

1. `seed-personas.ts --persona p4 --mint-vk` minted the org/team/personal-project/VK
2. `curl POST http://localhost:5563/v1/chat/completions` with the VK fired real
   `openai/gpt-5-mini` completions
3. Bifrost dispatched to OpenAI; got real chat completion responses (real
   `chatcmpl-*` IDs + `req_*` request IDs from OpenAI provider)
4. Gateway emitted OTEL spans stamped with `langwatch.virtual_key_id` +
   `langwatch.gateway_request_id`
5. Trace-processing pipeline folded spans into `trace_summaries` keyed by
   `TenantId = personal_project_id`
6. `gatewayBudgetSync` reactor fired on each fold, resolved applicable
   budgets via `budget.repository.applicableForRequest({principalUserId, ...})`,
   inserted one row per budget into `gateway_budget_ledger_events`

## Evidence — `trace_summaries` (real LLM cost)

Sample rows for `TenantId = project_0006IWOV8h4vOh9TQ39skXXJd30sr` (latest 4):

| TraceId (12) | TotalCost | in_tokens | out_tokens | Models       | langwatch.virtual_key_id    | langwatch.gateway_request_id      |
|--------------|-----------|-----------|------------|--------------|------------------------------|------------------------------------|
| 0c5c4955     | 0.000033  | 14        | 15         | gpt-5-mini   | vk_XDc7r6c5-VM-slajDpMk3g    | req_888f59e25375087f2a57b0c34463ff |
| 4e867b02     | 0.000033  | 14        | 15         | gpt-5-mini   | vk_XDc7r6c5-VM-slajDpMk3g    | req_4e867b0258143a0d9537adac396806 |
| 4b0f783f     | 0.000033  | 12        | 15         | gpt-5-mini   | vk_XDc7r6c5-VM-slajDpMk3g    | req_4b0f783f24c6e42690e928406c3421 |
| 504b1bb4     | 0.000043  | 12        | 20         | gpt-5-mini   | vk_XDc7r6c5-VM-slajDpMk3g    | req_504b1bb421fe4092b227e43ad5c35a |

Total: 5 traces, summed cost $0.000195. All carry the gateway-stamped
attributes — proves the gateway → trace-processing pipeline path is intact
end-to-end.

## Evidence — `gateway_budget_ledger_events` (reactor fold)

```json
[
  {
    "BudgetId": "budget_dogfood_sergey_live",
    "AmountUSD": 0.000033,
    "TokensInput": 14,
    "TokensOutput": 15,
    "GatewayRequestId": "req_888f59e25375087f2a57b0c34463ff"
  },
  {
    "BudgetId": "budget_dogfood_sergey_live",
    "AmountUSD": 0.000033,
    "TokensInput": 14,
    "TokensOutput": 15,
    "GatewayRequestId": "req_4e867b0258143a0d9537adac396806"
  }
]
```

## Why this evidence > Phase-7 synthetic smoke

Phase-7 smoke proved the reactor handler executes when fed a synthetic OTLP
span carrying the right attributes. This run proves the *full* path —
including:

- Bifrost provider dispatch (real OpenAI 200 responses with real
  `X-Request-Id`, `Openai-Project`, etc. propagated as
  `provider_response_headers` in the gateway response)
- Gateway-side OTEL emission with attribute stamping
  (`services/aigateway/internal/otel/attrs.go`)
- Cost enrichment at trace-processing time (TotalCost = real per-token
  prices applied — not gateway-enqueued ActualCostUSD which was deleted in
  the iter72 trace-fold cutover)
- Budget applicability resolution at PRINCIPAL scope (was the suspected
  failure point; confirmed working)

## Re-running

```sh
# 1. Mint a fresh persona + VK
docker compose -f compose.dev.yml exec app pnpm tsx scripts/dogfood/seed-personas.ts \
  --email alexis-dogfood@acme.invalid --persona p4 --mint-vk

# 2. Fire a few completions
VK="lw_vk_live_..."  # from step 1
for i in 1 2 3; do
  curl -s -X POST http://localhost:5563/v1/chat/completions \
    -H "Authorization: Bearer $VK" \
    -H "Content-Type: application/json" \
    -d '{"model":"openai/gpt-5-mini","messages":[{"role":"user","content":"hi"}],"max_completion_tokens":15}'
done

# 3. Verify CH (replace with the personalProjectId returned from step 1)
docker compose -f compose.dev.yml exec app pnpm tsx -e "...trace_summaries+gateway_budget_ledger_events query..."
```

## Caveats / known fixture gaps

- The `seed-personas.ts` flow does NOT create a personal `GatewayBudget`
  for the new org by default — for the budget ledger to tick, an admin
  must create one via /settings/governance/budgets or SQL. This is by
  design (budgets are an explicit admin choice), not a bug.
- The traces' `langwatch.origin.kind` attribute is empty for gateway
  traffic — the `governanceKpisSync` and `governanceOcsfEventsSync`
  reactors gate on `origin.kind == "ingestion_source"` and skip gateway
  traces. Those reactors are exercised by Phase-7 smoke (synthetic
  ingestion-source traces) and Phase-10 tests.
