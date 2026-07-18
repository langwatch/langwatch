# Event-sourcing ingestion benchmark

A rare, opt-in CI run that drives the ingestion pipeline under load against a
3-replica ClickHouse and asserts that the data landed correctly.

- Workflow: `.github/workflows/event-sourcing-ingestion-benchmark.yml`
- Driver: `tools/ingestionbench/` (entrypoint `cmd/ingestionbench/`)
- Spec: `specs/ci/event-sourcing-ingestion-benchmark.feature`

The driver is a Go CLI with two subcommands — `seed` mints the isolated
projects a run needs, `run` sends the workload and verifies it. It ships as a
single static binary with no runtime dependencies beyond `psql` (seeding) and
`kubectl` (optional resource sampling), so CI builds it once up front and a
compile error costs seconds instead of surfacing after the cluster is up.

## What it drives

The load goes into the **app's own collector** — `POST /api/otel/v1/traces`,
the same OTLP route customer SDKs hit, authenticated with a real project API
key. From there it takes the production path: the collector's dedup gate, a
`recordSpan` command dispatched through the **real Redis-backed GroupQueue**,
then the fold and the projections into ClickHouse. Nothing is stubbed and no
read model is written directly; if it were, the benchmark would be asserting
against its own inserts.

**A worker process must be running, and it is not optional.** The GroupQueue
consumer loop only starts for `processRole` `"worker"` or `"all"` — a web-role
process constructs the queue with `consumerEnabled: false` and no dispatcher,
so it enqueues into Redis and never drains. `WORKERS_IN_PROCESS=1` does not
help under `NODE_ENV=production`: both `start.sh` and `start.ts` gate it on
`NODE_ENV === "development"` exactly, so in production it is silently ignored.
CI sets `START_WORKERS=true`, which runs `start:workers` as a second process —
the same web/worker split production deploys.

The driver checks this before doing any work: a **preflight** sends one span
and waits for it to land. If it never does, the run aborts with exit code 2
("could not run") and names the likely cause, rather than proceeding to report
every span in every stage as lost — which is what the same misconfiguration
looked like before, and reads as a catastrophic pipeline regression.

## What it measures

**Correctness under concurrent load.** That is the point. After each stage it
queries ClickHouse and fails the run on any of:

| Check | What a failure means |
| --- | --- |
| Accepted spans == stored spans | Spans are being lost between the receiver and storage. |
| `trace_summaries.SpanCount` == distinct stored spans | A fold counted a span more than once (retry re-applied a batch) or never counted it. |
| No foreign traces under a tenant | Cross-tenant leakage. |
| A resend does not move `SpanCount` | The ingest dedup gate is not holding. |

The count check is the one that justifies the whole exercise. Four fold
projections accumulate state, so a retried batch can inflate `SpanCount` while
every span is still present and correct. A span count alone cannot see that —
only comparing the projection's own counter against reality can.

Shortfalls are localised across three layers, so a failure points at a
component rather than just "something is wrong":

```
accepted > event_log       -> the span never became an event (ingest)
event_log > stored_spans   -> the map projection dropped it
summary != stored_spans    -> the fold disagrees with reality
```

## What it deliberately does NOT measure

**Capacity.** Read this before quoting any number from it.

The run puts 3 ClickHouse replicas, 3 Keepers, Redis, Postgres, the platform,
and the load driver on a single `ubuntu-latest`: 4 vCPU, 16 GB RAM, 14 GB SSD,
shared with whatever else GitHub is running on that host. The cluster alone
requests ~1.35 vCPU and ~3.75 GiB, leaving roughly 2 vCPU for everything else.

Everything is co-resident and CPU-starved by construction. Throughput and CPU
figures from this workflow measure **contention, not capacity**. They are far
below what the same code does on real hardware and they move run to run for
reasons unrelated to the change under test.

Consequently:

- **Resource figures are informational and never fail the run.**
- **Correctness assertions are the only hard failures.**

### Do not add absolute thresholds

If you add "fail if p95 > X" or "fail if CPU > Y", it will flap on a noisy
shared runner, someone will tire of the red, and the workflow will be disabled
or deleted within a month. This is a well-trodden failure mode for benchmark
jobs and it is why this one is written the way it is.

If you want a regression gate, compare against the `results.json` in the
artifact from a previous run **at the same scale on the same runner size** and
gate on the delta. Never on an absolute number.

## The three stages

| Stage | Shape | What it exercises |
| --- | --- | --- |
| `serial` | One tenant, one long trace, one span per request, no concurrency | The fold hot path and per-aggregate FIFO. Every span hits the same aggregate. |
| `concurrent` | 4 tenants, many traces in flight, interleaved | Dispatch fairness and the per-tenant soft cap. |
| `adversarial` | Bursty, scattered across concurrent arrivals, resends, payloads straddling the offload threshold | The stage most likely to find a real bug. |

### Why the adversarial stage does not send "out-of-order timestamps"

Because it cannot. A client has no control over event ordering here.

The envelope's `occurredAt` is stamped `Date.now()` at ingest
(`trace-request-collection.service.ts`), **not** taken from the span's
`startTimeUnixNano`. Arrival order and `occurredAt` order are therefore
identical by construction no matter what timestamps the payload carries.

Out-of-order folding arises *inside* the pipeline — when spans for one
aggregate are processed concurrently across dispatch shards
(`TRACE_SPAN_PROCESSING_SHARDS > 1`), or when a retry restages a batch behind
newer work. The only lever a load driver has is to maximise that concurrency,
so the stage scatters each trace's spans across many in-flight requests to
contend on the same aggregate.

If you "fix" the driver to sort spans back into order, you remove the
contention and quietly turn the adversarial stage into a second serial stage.

### The two 256 KB thresholds

There are two distinct constants with the same value and different behaviour,
and conflating them produces a benchmark that thinks it tests one path while
testing the other:

- `COMMAND_INLINE_THRESHOLD` (256 KB) — a whole command above this is spooled
  to object storage instead of riding inline through Redis. **Offload.**
- `capOversizedAttributes` (256 KB) — a *single attribute value* above this is
  replaced with a placeholder. **Truncation.**

The driver exercises both: large payloads are chunked across several
attributes to cross the command threshold without tripping truncation, and a
subset deliberately uses one giant attribute to trip truncation instead.

## Workload bounds and why

Default scale ingests roughly **45 MiB** of payload across ~25,000 spans.

**Disk is not the binding constraint**, despite being the scariest number.
ClickHouse stores each row on all three replicas and ZSTD-compresses the heavy
columns, which roughly cancel; the on-disk multiplier lands near 2x. Even at a
pessimistic 6x the default plan stays under 300 MiB. The PVC *requests* total
9 Gi (3x2Gi + 3x1Gi) which looks alarming against a 14 GB disk, but kind's
local-path provisioner backs PVCs with hostPath directories and does not
preallocate — actual usage is actual data written.

**Wall clock is the binding constraint.** On 4 shared vCPU with everything
co-resident, throughput is low and variable, so the plan is sized to finish
comfortably inside the 60-minute job timeout rather than to saturate anything.

The byte budget (`DEFAULT_BYTE_BUDGET`, 512 MiB) is a **safety rail, not the
design target**: someone who raises `-scale` to 20 gets a clear refusal at
planning time instead of a run that dies half way through on a full volume and
teaches them nothing.

Scaling multiplies **trace counts only**. Payload sizes and the large-span
counts are fixed, because they are calibrated against real thresholds and would
stop testing those boundaries if they moved.

## How to read the output

The job summary carries:

1. A caveat header (contention, not capacity) — deliberately duplicated from
   the workflow file, because someone staring at a confusing red run reads the
   summary, not the YAML, and that is the moment they reach for a threshold.
2. A per-stage table: spans accepted, **rejected**, duration, spans/s, peak CPU,
   peak memory, and a correctness verdict.
3. A correctness section naming every violation, grouped by kind and capped at
   10 examples per kind.
4. A per-pod resource breakdown.

**Watch the "rejected" column.** The receiver returns 2xx while reporting drops
in `partialSuccess.rejectedSpans`. All correctness comparisons use *accepted*
spans, never *sent*, so rejections do not show up as phantom data loss — but a
non-zero value means the workload is not landing and the throughput figure is
not what you think it is. A common cause is a plan limit; the driver fails
loudly on `ERR_PLAN_LIMIT` rather than quietly measuring the rate limiter.

Raw samples and `results.json` are in the `ingestion-benchmark-samples`
artifact, retained 30 days. `results.json` is the baseline for the next run's
delta comparison.

## Running it

### In CI

- **Manual:** Actions → `event-sourcing-ingestion-benchmark` → Run workflow.
  Every knob the local driver takes is exposed as an input, so a run can be
  shaped from the form without editing the workflow:

  | Input | Default | What it changes |
  |---|---|---|
  | `runner` | `ubuntu-latest` | The box. The only way to get capacity-shaped rather than contention-shaped numbers. |
  | `scale` | `1` | Workload multiplier — trace counts only; payload sizes are fixed. |
  | `seed` | `1337` | PRNG seed. Reuse a failing run's seed to replay its exact span stream. |
  | `tenants` | `4` | How many tenants to seed. Minimum 2 — cross-tenant isolation is unobservable with one. |
  | `settle_timeout` | `3m` | How long each stage waits for the pipeline to drain, as a Go duration. Raise it when a bigger `scale` outruns a small runner. |

  A timeout from `settle_timeout` means the run is **inconclusive**, not
  that the code is wrong — the same distinction the resource numbers get.
- **On a PR:** requires **both** a path match (`event-sourcing/**`,
  `charts/clickhouse-serverless/**`, the driver, or the workflow) **and** the
  `benchmark` label. Both conditions, deliberately — this is expensive and
  should be rare. Adding the label to an open PR triggers a run without needing
  an empty push.

### Locally

You need Postgres, Redis, and a ClickHouse (a single replica is fine for
driver development — you lose the replication topology but the correctness
assertions all still run).

```bash
make quickstart all-local

go build -o /tmp/ingestionbench ./cmd/ingestionbench

# Seed at least two projects; cross-tenant isolation needs more than one.
# stdout is only the tenants JSON, so it can be captured directly.
TENANTS=$(DATABASE_URL="$DATABASE_URL" /tmp/ingestionbench seed -count 4)

/tmp/ingestionbench run \
  -endpoint http://localhost:5560 \
  -clickhouse "$CLICKHOUSE_URL" \
  -tenants "$TENANTS" \
  -scale 0.1 \
  -out /tmp/ingestion-benchmark
```

Use a small `-scale` locally. Reuse a failing run's `-seed` to replay the
exact same span stream — payload generation is fully deterministic, and the
PRNG is bit-identical across runs.

Exit codes are distinct on purpose: **0** passed, **1** found a correctness
violation (the pipeline is wrong, go look), **2** could not run at all
(misconfigured, or ClickHouse unreachable — says nothing about the code under
test). Do not collapse 1 and 2; a run that never happened is not a green run.

The pure core — load generation, the correctness rules, and the reporting —
has unit tests that need no infrastructure:

```bash
go test ./tools/ingestionbench/...
```

## Moving to a larger runner

One line. Dispatch the workflow with the `runner` input set to your larger
label (for example `ubuntu-latest-16-cores`), or change the default:

```yaml
runs-on: ${{ inputs.runner || 'ubuntu-latest' }}
```

Raise `-scale` alongside it — the workload is sized for a 4-vCPU box and will
not stress a bigger one at the default. On a runner with dedicated cores the
figures start to mean something closer to capacity, but they are still a
single-node cluster and still not production.

## Files

| Path | Role |
| --- | --- |
| `workload.ts` | Stage plans, byte budgeting, threshold constants. Pure. |
| `otlp.ts` | Deterministic OTLP payload construction. Pure. |
| `verify.ts` | ClickHouse query builders and violation logic. Pure. |
| `report.ts` | Markdown job-summary rendering. Pure. |
| `run.ts` | The impure driver: HTTP, ClickHouse, clocks, argv. |
| `seed-tenants.ts` | Seeds isolated projects, prints them as JSON. |

The split is deliberate: everything with a decision in it is pure and
unit-tested, so the parts that can be verified without a cluster are verified
without a cluster. Anything added to `run.ts` that has logic in it belongs in
one of the pure modules instead.
