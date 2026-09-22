# ADR-136: LangWatchQL app functions are projection UDFs plus a post-execution hydration stage

**Date:** 2026-09-17

**Status:** Accepted

**Builds on:** [ADR-084](084-lwql-postgres-mapping-tenant-predicate.md): the
submitted statement is never rewritten. This ADR keeps that promise while adding
values the database cannot compute.
[ADR-083](083-lwql-diagnostics-read-the-single-parse.md): the validator's one
walk is where facts about a statement are recorded; the hydration plan is
recorded the same way, for the same reason.
[ADR-141](141-the-app-owns-the-lwql-access-model.md): the app self-provisions
the LangWatchQL access model on every deployment, and app functions follow
that same provisioning path. There is no config-time XML form for SQL UDFs, so
provisioning is always application-driven; §4 explains the constraint.

**Related:** [ADR-082](082-lwql-analytics-views-invoker-column-grants-final-dedup.md)
(the `INVOKER` views and column grants these run beside),
[ADR-022](022-spool-on-zero-truncation.md) (why the reads resolve offloaded
content rather than the preview).

**Behavioural contract:**
[specs/lwql/app-functions.feature](../../../specs/lwql/app-functions.feature),
and for the eval functions
[specs/lwql/eval-functions.feature](../../../specs/lwql/eval-functions.feature)
plus [specs/instant-evals/classifier.feature](../../../specs/instant-evals/classifier.feature).

## Context

LWQL lets a customer query their traces with SQL, and the datasets it exposes
are deliberately *metrics and dimensions*: counts, latencies, models, ids. The
text of a conversation is not in them. That is a correct default for analytics
and a wall for everything else people want to do with production history: read
a thread, export training data, and (next) ask a judge a question about every
conversation a tenant has.

The text does exist, in three renderings the product already uses and that
already have readers: the conversation view's markdown, the LLM-readable span
digest the online evaluators and the scenario judge read, and the chat messages
the trace drawer's two panels show. None of them is a column, because none of
them is a value the database can produce: each is the output of application code
over a trace's spans.

So the question is how a caller names one from inside SQL, given a hard
constraint we are not willing to give up: `specs/analytics/lwql-api.feature`
binds a scenario asserting that the statement in `system.query_log` is the
statement that was submitted, byte for byte. ADR-084 rejected gateway rewriting.
Whatever this is, it cannot be a rewriter.

## Decision

An app function is two halves.

**In the database**, a pure projection SQL UDF over the function's *key*
arguments. The identity on the single key for almost all of them, `tuple(...)`
for the one whose key is a pair. `conversation(x)` evaluates to `x`. The
customer's SQL therefore runs verbatim, under the same row policy as any other
query, and the returned column carries the key.

**In the application**, a hydration stage between execution and the response
(`appFunctions/hydrate.ts`): distinct keys per column, cap check, one batched
read per key kind through `TraceService` with the caller's own `Protections`,
compute, overwrite the key with the value, re-declare the column's type.

The validator admits these names from a separate catalog
(`appFunctions/catalog.ts`), restricted to aliased direct elements of the
outermost `SELECT` list, and records the plan on the accepted result.

## 1. Why the UDF exists at all, when the value never comes from it

`UNKNOWN_FUNCTION` coming back is read as a missing app function only when the
statement called one. The allowlist admits native ClickHouse functions too and
the BYO contract pins no server version, so an older server refusing `toBool`
would otherwise be reported as unprovisioned extraction functions, which names
the wrong cause and offers the caller an action that changes nothing.

Without one, `conversation(ConversationId)` is `UNKNOWN_FUNCTION` and the
statement never runs. The alternatives were:

- **Rewrite the statement** to drop the call before sending it. Refused by
  ADR-084 and by the bound verbatim scenario.
- **A request-level `enrich: [{column, fn, args}]` field** instead of SQL
  syntax. This works, and was the fallback if the spike had failed. It is worse
  for the reason the whole feature exists: the caller is usually an agent
  writing SQL, and a value it has to ask for outside the SQL is a value it has
  to learn a second grammar for. It also cannot say *which expression* is the
  key without naming a column, so it cannot express
  `llm_readable_trace(concat(TraceId, ''), 8000)`.

The UDF is the smallest thing that makes the SQL parse and run while changing
nothing about what the database does with it. Measured on 25.8, an identity UDF
is erased before index analysis: `EXPLAIN indexes = 1` forms partition and
primary-key conditions on the bare column, so it costs nothing in pruning.

## 2. Projection-only is a correctness rule, not a policy one

This is the finding that shapes the validator. ClickHouse accepts a projection
UDF in `WHERE`, `GROUP BY`, `ORDER BY`, `HAVING`, a join condition, a CTE, a
subquery and inside `arrayMap`, and answers with the **key** compared as if it
were the value:

```sql
WHERE conversation(ConversationId) = 'c-42'   -- returns the row whose key is 'c-42'
```

No error. A silently wrong answer, and one nothing downstream can detect:
`EXPLAIN QUERY TREE` shows no trace of the call by analysis time, so the value
only exists in the submitted text and in the result column name.

The database will therefore not enforce this, and the validator must. Every
other position is a named refusal (`APP_FUNCTION_POSITION`) rather than a
general one, and the `WHERE` case is a spec scenario of its own.

Three smaller rules follow from the same place:

- **An alias is required** (`APP_FUNCTION_ALIAS_REQUIRED`). Without one the
  result column is named after the call text, argument quoting and all
  (`spike_identity2(ConversationId, \'q\')`), and hydration would have to parse
  a column name back into a call.
- **Options must be literals** (`APP_FUNCTION_ARGUMENT`). The plan is built
  before a single row comes back; an option bound at run time would make one
  column mean different things in different rows of the same result.
- **A `UNION` disqualifies both branches.** Two branches projecting the same
  output column would put two meanings in it, and hydration works per column.

## 3. The names are a global, unversioned public API

SQL UDFs in ClickHouse have **no database namespace**:
`analytics.conversation(x)` is `UNKNOWN_FUNCTION` (46). One name per server,
shared by every tenant. So a name in the catalog is not scoped, not versioned
and not renameable without breaking saved statements, and it also stakes a claim
against a future ClickHouse builtin: `CREATE OR REPLACE FUNCTION length AS (k)
-> k` is refused with `FUNCTION_ALREADY_EXISTS` (609).

Provisioning therefore reconciles the declared names against `system.functions`
and reads two columns, because two different things can own one of these names.
A future ClickHouse builtin shows up as another `origin`. Somebody else's SQL
function created on the same server under a name this catalog claims shows up
with our own origin and a different body, and `CREATE OR REPLACE` would
overwrite it and change what its callers get. So the stored `create_query` is
compared as well, and either kind is a conflict rather than something to
replace.

`SHOW CREATE FUNCTION` does not exist, which is why the definition is read from
`system.functions` rather than dumped, and what the server keeps there is
rewritten before storage by an amount that varies with the version. Measured on
two: 25.8 drops the parentheses around a single parameter and stores a pair body
as `(a, b)`, while the version the harness suite runs keeps `tuple(a, b)`
verbatim. Both spell the same function, so the comparison writes both sides into
one form first and treats anything else as a difference. The expected text is
generated from the same catalog, so a release that rewrites something new fails
a test rather than reporting every function as drifted. A server too old to
report `create_query` is treated as ours, since refusing every provisioning run
there would be worse than the risk it avoids.

A caller's spelling has to match exactly for the same reason the statement is
never rewritten: ClickHouse resolves a SQL UDF letter for letter, so
`CONVERSATION(x)` would reach the server as an unknown function. The validator
recognises the name case-insensitively anyway and refuses it with
`APP_FUNCTION_NAME_CASE`, naming the spelling to use. Reporting it as a
function that is not allowed would send the caller looking for a name they can
see in the schema.

The restricted identity needs **no grant** to call one (its 30 grant rows hold
nothing matching `%FUNCTION%`, and the call works under `readonly = 1`), and is
refused `CREATE`, `DROP` and `SYSTEM RELOAD FUNCTION` with `ACCESS_DENIED`
(497), an access-control refusal, so it holds even if `readonly` were ever
relaxed. A third audit query beside the policy-coverage and definer-view ones
pins that no such grant appears.

## 4. They are SQL, next to an access model the app self-provisions

ADR-141 records that the app self-provisions the whole LangWatchQL access model
on every deployment. App functions run under that same app-owned path: they are
SQL provisioned by the application at boot, not config. There is no XML form of
`CREATE FUNCTION` for a SQL UDF; the only config-time UDF form,
`user_defined_executable_functions_config`, is for *executable* UDFs that fork
a process per call, which is not what this is.

So they are SQL-provisioned by the application on every deployment, applied by
the same administrative connection and generated from the same application
catalog as the views they sit beside. Deliberately not part of the access model:
nothing about them grants, policies or authenticates anything.

### Replication

A `CREATE FUNCTION` writes the local disk store of whichever replica ran it, so
on production's one shard and three replicas it lands on one of them. The fix is
a server setting, `user_defined_zookeeper_path`, which moves the store into
Keeper: one create then reaches every replica, and a replica rebuilt or rejoined
later picks the functions up at boot. `ON CLUSTER` was rejected for exactly that
last property: it is a DDL broadcast that writes each local store at the moment
it runs, so a replica built afterwards has no functions and every provisioning
run has to be re-broadcast.

The chart-managed renderer declares the path in replicated mode only
(`config.d/zz-server-settings.yaml`, `/clickhouse/user_defined`); on a single
node there is no ensemble to point at. The cloud's own rendered config
(`langwatch-saas`, `config/lwql-server.xml`) needs the same element and the
same path, and lands as its own change.

## 5. Caps are refusals, and truncation is never silent

A cap breach is `lwql_app_function_key_cap` (422), naming the cap, the key kind
and the distinct count. The alternative, hydrating the first thousand keys and
leaving the rest as raw ids, produces a result that looks complete, carries no
marker a consumer could branch on, and is wrong; an analytics caller cannot
detect that, and can detect a 422. Paging past the cap is the caller's own
`LIMIT` plus a keyset predicate.

The caps count **distinct** keys across the whole execution, not rows and not
per call, because the fetch is shared: three functions over one set of trace ids
is one read of that set. Trace and span keys are 1,000; thread keys are 200,
which is already what the thread read's own `LIMIT 1000` allows.

Three ceilings, three behaviours, all reported:

| Ceiling | Behaviour | Reported as |
|---|---|---|
| `maxHydratedBytes` (32 MB) | trailing rows dropped | `RESULT_TRUNCATED`, `meta.ceiling = "hydratedBytes"` |
| `maxHydratedValueBytes` (4 MB) | that value cut on a UTF-8 boundary | `APP_FUNCTION_VALUE_TRUNCATED` |
| a key naming nothing | that cell is null | `APP_FUNCTION_UNRESOLVED_KEYS` |

`maxHydratedBytes` is a second, much larger ceiling rather than a raised
`maxResultBytes` because the two bound different things: the database returns a
page of keys, which is small by construction, and the application then puts a
conversation in each of them.

## 6. Tenancy is re-established at the hydration boundary

The row policy bounded the query. It did not bound the hydration stage: the keys
came back to the application, and a read that took them at face value would
fetch whichever trace they named. Every read goes through
`appFunctions/traceSource.ts`, which takes the project and the caller's
`Protections` and calls `TraceService`, which filters on `TenantId` and applies
field redaction. There is no ClickHouse query in the stage, and there must never
be one.

The functions are gated on the same content permissions as the columns holding
the same content (`APP_FUNCTION_GATED`), so a caller who cannot read
`CapturedInput` cannot read it through a function either. One consequence worth
naming: because the gate requires both permissions, the redaction markers in the
shared conversation renderer are unreachable through LWQL. They are there for
the drawer.

## 7. What the values are, and the fallback the production data forces

Nothing here renders anything of its own. `conversation` is the drawer's
markdown, `llm_readable_trace` the judge's digest under a budget, `llm_messages`
the drawer's two panels, `trace_json` the export serialiser. A query and the
product must not disagree about what a trace says.

One fallback is ours. `ComputedInput` / `ComputedOutput`, which the conversation
view is built from, is empty on a third to nearly all traces for several large
tenants and on most coding-agent traces. A transcript built from those alone
comes back as a list of empty turns, which reads as "the conversation was empty"
rather than "we looked in the wrong place". So each side of each turn falls back
to the chat messages of the trace's chosen LLM span. The chain ends there: the
next tier is the span digest, which is `llm_readable_trace`, its own function
with its own budget. Folding it in would make one function's output depend on
which tier it silently reached.

## Consequences

- LWQL gains values the database cannot compute without gaining a rewriter, and
  the verbatim-SQL scenario still holds.
- The validator has a fourth list beside node kinds, node fields and the
  function allowlist, and its rule is positional rather than nominal.
- Nine function names are now a public API of every LangWatch ClickHouse
  server, and a ClickHouse upgrade that ships one of them as a builtin is a
  loud provisioning failure rather than a silent behaviour change.
- The cloud's rendered ClickHouse config needs
  `user_defined_zookeeper_path` before app functions are correct on more than
  one replica. Until it lands, a production create reaches one of three.
- The eval functions of the Instant Evals design (`eval`, `eval_score`,
  `eval_category`) reuse this machinery unchanged: same catalog shape, same
  projection-only rule, same hydration stage, with one level of nesting over an
  extraction function. They land separately, under this ADR.
- AI predicates in `WHERE` are a later phase and are not in this decision. The
  shape is recorded so the refusal above is not mistaken for a permanent one:
  the UDF would evaluate to true in ClickHouse, the validator would record the
  predicate as a post-hydration filter, and `LIMIT` would then bound candidate
  rows rather than matches, a semantic that has to be documented before it
  ships.

## Amendment, 2026-09-18: eval functions and the classifier interface

The eval functions land on this machinery with no change to it. `eval`,
`eval_criteria`, `eval_passed`, `eval_score`, `eval_category` and
`eval_category_probs` are catalog entries like the extraction ones: a projection
UDF in ClickHouse, projection-only with an alias, options as literals, a value
the application computes after the query. Four things are new.

**Nesting, one level, one direction.** An eval function's key is the text to
judge, and that text is normally an extraction function. So the validator admits
an extraction call inside an eval call and nothing else: not an eval inside an
eval, not an extraction inside an extraction, not an eval inside an extraction.
The database makes this work on its own — two identity UDFs compose to the
identity, so the column carries the *inner* function's key — and the hydration
stage runs the extraction first and judges what it produced. Deeper nesting has
nowhere to run: hydration reads one key per column and computes one value from
it, so a second extraction inside the first would have no key of its own.

**One request per text, never per row pair.** Several eval calls over the same
nested expression are grouped into one classification carrying every question,
which is what keeps a three-question query the price of a one-question query.
Rows are never packed together: the bench measured 98% agreement on single
conversations against 87% with eight packed into one request, and eleven points
of accuracy is not worth a seventh of the cost.

**Two names for one boolean question.** `eval(text, instructions)` and
`eval(text, instructions, criteria)` were meant to be one name with two
arities, and ClickHouse will not have it. A SQL UDF is a lambda with a fixed
parameter list; calling one with any other count is `BAD_ARGUMENTS` (36),
measured on 25.8: "Lambda (a, b) -> a expect 2 arguments. Actual: 3". There is
no overloading and no default argument. So the criteria form is its own
function, `eval_criteria`, which matches what the rest of the family already
does — the name says what the extra argument is. A three-argument `eval` is
refused by arity with a message naming `eval_criteria`, so the spelling a reader
reaches for first still lands in one round trip.

**The judge is behind an interface, and it is ours.**
`app-layer/instant-evals/classifier` publishes `InstantEvalClassifier`, which
carries its own limits and its own pricing so nothing above it holds a provider
constant. The shipped implementation calls TypeSafe Jev with LangWatch's own
key, never a customer's; a deployment with no key gets a null implementation
that skips every question rather than failing every query. Requests are paced by
a Redis token bucket shared by every pod, because the quota belongs to the
platform's key rather than to a process, and it falls back to a low local rate
when Redis cannot be reached, a slowdown, not an outage. The bucket holds input
tokens rather than requests, with a second bucket per tenant as one project's
share of the ceiling (ADR-137 §9).

Two ceilings are new and both are refusals rather than partial answers, for the
reason §5 already gives. `instant_eval_query_budget_exceeded` (422) refuses a
synchronous query whose estimated tokens exceed the per-query budget, before
anything is sent, and its remediation says to run the statement as a job.
`instant_eval_classifier_unavailable` (503, `provider` fault) is the case where
*nothing* was judged; a query where some texts went unjudged answers normally
with null cells and an `INSTANT_EVAL_SKIPPED` diagnostic naming the reasons.
Gating is a product flag on the project **and** a configured classifier on the
deployment, together: publishing a function as available where nothing can
answer it puts a caller in front of a query that always comes back null.

One cost row is recorded per query, not per judged row, carrying our cost as the
amount and the customer's price beside it. `WHERE` predicates over an eval
function remain the later phase this ADR already describes.

Three details were settled by measuring the live API rather than by reading the
plan, and each one is pinned by a test built from the captured response:

- **A score answer is keyed by level position, and `legend` says which level
  each position means.** A range of 20 to 24 came back as
  `probabilities: {"0":0, …, "4":0.69}` with `legend: {"0":"20", …, "4":"24"}`.
  The weighted mean therefore resolves each key through the legend first and
  accepts only levels the question actually offered, which is what keeps the
  reading correct if the keys ever become the criteria themselves.
- **A score holds at most ten levels.** Eleven is refused with `Too many score
  levels. Must have at most 10 levels.`, so `eval_score(text, 'x', 0, 10)` is
  refused by the validator where it was written rather than once per row at the
  provider. The ceiling is published through the classifier's limits, so there
  is one number rather than two that can disagree.
- **`jev-latest` is a real model name; a version written out is not.**
  `jev-1.13` is refused as an unknown model while `jev-latest` resolves to
  `jev-1.13.0` in the response, so that is the default, with `JEV_MODEL` to pin
  whatever concrete name the provider later publishes.

Cancellation is threaded from the request to the classifier. A judged query is
the one LangWatchQL shape that keeps spending after its caller has gone, so the
REST route passes the request's own `AbortSignal`, the runner checks it between
classifications, and an abort propagates rather than being counted as a row that
could not be judged.
