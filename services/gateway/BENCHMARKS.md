# Gateway hot-path benchmarks

Baseline numbers for the primitives that fire on every `/v1` request, measured on an Apple M1 Max (`VirtualApple @ 2.50GHz`, Go 1.26.1). Reproduce with:

```bash
cd services/gateway
go test -bench=. -benchmem -run=^$ \
  ./internal/auth/ ./internal/circuit/ ./internal/budget/ ./internal/fallback/
```

| Benchmark | ns/op | allocs | Notes |
|-----------|-------:|-------:|-------|
| `auth.BenchmarkSignRequest` (POST w/ body) | ~2,900 | 21 | HMAC-SHA256 over canonical string + sha256 of body |
| `auth.BenchmarkSignRequest_EmptyBody` (GET) | ~2,900 | 21 | Same cost; empty body still hashes |
| `auth.BenchmarkKeyHash` | 380 | 3 | SHA-256 of raw VK for cache lookup |
| `circuit.BenchmarkAllow_Closed` | **64** | 0 | Breaker permit on a closed slot — fires once per fallback attempt |
| `circuit.BenchmarkAllow_ManySlots` (500 creds) | 112 | 1 | Same path under realistic multi-tenant scale |
| `circuit.BenchmarkRecordFailure_SlidingWindow` | 128,000 | 0 | Worst case with full window — only fires when provider is steadily failing |
| `budget.BenchmarkPrecheck` (3 scopes, cached) | **9** | 0 | The fastest check — trivial arithmetic |
| `budget.BenchmarkPrecheck_HardStop` | 269 | 5 | Formats a message string; not on happy path |
| `budget.BenchmarkNewULID` | 116 | 2 | Per-request idempotency key |
| `fallback.BenchmarkWalk_PrimarySuccess` | 119 | 1 | Happy path: one slot, no fallback |
| `fallback.BenchmarkWalk_FallsOver` | 243 | 2 | Primary 5xx → secondary serves |

## Happy-path overhead budget

Summing the primitives that fire on every successful non-streaming request:

```
KeyHash           380 ns   (auth cache lookup key)
Precheck           9 ns    (cached budget evaluation)
Walk_PrimarySuccess 119 ns (fallback engine — single slot)
Allow_Closed       64 ns   (breaker permit)
NewULID           116 ns   (gateway_request_id)
------------------------
total pre-bifrost ~ 700 ns ≈ 0.7 μs
```

HMAC signing (~2.9 μs) only fires on internal gateway→control-plane calls — never on the customer-facing hot path. Bifrost + provider round-trip dominates wall time, but the gateway's own overhead is well under the "sub-millisecond" claim baked into the GA pitch.

## Allocation profile

Zero-allocation paths (great for GC pressure at high RPS):

- `circuit.Allow` on a closed slot
- `budget.Precheck` on allow

Allocating paths we accept:

- `NewULID` — 2 allocs for the ULID buffer + string conversion
- `fallback.Walk` — 1 alloc for the Event slice (length = chain depth)
- `SignRequest` — 21 allocs for http.Header mutations + hex encoding

If the allocation cost ever shows up in pprof heap profiles, the cheap wins are (a) pooling the `[]fallback.Event` slice and (b) caching the canonical string buffer in `SignRequest`.

## What's NOT benchmarked here

- Full dispatcher round trip — bifrost's own cost dwarfs ours; benchmark at that layer only if a regression shows.
- OTel span creation — batched / async, not on critical path.
- Guardrails — bound by control-plane RTT, meaningless as a Go benchmark.
- Streaming throughput — measured end-to-end with vegeta/k6 instead (see `docs/ai-gateway/cookbooks/ci-smoke-test.mdx` for the load-test starter).

## When to re-run

Before cutting a release, after touching any file in `internal/{auth,circuit,budget,fallback}`, or before accepting a PR that reshapes any primitive above. Regressions > 2× should block the merge.
