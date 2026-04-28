# Performance Roadmap

Prioritised optimisation opportunities for the AI Gateway hot path. Each item
includes estimated impact, effort, and the benchmark that would validate it.

## Current baseline (Apple M3 Pro, Go 1.26.1, chi)

- Full router round-trip: **4.0 µs / 67 allocs**
- Pre-dispatch primitives: **~391 ns / 8 allocs**
- Under load (extrapolated): **~4–6 µs** gateway overhead per request

## Priority 3 — High impact, high effort

### 3.1 Replace chi with a lighter router (or raw `http.ServeMux`)

**Current:** chi adds ~2–3 µs and ~15 allocs per request for route matching,
middleware chain traversal, and context enrichment.

**Fix:** Go 1.22+ `http.ServeMux` supports method+path patterns natively. The
gateway has only 7 routes — the full chi feature set (URL params, groups, etc.)
isn't needed.

**Impact:** ~2–3 µs and ~15 allocs saved. Router benchmark target: <2 µs.
**Risk:** Lose chi's middleware composition model. Would need a custom middleware
chain (trivial for our small set). Worth profiling first to confirm chi is
actually the bottleneck vs. body read + JSON.

### 3.2 Body read + dispatch without full materialization

**Current:** The full request body is read into memory, JSON-peeked for model/stream,
then passed as `[]byte` through the pipeline.

**Fix:** For streaming passthrough (the 90% case), avoid reading the full body.
Instead:
1. Read first ~512 bytes to peek model/stream.
2. Construct a `io.MultiReader(peekedBytes, r.Body)` for dispatch.
3. Bifrost dispatches with the streaming reader directly.

**Impact:** Eliminates body materialization entirely for streaming requests. Saves
the largest allocation and reduces TTFB by the body-read time.
**Risk:** Interceptors (policy, cache, guardrails) currently operate on `[]byte`.
Would need a staged approach: only skip materialization when no body-mutating
interceptors are active.

## Priority 4 — Speculative / requires profiling

### 4.2 Batch OTel span export with ring buffer

If OTel export ever shows up in pprof, replace the default SDK batcher with a
lock-free ring buffer that avoids channel contention at >10k RPS.

### 4.3 Kernel bypass (io_uring / kTLS)

For extreme throughput (>50k RPS single-node), investigate kernel bypass for
socket I/O. Likely overkill — horizontal scaling is cheaper.

## Measurement methodology

Always benchmark with:
```bash
# Micro-benchmarks (Go testing.B)
go test -bench=. -benchmem -count=5 -run=^$ ./path/to/package/

# Load test (vegeta, measures real-world including network)
go run ./services/aigateway/loadtest \
  -rps=5000 -duration=60s -workers=100 \
  -target=http://localhost:5563/v1/chat/completions \
  -token=$VK

# Profile under load
go tool pprof http://localhost:5563/debug/pprof/profile?seconds=30
go tool pprof http://localhost:5563/debug/pprof/heap
```

Run benchmarks 5× (`-count=5`) and compare with `benchstat` to reject noise:
```bash
go test -bench=. -benchmem -count=5 ./... > before.txt
# ... make changes ...
go test -bench=. -benchmem -count=5 ./... > after.txt
benchstat before.txt after.txt
```

## Target

After remaining optimisations:
- Full router: **<2 µs / <40 allocs**
- Pre-dispatch primitives: **<200 ns / 2 allocs**
- Under vegeta at 5k RPS: **p99 < 500 µs** gateway overhead (excluding provider RTT)

The "sub-millisecond overhead" marketing claim remains valid with chi. The gap
to fasthttp (~2–3 µs) is recoverable via the applied optimisations alone without
changing the HTTP framework.
