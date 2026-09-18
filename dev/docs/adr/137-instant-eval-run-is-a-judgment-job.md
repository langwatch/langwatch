# ADR-137: An Instant Eval run is a judgment job over the same statement, not a monitor run

**Date:** 2026-09-18

**Status:** Accepted

**Builds on:** [ADR-136](136-lwql-app-functions-identity-udfs.md): the eval
functions and the hydration stage a run executes are that ADR's, unchanged. The
run adds no way to judge anything; it adds paging, progress and a place to keep
the answers.
[ADR-052](052-builder-mounted-process-managers.md): the loop is a
builder-mounted process manager, so the topology is declared beside the
pipeline and the shared runtime owns the manager, the outbox and the wake.
[ADR-045](045-domain-errors-handled-boundary.md): every refusal below is a
`HandledError` with a stable code and customer-facing copy.

**Related:**
[ADR-084](084-lwql-postgres-mapping-tenant-predicate.md) (the submitted
statement is never rewritten; §2 is how a job pages without breaking that),
[ADR-051](051-topic-clustering-projection.md) (the paging pipeline this copies),
[ADR-022](022-event-log-source-of-truth.md) (the event log the run folds its
counters from).

**Amended 2026-09-18:** the run row moved from a Prisma model to a ClickHouse
replacing table (§5), the `Cost` row was replaced by the
`InstantEvalSpendRecorder` port (§8), and the classifier limiter counts tokens
rather than requests (§9).

**Behavioural contract:**
[specs/instant-evals/instant-eval-api.feature](../../../specs/instant-evals/instant-eval-api.feature),
[specs/instant-evals/instant-eval-pipeline.feature](../../../specs/instant-evals/instant-eval-pipeline.feature),
[specs/instant-evals/instant-eval-cost.feature](../../../specs/instant-evals/instant-eval-cost.feature),
[specs/analytics/lwql-judgments-view.feature](../../../specs/analytics/lwql-judgments-view.feature),
[specs/instant-evals/instant-eval-shorthand.feature](../../../specs/instant-evals/instant-eval-shorthand.feature),
[specs/features/instant-eval-cli.feature](../../../specs/features/instant-eval-cli.feature).

## Context

ADR-136 made a judged column an ordinary part of a LangWatchQL projection, and
`POST /api/v1/query` runs one inline: a thousand texts, about ten seconds, one
cost row. That is the exploratory loop, and it is bounded by the key cap on
purpose, because a caller is waiting for it.

The question customers actually arrive with is bigger than the loop. "Which
conversations this quarter had an annoyed customer" is a hundred thousand rows,
seventeen minutes of the platform's classifier budget, and an answer somebody
wants to come back to. Nothing about the judging changes at that size; what
changes is that the request cannot be held open, the work has to survive a pod
dying, the answers have to be somewhere they can be queried again, and the
caller has to be able to see how far it has got and stop it.

The obvious place to put it was the monitor machinery, and that was the first
thing we rejected.

## Decision

### 1. The run is its own resource, not a monitor run

`evaluation_runs` holds one evaluator per row with no probability, no question
id and no job grouping, and a monitor runs through the customer's own model
provider. A run asks several questions of one text in one request, records a
calibrated probability, belongs to a job with a total and a progress, and runs
on the platform's own key. Four mismatches, each of which would mean a column or
a nullable field on a table that every trace's evaluations already write to.

So: one ClickHouse row per run in `instant_eval_runs` for the state a caller
polls, and one ClickHouse row per verdict in `instant_eval_judgments`. The run
row was a Prisma model in the first draft of this change and moved before the
change shipped: the judgements it explains are in ClickHouse, the experiment
run it is modelled on keeps its state in ClickHouse (`experiment_runs`), and a
row a worker rewrites once per page has no reason to sit in the transactional
store beside the project. An opt-in mirror into `evaluation_runs`, so the
existing `evaluations.passed` and `evaluations.label` trace filters work over a
run's results, is a later change and is not in this one.

### 2. The input is the same statement, wrapped rather than rewritten

A run takes a LangWatchQL statement, the same one the synchronous endpoint runs.
It must project `TraceId` and at least one eval function, checked on a `LIMIT 0`
probe rather than by parsing, because a column list is the database's answer and
not ours.

LangWatchQL never rewrites a submitted statement and a bound scenario holds it
to that. A job cannot honour that literally and still page, so the line is drawn
at **composition**: the caller's text goes inside a subquery, character for
character, and the wrapper only decides which of its rows come back. Four
wrappers, in `app-layer/instant-evals/run/composition.ts`:

| Pass | Shape | What it is for |
|---|---|---|
| probe | `SELECT * FROM (<sql>) AS q LIMIT 0` | what the statement projects, reading no rows and judging nothing |
| count | `SELECT count() FROM (SELECT q.TraceId FROM (<sql>) AS q LIMIT limit+1) AS c` | the run's total, bounded one past its limit |
| keys | `SELECT q.TraceId … FROM (<sql>) AS q [WHERE <order> > {after}] ORDER BY <order> LIMIT n` | one page of row keys |
| page | `SELECT * FROM (<sql>) AS q WHERE q.TraceId IN ({page_ids}) ORDER BY q.TraceId` | the rows of one page, where the extraction and eval functions hydrate |

`/api/v1/query` still runs the text verbatim; only this surface wraps it, which
is why the wrapping lives on the run and not in the query service.

The total is a **count**, not a key pass read to its end. The executor applies
an eight-megabyte result ceiling after the rows arrive and truncates rather
than refusing, so reading a hundred thousand keys to learn a run's size
returns a shorter list with a `truncated` flag: the run would report a smaller
total, call itself uncapped, and finish early looking successful. Every read
this surface performs now treats `truncated` as an error, because in each of
them the length of the answer is part of the answer.

Paging orders by `TraceId`, and by `(TraceId, SpanId)` when the statement
projects `SpanId`. `TraceId` is the one column a run requires, so it is always
available, but it is not always unique: a statement over `analytics.spans`
projects one row per span, and ordering by the trace alone would cut a trace's
span rows across a page boundary while the next page, starting at `TraceId >
cursor`, skipped the rest of them. The cursor therefore carries both halves,
and the judgement row is keyed by `(TenantId, RunId, TraceId, SpanId,
QuestionId)` so the spans of one trace are separate judgements rather than one
collapsed row. A statement with one row per trace writes the empty string
there, which keys it exactly as it would have been keyed without the column.

The page pass predicate stays on `TraceId` alone, because a tuple bound as a
query parameter is not a shape the driver serialises reliably. A trace whose
spans straddle the page boundary therefore returns rows the page does not own,
and they are dropped by matching the pair before anything is judged, so a row
the page does not own is never paid for. The over-fetch is bounded by the
page's own row ceiling, past which the read is refused rather than truncated.

Page *n* covers the same keys whoever runs it, which is what makes a
redelivery safe rather than merely harmless, **provided the inner statement is
deterministic**. One carrying `LIMIT n` with no `ORDER BY` is not: ClickHouse
may return a different n rows per execution, and the statement is executed once
per count and twice per page. Such a statement is accepted, because refusing it
would refuse a legitimate exploratory query, but its pages are not guaranteed
to tile one fixed candidate set. The docs and the shorthand templates say to
add an `ORDER BY` to a statement with a `LIMIT`.

The statement's own key columns, `ThreadId`, `SpanId`, `OccurredAt`, are
carried onto the judgements when it projects them and left empty when it does
not, because a statement grouped by conversation has no span and naming an
absent column in the wrapper would refuse the run for a column the caller
never promised.

Three parameter names belong to the run (`instant_eval_page_ids`,
`instant_eval_after_trace_id`, `instant_eval_after_span_id`) and a statement or
a request naming any of them is refused; so are the dashboard's own period
parameters, which a job has no surface to fill.

### 3. The loop is events driving intents, not a long-lived handler

One process manager instance per run, keyed by the run id, so a run's pages
serialize while different runs proceed in parallel:

```
requested  -> plan
planned    -> judge page 1
page_judged, more to do -> judge page n + 1
page_judged with nothing left, or a cancellation, or a stall -> finish
```

There is no progress channel and there does not need to be one: a judged page IS
the progress report, and the run's row is folded from those events. It is also
what makes the job resumable, because the next delivery starts from the cursor
the last recorded page ended on rather than from wherever a dying pod was.

Cancellation is a Redis key the next page reads, plus the recorded
`cancel_requested` event and a two-minute grace wake behind it. A key rather
than a pub/sub message because a run's next page may be dispatched to a pod that
was not listening when the message went out. The key is a hint and never the
record: a deployment whose Redis is unreachable stops one page later.

A fifteen-minute stall wake catches what no retry covers, a pod that died
holding the lease, and records the stall as a durable outcome rather than
deriving it at read time, so a run that stopped says so instead of reading as
still running.

### 4. A page's events carry counts; its verdicts are written by the page itself

`page_judged` carries ids and numbers: rows, matches per question, failures,
skips, tokens, the cursor, and whether more follows. A hundred thousand rows
with three questions is a couple of hundred events rather than three hundred
thousand.

That means the verdicts are NOT written by a map projection, and the reason is
mechanical: one judged page becomes up to fifteen hundred ClickHouse rows and a
map projection is one record per event by contract. The page's own intent writes
them, before it records the page as judged.

What replaces the projection's guarantee is the key. A judgement is keyed
`(TenantId, RunId, TraceId, QuestionId)` in a `ReplacingMergeTree`, so the same
page judged twice re-inserts the same rows rather than doubling them, and a
crash between the write and the record costs a redelivery. A page that lost more
than half of its judgements to a judge that was reachable and did not answer is
thrown BEFORE the write, so the retry is the only thing that records it. A
deliberate skip is not a failure by that rule, which is what keeps a deployment
with no classifier configured from redelivering every page forever.

### 5. The run's row has two writers, with a line between them

The service writes the definition once, when it accepts the run, so a caller can
read the run back the instant they are handed its id rather than when a worker
catches up. The state projection writes the counters and its own checkpoint, and
never touches the definition, so a replay rebuilds what the run found without
rewriting what it was asked.

`instant_eval_runs` is a `ReplacingMergeTree` keyed by `(TenantId, RunId)`,
exactly as `experiment_runs` is, so every write is a whole row and the latest
version wins. That shapes the projection's write: it reads the row the service
wrote, lays the counters and the checkpoint over it, and inserts the whole row
again. A run somebody deleted has no row to read, so the write is a no-op and
the run stops rather than reappearing, which is what the Prisma draft's
`updateMany` gave.

The version column is `WrittenAt`, the writer's clock at the insert, not the
business `UpdatedAt`. The run's `requested` event carries the service's own
`now`, taken before the row was inserted, so a projection write versioned by
the event's time would lose the merge to the definition row and the counters
would never show. A write clock is monotone across both writers, which is the
one property the merge needs; `UpdatedAt` stays the business time the wire
reports. Every read collapses to the latest `WrittenAt` through the IN-tuple
pattern, because the merge is eventual.

The table is not time-partitioned. It holds one row per run, a running run is
polled by its key every few seconds, and a project's runs are listed with no
time bound, so a partition would turn every one of those reads into a scan
across every partition and a flagged cold scan. It keeps the indefinite
retention default its judgements keep, since a run deleted on a timer would
leave verdicts nothing explains.

### 6. No judged text, and no token count, is kept on a judgement

A verdict is a probability, a score or a label. The text it was formed from lives
in the trace it came from, and the sample endpoint re-reads it through the
statement's own extraction functions, judging nothing, so reading what a run
judged is free. Keeping a copy would duplicate customer content into a table with
its own retention and its own row policy.

There is no per-judgement token count either, and that is not an omission. One
classifier request answers every question about one text, and one text can be a
whole conversation covering many traces, so a per-trace-per-question count would
be the same number copied across rows that did not each cost it. What a run spent
is a property of the run, and the run's row carries it.

### 7. The answers are a dataset, so the follow-up question is SQL

`analytics.judgments` is the only dataset in the LangWatchQL catalog with no
content gate, and that is a property of what it holds rather than an omission:
there is nothing for the input or output permission to withhold. It is also the
only dataset the caller caused to exist. Joining it back to `traces` on the
tenant and the trace id is what makes "count the labels of that run" ordinary
SQL rather than a second product surface.

### 8. Caps now, metering later

Ten thousand rows on every plan, up to a hundred thousand on a paid one, asked
for with a parameter and refused with `instant_eval_row_cap_exceeded` naming
both numbers. The default is the same everywhere on purpose: ten thousand
conversations is a real answer to a real question and costs a quarter of a
dollar at the shipped rate, so a customer can find out whether the feature
works without buying anything first.

One spend record per run at finish, and one per synchronous query, through the
`InstantEvalSpendRecorder` port
(`app-layer/instant-evals/instant-eval-spend.recorder.ts`): the project, the
run when there is one, the input tokens, the requests, our cost, the customer's
price and when it happened. The recorder that meters it against the customer's
budget belongs to the gateway spend pipeline and binds there; the default
binding logs the record and meters nothing. The first draft wrote a `Cost` row
in Postgres instead, and it was dropped before shipping because the spend
pipeline is where every other metered spend already lands and a second ledger
would have to be reconciled against it. The cost and the price also stay on the
run's own row, so `status` and `results` show them without a ledger read.

### 9. The classifier is paced in tokens, not requests

The classifier's ceiling is token-bound: the September 2026 bench sustained
about 315k input tokens a second whether that was five hundred small
conversations or ten large ones. The shared Redis bucket from ADR-136 therefore
holds input tokens, refilled at `INSTANT_EVAL_GLOBAL_TOKENS_PER_SECOND`
(default 300,000) with two seconds of burst, and every classification takes its
estimated input tokens, text plus questions, the same estimate the token budget
sizes the request with. A second bucket per tenant, refilled at
`INSTANT_EVAL_TENANT_TOKENS_PER_SECOND` (default half the global rate), is one
project's share of the ceiling, so a hundred-thousand-row run cannot hold every
other project's synchronous query behind it. Both buckets are debited in one
Lua call or neither is. The local fallback for an unreachable Redis is in
tokens too.

With the bucket as the governor, the in-flight ceiling only has to be high
enough that the bucket, not the number of open requests, is what a page waits
on. It is 128 for both the synchronous path and a run's page; at about 250 ms a
call, thirty-two in flight could never have reached the bucket's rate.

## Amendment (2026-09-18): the target shorthand writes the statement

The run's input stays one LangWatchQL statement. A request may instead carry a
**shorthand**: a `target`, an optional trace `filter`, an optional window, and
the `questions` to ask of each row. The server expands it into one statement
from a template per target, and that statement then goes through the same
acceptance gate a submitted one does. Everything after the expansion is
unchanged: the run stores the statement, derives its questions from the eval
functions the statement projects, pages it, and hands it back as `sql`.

A request carrying both `sql` and `target` is refused 422
`instant_eval_query_invalid`, and so is one carrying neither. A shorthand
carrying `parameters` is refused too: the expansion writes the statement's
parameters, so there is none of the caller's left to fill.

### The three templates

| Target | View | Text | Addressed by |
|---|---|---|---|
| `traces` | `analytics.traces` | `llm_readable_trace(TraceId, 8000)` | the trace |
| `threads` | `analytics.trace_metrics` grouped by `ConversationId` | `conversation_bounded(ConversationId, 8000, '')` | `argMax(TraceId, OccurredAt)` |
| `llm_spans` | `analytics.spans` where the span type is `llm` | `llm_messages_span(TraceId, SpanId)` | the trace and span pair |

Each projects `TraceId`, whatever optional key columns the target has
(`ThreadId`, `SpanId`, `OccurredAt`), and one eval column per question aliased
to the question's own name. The `threads` template qualifies every reference
with a table alias, because its projection reuses two of the view's own column
names and an unqualified `max(OccurredAt) AS OccurredAt` is an alias shadowing
the column it reads.

The window is resolved once, at expansion, and bound as two `DateTime`
parameters. A window written as `subtractDays(now(), 7)` would move between the
count and the pages, so the keyset pages would tile a selection that was never
the one counted.

The budget written into the bounded extraction calls is 8,000 tokens, the
default the function catalog documents, or whatever the questions leave of the
classifier's state when that is less. The ceiling is a cost decision rather
than a technical one: the cost study puts a typical product trace well under
8,000 and a coding session at many times it, so cutting at the classifier's
own 31,000 would quadruple the price of exactly the rows least worth reading in
full. A caller who wants the whole thing writes the statement.

### The filter is compiled, not resolved into ids

`--filter` speaks the traces-v2 filter language, and its existing compiler
(`translateFilterToClickHouse`) cannot be reused here. That compiler targets
the base tables, with partition-pruned subqueries over `stored_spans`,
`evaluation_runs` and `simulation_runs`, and binds `{tenantId:String}` itself.
A statement runs against the LangWatchQL views under a restricted identity that
cannot see any of those tables and needs no bound tenant, because the row policy
is what scopes it. Inlining that SQL would produce a statement the query policy
refuses on the first table name.

Resolving the filter into a list of trace ids and binding them was the
alternative the plan carried, and it is worse in three ways: a hundred thousand
ids is about three and a half megabytes of statement or of parameter, the run's
parameters are scalars by contract, and the statement handed back would no
longer be one a caller could rerun, which is the whole point of handing it
back.

So there is a second dialect, `app-layer/instant-evals/shorthand/filter.ts`,
over the LangWatchQL trace view. The language's boolean structure is shared
with the trace compiler through `translateFilterAst`; only the per-tag
compilation differs. It answers about half the filter language:

- Direct columns and attribute lookups: `traceId`, `traceName`, `service`,
  `origin`, `user`, `customer`, `conversation`, `scenarioRun`, `topic`,
  `subtopic`, `selectedPrompt`, `lastUsedPrompt`, `tokensEstimated`.
- Numeric comparisons: `cost`, `duration`, `tokens`, `promptTokens`,
  `completionTokens`, `tokensPerSecond`, `ttft`, `ttlt`, `spans`,
  `promptVersion`.
- List membership: `model` (with `*` wildcards), `label`.
- `trace.attribute.<key>`, and a bare word over the captured input, the
  captured output and the trace name.
- `status`, for the value `error` only. Telling `ok` from `warning` needs the
  guardrail column, which the view does not carry, so the two values it would
  have to guess at are refused.

Every other field the explorer filters on reaches outside the trace row, and a
shorthand refuses it BY NAME with the statement door named as the way to ask
it. A refusal that names the field costs the caller one more line; a shorthand
that silently dropped a condition would charge them for judging rows they meant
to exclude. A unit test asserts each supported field's expression still equals
the facet registry's own, so the two surfaces cannot answer the same field
differently.

Over `traces` the compiled filter is a condition in the statement's own WHERE.
Over the other two targets it is a `TraceId IN (SELECT TraceId FROM
analytics.traces WHERE ...)` subquery bounding its own time column, because
neither the metrics view nor the span view carries the trace's attributes: a
conversation is kept when any of its traces matches, and a model call when its
trace matches.

### The questions become eval calls

A shorthand question is `{id?, kind, instructions, criteria?, threshold?,
range?, options?}`, the same vocabulary the `llm_*` evaluators use plus a
threshold, because the judge answers a probability and the line between yes and
no is the caller's. Each becomes one eval call:

| Question | Call |
|---|---|
| boolean | `eval(text, instructions)` |
| boolean with two criteria | `eval_criteria(text, instructions, [yes, no])` |
| boolean with a threshold | `eval_passed(text, instructions, threshold)` |
| score | `eval_score(text, instructions, min, max)` |
| category | `eval_category(text, instructions, ['name: meaning', ...])` |

Criteria and a threshold together are refused, naming both forms. There is no
function taking both, because a ClickHouse SQL UDF is a lambda with a fixed
parameter list and cannot be overloaded, so every argument shape is its own
name. Refusing beats picking one of the two and charging for a question the
caller did not ask.

The question's id is the statement's output column, so it is validated as a
column name, refused when it collides with a key column the template already
projects or with another question, and defaults to `q1`, `q2` and so on. The
instructions are written into the SQL as a quoted literal rather than bound,
because an app function's options must be literals (ADR-136): the hydration
plan is built before a row comes back. The quote and the backslash are escaped,
and the expansion goes through the same parser a submitted statement does, so a
mis-escape is a parse failure rather than a different query.

### The CLI

`langwatch instant-eval` is the seventh top-level group to take a
`--wait`-style poll, and it follows the shared contract: `emitsResult` for the
five read commands, `rendersOwnResult` for `run` and `status` because a poll
and an estimate line follow the answer, and `-o table|json|agents|yaml` with
`--jq` throughout. Two decisions are its own:

- **A run says what it will cost before it starts.** `--estimate` prices the
  run and exits. A plain `run` whose limit is over a thousand rows asks for the
  estimate first, prints one line, and then creates. If the estimate itself
  fails the run still goes ahead, unpriced: the caller asked for a run, not for
  a price, and the limit they wrote is the ceiling on what it can spend. That
  ceiling, not the estimate, is what bounds the bill.
- **`run` prints the statement.** Under a Statement heading in table mode, with
  its bound parameters. A caller who asked a question with `--target` gets back
  the LangWatchQL that answered it, which is what they edit when the shorthand
  stops being enough. In a machine format it is already a field of the run, so
  it is not printed twice.

The question flags are order-sensitive: `--criteria`, `--score`, `--category`,
`--threshold` and `--id` describe the `--ask` before them, the same way
`--required` describes its `--evaluator`. Commander reports no order across
different options, so `program.ts` listens to the option events as it parses,
which is where `trackEvaluatorFlags` already does the same thing. A modifier
written before any `--ask` describes the question given as the positional
argument.

## Consequences

- A run is resumable and idempotent per page, and the cost of that is two
  executions of the caller's statement per page rather than one, plus one for
  the count: the keys, then the rows. All are bounded by the statement's own
  time predicate, so the extra scans are the price of determinism. It is also
  why a statement with `LIMIT` and no `ORDER BY` has no guarantee that its
  pages tile one fixed set.
- Ordering by `TraceId` gives no partition pruning on the wrapper. The inner
  statement carries the caller's own time bound, so the scan it drives is
  bounded; `instant_eval_judgments` is in `TIME_PARTITIONED_TABLES` so every
  read of the results bounds `CreatedAt` as well.
- The run row's two writers share one replacing row, so the projection's
  write is a read then an insert rather than an update, and a replay that
  rewrites the counters re-inserts the definition with them. The definition is
  a few kilobytes, once per page, which is nothing beside the page itself.
- `instant_eval_stalled` is a code recorded on a row rather than thrown. Nothing
  raises it, because by the time it is known there is no request to refuse, so
  the orphan check in `features/errors/logic/__tests__/codes.unit.test.ts`
  carries it in a named category with that reasoning.
- A new source table means a row-filter entry in the SaaS `render-config.sh`,
  which is a third list in another repo that no CI here can see (ADR-101). The
  manifest parity test covers the two lists that are reachable.
- The run-level `matched` counts the run's boolean questions only, and is
  null for a run that asked none. A score and a category have no "yes", so
  adding their judged rows would give a headline number that reads as matches
  while being mostly rows we looked at. The per-question number keeps the
  per-kind meaning, because there the kind is listed beside it.
- A sample is ordered by `cityHash64(TraceId, seed)` with boolean matches
  first, not by the sort key. The first page of the results read would return
  the same lowest trace ids on every call, which answers "did the run ask what
  I meant" for one corner of the run only.
- The judgements outlive the traces they judged by default
  (`INDEFINITE_DEFAULT_RETENTION_TABLES`), which is what makes "what did that run
  find six months ago" answerable and is a deliberate departure from the
  customer retention cascade.

## Alternatives considered

**Backfill a monitor over history.** It is the workaround customers use today,
and it is why the feature exists: one evaluator per row, through the customer's
own provider, with no probability and no job to poll.

**Put the keys in the `planned` event and slice them per page.** A hundred
thousand trace ids is about three and a half megabytes of event, against a
couple of hundred bytes for a cursor.

**Rewrite the caller's statement to add the page predicate.** It would break the
promise ADR-084 makes and the scenario that holds it. Composition keeps the text
byte-identical and puts the decision about which rows come back where a reader
can see it.

**Pack several rows into one classifier request.** The bench measured 98%
agreement on single conversations against 87% with eight packed, so it buys a
seventh of the cost for eleven accuracy points. Banned in ADR-136 and still
banned here.
