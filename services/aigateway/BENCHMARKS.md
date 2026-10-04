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
| `Router_ChatCompletions`      |   4,836 | 12,870 |     75 | Full chi round-trip: auth + middleware + pipeline + JSON write |
| `Sign` (POST w/ body)         |   859.7 |  1,081 |     12 | HMAC-SHA256 canonical string — only on internal CP calls       |
| `Sign_EmptyBody` (GET)        |   836.6 |  1,081 |     12 | Same cost; empty body still hashes                             |
| `HashKey`                     |    83.8 |     48 |      1 | SHA-256 of raw VK for L1 cache lookup                          |
| `Precheck` (3 scopes, cached) | **4.6** |      0 |      0 | Zero-alloc arithmetic on cached budget snapshot                |
| `Precheck_HardStop`           | **1.5** |      0 |      0 | Early-exit on breached scope                                   |
| `NewULID`                     |    76.0 |     48 |      2 | Per-request idempotency key                                    |
| `Walk_PrimarySuccess`         |    71.7 |      0 |      0 | Happy path: one slot, no fallback                              |
| `Walk_FallsOver`              |   128.2 |      0 |      0 | Primary 5xx → secondary serves                                 |
| `Walk_NonRetryableStops`      |    86.3 |      0 |      0 | Fast exit on 4xx                                               |

## Happy-path overhead budget

Summing the primitives that fire on every successful non-streaming request
(excluding the httptest recorder overhead in the Router benchmark):

```
HashKey                83.8 ns  (L1 cache lookup key)
Precheck                4.6 ns  (cached budget evaluation)
Walk_PrimarySuccess    71.7 ns  (retry engine — single slot)
NewULID                76.0 ns  (gateway_request_id)
─────────────────────────────
total pre-dispatch ~ 236.1 ns ≈ 0.24 μs
```

The full router benchmark (4.8 µs) includes chi routing, middleware stack,
lazy body materialization, JSON model-peek, httptest recorder overhead,
and response serialization. In production with connection reuse and kernel
zero-copy, expect ~3–4 µs gateway-side overhead under load.

HMAC signing (~0.9 μs) only fires on internal gateway→control-plane calls —
never on the customer-facing hot path.

## Allocation profile

Zero-allocation paths (great for GC pressure at high RPS):

- `budget.Precheck` on allow/block
- `retry.Walk` happy path (primary success / early-exit patterns)
- All verdict evaluations (pure arithmetic)

Allocating paths we accept:

- `NewULID` — 2 allocs for the ULID buffer + string conversion
- `HashKey` — 1 alloc for sha256 digest + hex encoding
- `Router` — 75 allocs per request (chi context, headers, body read/lazy materialization, JSON write)

## Cache-override body mutation

These benchmarks fire only when a guardrail/policy triggers a cache-control
override — not on every request.

| Benchmark                               | ns/op |  B/op | allocs | Notes                                             |
| --------------------------------------- | ----: | ----: | -----: | ------------------------------------------------- |
| `ApplyCacheOverride_RuleHitModeDisable` | 4,706 | 5,840 |     35 | Strip all `cache_control` keys via sjson          |
| `ApplyCacheOverride_RuleHitModeForce`   | 2,252 | 2,800 |     18 | Inject ephemeral into last system + content block |
| `ApplyCacheOverride_NoOp`               |   2.2 |     0 |      0 | Respect mode — returns body unchanged             |

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
  -token=vk-lw-...
```

See `services/aigateway/loadtest/` for the full harness and analysis scripts.

## Streaming audio: time to first audio byte

`POST /v1/audio/speech` relays the provider's audio as it arrives. The test below times the first audio byte on the same local provider, dialed directly and through the gateway, over real loopback sockets. It runs 300 alternating rounds after 20 warm-up rounds and fails when the p50 overhead reaches 20 ms.

```bash
cd services/aigateway
go test ./adapters/httpapi/ -run TestAudioSpeechStream_FirstByteOverhead -count=1 -v
```

Three runs on an Apple M3 Pro (`arm64`, Go 1.27.1):

| Run | Direct p50 | Direct p95 | Gateway p50 | Gateway p95 | Overhead p50 | Overhead p95 |
| --- | ---------: | ---------: | ----------: | ----------: | -----------: | -----------: |
| 1   |     192 µs |     393 µs |      565 µs |     1.04 ms |       373 µs |       652 µs |
| 2   |     184 µs |     408 µs |      523 µs |     1.08 ms |       338 µs |       674 µs |
| 3   |     100 µs |     461 µs |      276 µs |     1.19 ms |       176 µs |       729 µs |

The gateway side runs the whole request path: auth, model resolution, the spend and trace interceptors, the provider dial on a kept-alive connection, and the first flushed chunk. The provider is local, so the numbers exclude provider latency and TLS.

## WebSocket relay: added latency per frame

`BenchmarkRelayFrame` in `adapters/voicesession/relay_bench_test.go` echoes one frame off a local vendor, directly and through the relay, and reports the round trip. One echo crosses the relay twice, so the per-frame overhead is half the difference.

```bash
go test ./services/aigateway/adapters/voicesession/ -run xxx -bench BenchmarkRelayFrame -benchtime 20000x -count 3
```

Apple M3 Pro, loopback, 2026-10-04, median of three runs:

| Frame                 | Direct round trip p50 / p95 | Relayed round trip p50 / p95 | Overhead per frame p50 / p95 |
| --------------------- | --------------------------- | ---------------------------- | ---------------------------- |
| Text event, 230 bytes | 16.7 us / 23.7 us           | 38.8 us / 49.4 us            | 11 us / 13 us                |
| Binary, 4 KiB         | 26.5 us / 42.2 us           | 47.2 us / 82.1 us            | 10 us / 20 us                |

The target is under 5 ms at p50 in-region. The relay's own cost is three orders of magnitude below it, so the hop a client sees is the network distance to the gateway. A message up to 1 MiB is relayed as one frame from one buffer; a larger one is streamed in 32 KiB chunks.

## Improvement opportunities

See `services/aigateway/PERF-ROADMAP.md` for the prioritised list of optimisations.

## When to re-run

Before cutting a release, after touching any file in:

- `adapters/{authresolver,budget,controlplane,httpapi}/`
- `app/pipeline/`
- `pkg/retry/`

Regressions > 2× should block the merge.
