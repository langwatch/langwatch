# ADR-004: Stock widget queries read typed columns, never a map, and hash only the small side

**Date:** 2026-11-11

**Status:** Accepted

## Context

On a project with about 2M traces a month, 39 of the 210 stock widget queries ran out of memory
(code 241, 1 GB per query) over 30 days. Every LangWatchQL view reads its table with `FINAL`,
which merges the raw columns a query reads. A query that reads one key of `Attributes`,
`SpanAttributes` or `ResourceAttributes` therefore carries the whole map, captured content
included, through that merge, whatever key it names. Scalar reads of the same views pass
(`satisfaction-shift`, `ck-attention/step`). The other cause was a join whose hashed side holds
every trace or every span of the period: an evaluation row joined to 60 days of `trace_metrics`,
or a span joined to every span to find its parent.

PR 9439 (goose 00126) gave `trace_analytics` nine metadata columns and moved 15 queries onto
`trace_metrics` (tasks#1117). This decision covers the rest.

## Decision

1. A stock widget query reads no map. The value it needs is a typed column: an existing one on
   `trace_metrics` or `evaluation_metrics`, or one the trace module's projections write (ADR-006):
   `MetadataOutcomeReason`, `MetadataPromptVersion` and `MetadataEnvironment` on `trace_analytics`,
   written by its fold; `SpanType`, `ErrorType`, `RagContextCount` and `DeploymentEnvironment`
   on `span_analytics`, which the `span_metrics` view exposes and the span widgets read in place
   of `spans`. The analytics views expose no captured content, not even a hash of it (#6856), so
   the loop widgets still compare `CapturedInput` on the gated `spans` view, as on main.
2. A join hashes its small side: per-trace evaluation counts, the outcome judge's verdicts, or
   the parents of failed spans. The period's trace or span rows stream past it.
3. An id set (`IN`, `NOT IN`) holds a bounded population: the traces that send a metadata prompt
   version, the children of top-level spans, the at most 20 example traces whose input
   `ck-top-ask` shows. `CapturedInput` is read from `traces` only for those examples, where the
   primary key skips every other trace.
4. A managed prompt version (`LastUsedPromptVersionId`) is a fold column of `trace_summaries`
   only, so it is read from `traces` as a plain column; the metadata version comes from
   `trace_metrics`. A trace counts under one of them, as before.
5. No step holds a per-trace set over the whole window. `firstTraceMetricsRow` (an `IN` over
   every trace of two periods) ran 11 of these queries out of memory on prod, so where a trace
   counts once the query groups by trace only after the join to its small side: the closed
   traces (sent or judged outcome), the judged traces, or the field checks, taking `min` and
   `argMin` of the trace rows. The 9439 queries that passed keep `firstTraceMetricsRow`.
6. The outcome judge's label for the answer and topic widgets comes from `evaluation_metrics`,
   which carries the source, so no read builds the `evaluations` source filter (an `IN` over every
   trace of the window). Only the widgets that show the judge's free text read `evaluations`.

7. The last three at-risk queries (2026-11-11) hold no join's worth of raw rows. `noise/sources`
   groups spans and trace rows together per trace, with no join and no per-trace set over the
   window, on fixed-size states: the trace's source is a list position packed under its first
   row's time, and it counts traces with `count()` since each appears once. `up-where-fails` and
   `tools-error-rate` count calls per step in one pass, look only failed calls' parents up (the
   failed calls are the hashed side), and find lone top-level spans with a `NOT IN` over 128-bit
   span keys. The attribution widgets read `evaluation_metrics` through its floored twin (ADR-005)
   and key their per-trace join and grouping by `sipHash128(TraceId)`; `att-change` reads the
   managed prompt version beside the trace rows instead of joining it. The prompt-version
   widgets (`att-change`, `ck-trend/changes`, `ext-cost-per-doc/changes`) keep a metadata
   version ahead of a managed one with a `NOT IN` over `cityHash64(TraceId)`: as id strings the
   set held 3.5M traces and ran out of memory at 1 GB (ADR-006 Measurements). `cityHash64` joins
   `sipHash128` on the validator's function allow-list for it.

8. The five span queries still over 1 GB or 60 s at 60 days (2026-11-12, round 17) run their heavy
   parts one after another. Each span read builds its own source-filter set, and parts run side by
   side passed the cap that each stays under alone, so `gatheredRows`
   (`templates/model/lwql-gathered.ts`) runs a part as a scalar subquery, which ClickHouse runs to
   the end before the rest, and unrolls its rows. `up-loops` gathers the candidate loop calls (tool
   spans whose name repeats 3 times in the trace, input hashed with `sipHash128`) before grouping
   them, and each of loops and retries before the union. Retries read only the groups holding a
   failed call, found by a `cityHash64` set (a group a collision lets in holds no failed call, so
   its `HAVING` drops it), and group by a `sipHash128` key. Main's `LIMIT 10000` on each kind had no
   `ORDER BY`, so which repeats it kept was arbitrary: it is removed, and every repeat counts.
   `up-where-fails` and `tools-error-rate` find lone top-level spans with one grouping by parent key
   in place of the `NOT IN` of decision 7. `cost-waste` groups trace rows and span groups together
   per trace instead of joining them, carrying each trace's `trace_metrics` row count so the join's
   per-row counting stays exact, groups only tool spans by name, and keys both groupings by
   `sipHash128`. `voice-call-health` gathers its speech traces and the failed repeat checks before
   grouping calls. A gathered column must not alias a view's floor column, which keeps that view's
   reads unfloored (ADR-005). Each returns the rows the previous form returned on an 8 GB user
   (main's `up-loops` without its cap), 3 runs at 30 and 60 days on the proof dataset, ClickHouse
   26.8.36.3.

## Consequences

- The numbers stay those of the `traces` and `spans` forms, except: a `metadata.*` value longer
  than 4096 characters is cut by the trace_analytics trim; traces with no `trace_analytics` row
  are not counted (ADR-003); in the step widgets (`up-where-fails`, `tools-error-rate`) a call
  whose parent span is not stored in the window now counts as a call, its failure as not
  recovered, where before it was dropped; `ck-top-ask`'s example is the input of the trace it
  links, where before the two were picked apart. A trace with two `trace_metrics` rows (its
  anchor moved before the freeze, ADR-071) counts at its first row inside the window, so one
  that began before the period counts in it; `ans-topics` counts its rows, not the trace, for
  requests and checks. The judge's label is dated by when it finished, not when it was scheduled.
  `noise/sources` dates a trace by its first row inside the period, so one that began before the
  period counts in it, as above. Keys hashed to 128 bits (`sipHash128` of a trace id, a span key or
  an evaluation key) merge two rows only on a 128-bit collision. The prompt-version sets hash to
  64 bits (`cityHash64`): a collision there drops a trace's managed prompt version, which can
  move that version's first-seen time only if the dropped trace was its earliest.
- **Concurrency at the 60 s limit.** The profile allows 10 queries at once per ClickHouse user
  (`max_concurrent_queries_for_user`), and each process holds at most 10 LangWatchQL sockets. A
  few boards of slow widgets can hold all 10 for up to 60 s, so the next run is refused with
  ClickHouse code 202 or waits for a socket. That is unchanged here, and not yet measured.
- 21 of the 39 rewrites read only columns that exist today and can be measured on prod before a
  deploy; 18 need goose 00128 and the two projection replays of ADR-006 first. Until a replay
  finishes, older rows hold '' or 0 in the new columns, and `span_metrics` holds no older spans.
