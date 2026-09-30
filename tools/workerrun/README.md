# workerrun

Proves the worker does its job under load. It fires commands through the public API at
one haven stack, then proves each one was processed: read back by id, the queues back to
their depth before the load, and no error signature in the stack's log that names this run.

```bash
go build -o .bin/workerrun/workerrun ./cmd/workerrun
.bin/workerrun/workerrun -stack visualdiff-check -n 100 -concurrency 16
.bin/diffsuite/diffsuite -continuous -stack visualdiff-check -out .claude/tmp/runs/live -tools api,fuzzapi,visual,fuzzui,worker
```

It talks to `https://app.<slug>.langwatch.localhost/api` only, with its own `workerrun`
organisation seeded like the fuzzer's (diffkit `SeedToolOrg`, recorded under
`.claude/tmp/workerrun/`). Under diffsuite it takes the branch stack from `DIFFSUITE_BRANCH_*`.

## Families

Each fires `-n` items. Ids are stable across runs (`collector-0007`); the wire ids carry a
per-run tag, so a run never reads back an earlier run's data. `-seed` fixes the fire order
and each item's variant.

| family | fires | proven by | worker path |
|---|---|---|---|
| otlp | `POST /api/otel/v1/traces`, 1-5 spans | `GET /api/traces/{id}` has the input | trace_processing |
| collector | `POST /api/collector`, 2 spans; 5% 256 KiB input, 10% inline image | `GET /api/traces/{id}` has the answer | trace_processing |
| evaluation | collector trace with an SDK evaluation, half guardrails | the evaluation reads back `processed` on the trace | custom-evaluation sync → evaluation_processing |
| monitor | an evaluator + monitor (`langevals/basic`); the collector traces | each collector trace gets the monitor's evaluation, terminal status | evaluationTrigger → evaluation_processing |
| annotation | `POST /api/annotations/trace/{id}` on each collector trace | `GET /api/annotations/trace/{id}` has the comment | trace_processing `addAnnotation` (not readable: see below) |
| scenario | `POST /api/scenario-events` started + finished | `GET /api/simulation-runs/{id}` says `SUCCESS` | simulation_processing |
| batch | `POST /api/evaluations/batch/log_results`, 1-8 rows | the run is listed by `GET /api/experiments/runs?experimentSlug=` | experiment_run_processing |
| automation | a dataset + `ADD_TO_DATASET` trigger on a run label; labelled OTLP traces with an explicit origin (the collector stamps none, so its traces wait 5 min for the fallback) | each trace id is a row of the dataset | triggerMatch → automations |
| analytics | nothing more | `POST /api/analytics/timeseries` counts every collector trace fired | trace rollup projection |

The first half fires as fast as `-concurrency` allows (burst), the rest at `-steady-rate`
a second. Read-back runs alongside, a round at most every 2 s, so lag has that resolution.
An item unproven `-deadline` after it was fired fails by its id. `monitor` is skipped, and
says so, when haven reports langevals not running (`diffsuite -up -langevals` has it).
Setups (evaluator, monitor, dataset, trigger) are deleted at the end.

## Drain, health, logs

- **Drain:** `ops.getDashboardSnapshot`, read as the seeded admin (the stack's operator).
  The worker's metrics writer keeps it fresh; a snapshot over a minute old is refused. Each
  pipeline the chosen families use must get back to its pending depth before the load within
  `-drain`; more blocked groups or dead letters than before fail too. The worker's own port
  answers only `/healthz`: `/metrics` exists only with `LANGWATCH_METRICS_MODE=prometheus`.
- **Health:** `GET /api/health` every 2 s; a probe over 2 s or failing is a stall, a 502 from
  the router is its own finding, as is any 502 to this run's own requests.
- **Logs:** the stack's `api.log` (api and worker share the process), from its size at the
  start, rotation followed. Error and fatal lines group by diffkit's normalised signature
  (`log-<hash>`, stable across runs). `-log-scope ours` (default) fails only on signatures
  with a line naming this run's project, org or tag, since other tools share the log; `all`
  fails on every one. Every signature is in `summary.json` either way.

## Output

- `FAIL <id> (<family>, <why>)` per failing id, `family <name>: pass|fail ...` per family,
  then `worker: N checked: P pass, F fail`, the line diffsuite tallies.
- `<run-dir>/summary.json`: per family the landed and missing ids and p50/p95/max lag, the
  drain samples, health, signatures, the failing ids, and `new`/`fixed` against the newest
  earlier `summary.json` beside the run (diffsuite's previous iteration, or a sibling run).
- Exit 0 all proven, 1 a failure, 2 usage, 3 stopped in setup (`stopping: setup failed: ...`).
