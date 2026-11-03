# Trace review: one module for browsing traces with their evaluation results

Status: planned (Alex, 2026-10-16). Step 1 lands in PR #8561; the module split is its own PR, with
an ADR. Raised by the id indexes (`dev/docs/plans/id-index-2026-10-10.md`): evaluation's
`evaluation_runs_by_trace_id_index` is registered by evaluation, so trace's direct reads of
`evaluation_runs` cannot use it.

## Today

```text
evaluation ──calls──► trace                 (execution inputs: spans, events, content, renderers,
     ▲                  │                     protections, summaries; and readEvaluations)
     │                  │ reads evaluation_runs directly (allowed by name in the table-sharing
     └── own results ───┘ policy, clickhouse-table-ownership.ts; ARCHITECTURE.md §7)
         come back via TraceApi.readEvaluations
```

- Trace declares no `EvaluationApi` dependency; calling it would make a two-way dependency.
- Trace holds four query families over `evaluation_runs`: list summaries
  (`trace-evaluation-runs.repository.ts` `findSummariesByTraceIds`), run details (`queryRuns`, a
  7-day window), drawer and legacy arrays (`queryTraceEvaluations`, unbounded), and the legacy
  projected read (`trace-legacy-read.repository.ts` `fetchEvaluationRows`). Facets, evaluator
  suggestions and search predicates also read the table; those are time-windowed, mixed queries.
- Facts already flow the right way: trace's span, origin and collector facts reach evaluation's
  peer subscribers.
- Neighbours: evaluation → analytics → trace; automation calls both owners; evaluator is its own
  module, which both depend on; there is no evaluation browser package.

## Who owns what, by product

| Customer's task                                       | Owner                               |
| ----------------------------------------------------- | ----------------------------------- |
| Capture and retrieve what an agent did                | trace                               |
| Define how quality is judged                          | evaluator                           |
| Choose which live traffic is evaluated                | monitor                             |
| Run a judge and record its outcome                    | evaluation                          |
| Browse traces, compare scores, inspect a failure      | trace-review                        |
| Plot quality over time / act on conditions / feedback | analytics / automation / annotation |

## Design: trace-review above both owners

```text
trace-review ──► evaluation ──► trace
      └────────────────────────► trace
```

- Tables, indexes, fill steps and events stay where they are.
- Evaluation owns every plain read of `evaluation_runs` (run details, drawer arrays, list
  summaries, the legacy batch read), each bounded by `evaluation_runs_by_trace_id_index`, keeping
  today's read when the index is not ready or misses.
- trace-review owns the combined trace list and drawer (browser, endpoints, display shapes) and
  calls both Apis. Trace never forwards to trace-review (that would loop back through evaluation).
- Mixed search and facet SQL stays in trace as named shared-read exceptions: it must filter before
  paging.
- `deriveEvaluatorId` moves to evaluator's contract, so trace stops importing evaluation for it.

Rejected: an evaluation-result module below both (splits execution from its run lifecycle and
needs a delicate eventing handover); a trace-side copy of results (a second stored copy, and a
contract loop while evaluation imports trace).

## Steps

1. Evaluation reads its own results by trace id through the index, and stops calling
   `TraceApi.readEvaluations` (PR #8561).
2. Evaluation exposes authorised run, detail and summary reads by trace.
3. trace-review: move the drawer and its combined endpoints; then list enrichment; then the legacy
   combined reads. Record the URL, response-shape, permission and tRPC namespace decisions in an
   ADR first.
4. Delete trace's displaced repositories and the evaluation-only `TraceApi` operations; narrow the
   table-sharing exception to the mixed SQL that remains.
