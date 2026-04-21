# Gateway hot-path benchmarks

Baseline numbers for the primitives that fire on every `/v1` request, measured on an Apple M3 Pro (`arm64`, Go 1.26.1). Reproduce with:

```bash
go test -bench=. -benchmem -run=^$ \
  ./services/aigateway/adapters/controlplane/ \
  ./services/aigateway/adapters/authresolver/ \
  ./services/aigateway/adapters/budget/ \
  ./services/aigateway/adapters/httpapi/ \
  ./pkg/retry/
```

## Component benchmarks

| Benchmark                     |   ns/op |   B/op | allocs | Notes                                                          |
| ----------------------------- | ------: | -----: | -----: | -------------------------------------------------------------- |
| `Router_ChatCompletions`      |   6,464 | 12,533 |     82 | Full chi round-trip: auth + middleware + pipeline + JSON write |
| `Sign` (POST w/ body)         |   807.4 |    280 |     10 | HMAC-SHA256 canonical string — only on internal CP calls       |
| `Sign_EmptyBody` (GET)        |   806.2 |    280 |     10 | Same cost; empty body still hashes                             |
| `HashKey`                     |   102.7 |    176 |      3 | SHA-256 of raw VK for L1 cache lookup                          |
| `Precheck` (3 scopes, cached) | **4.6** |      0 |      0 | Zero-alloc arithmetic on cached budget snapshot                |
| `Precheck_HardStop`           | **1.6** |      0 |      0 | Early-exit on breached scope                                   |
| `NewULID`                     |    80.1 |     48 |      2 | Per-request idempotency key                                    |
| `Walk_PrimarySuccess`         |    69.2 |      0 |      0 | Happy path: one slot, no fallback                              |
| `Walk_FallsOver`              |   129.0 |      0 |      0 | Primary 5xx → secondary serves                                 |
| `Walk_NonRetryableStops`      |    83.2 |      0 |      0 | Fast exit on 4xx                                               |

## Happy-path overhead budget

Summing the primitives that fire on every successful non-streaming request
(excluding the httptest recorder overhead in the Router benchmark):

```
HashKey              102.7 ns  (L1 cache lookup key)
Precheck               4.6 ns  (cached budget evaluation)
Walk_PrimarySuccess   69.2 ns  (retry engine — single slot)
NewULID               80.1 ns  (gateway_request_id)
─────────────────────────────
total pre-dispatch ~ 256 ns ≈ 0.26 μs
```

The full router benchmark (6.5 µs) includes chi routing, middleware stack,
`io.ReadAll` of the request body, JSON model-peek, httptest recorder overhead,
and response serialization. In production with connection reuse and kernel
zero-copy, expect ~4–5 µs gateway-side overhead under load.

HMAC signing (~1.8 μs) only fires on internal gateway→control-plane calls —
never on the customer-facing hot path.

## Allocation profile

Zero-allocation paths (great for GC pressure at high RPS):

- `budget.Precheck` on allow/block
- `retry.Walk` happy path (primary success / early-exit patterns)
- All verdict evaluations (pure arithmetic)

Allocating paths we accept:

- `NewULID` — 2 allocs for the ULID buffer + string conversion
- `HashKey` — 3 allocs for sha256 digest + hex encoding
- `Router` — 82 allocs per request (chi context, headers, body read, JSON unmarshal)

## Cache-override body mutation

These benchmarks fire only when a guardrail/policy triggers a cache-control
override — not on every request.

| Benchmark                               |  ns/op |  B/op | allocs | Notes                                             |
| --------------------------------------- | -----: | ----: | -----: | ------------------------------------------------- |
| `ApplyCacheOverride_RuleHitModeDisable` | 10,307 | 5,840 |     35 | Strip all `cache_control` keys via sjson          |
| `ApplyCacheOverride_RuleHitModeForce`   |  2,738 | 2,800 |     18 | Inject ephemeral into last system + content block |
| `ApplyCacheOverride_NoOp`               |    2.3 |     0 |      0 | Respect mode — returns body unchanged             |

## What's NOT benchmarked here

- **Bifrost provider round-trip** — dominates wall time (50–2000 ms depending on
  model). Gateway overhead is noise relative to this.
- **OTel span creation** — batched and async, not on critical path.
- **Guardrails** — bound by control-plane RTT (5–50 ms), not a Go benchmark concern.
- **L1 LRU hit** — `hashicorp/golang-lru` is well-benchmarked upstream; our overhead
  is the HashKey cost above.
- **Streaming throughput** — measured end-to-end with the load test harness (see below).

## Load testing (vegeta)

For p50/p99 latency under sustained RPS, use the vegeta harness:

```bash
go run ./services/aigateway/loadtest \
  -rps=1000 -duration=30s \
  -target=http://localhost:5563/v1/chat/completions \
  -token=lw_vk_test_...
```

See `services/aigateway/loadtest/` for the full harness and analysis scripts.

## Improvement opportunities

See `services/aigateway/PERF-ROADMAP.md` for the prioritised list of optimisations.

## When to re-run

Before cutting a release, after touching any file in:
- `adapters/{authresolver,budget,controlplane,httpapi}/`
- `app/pipeline/`
- `pkg/retry/`

Regressions > 2× should block the merge.
