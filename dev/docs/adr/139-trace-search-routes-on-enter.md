# ADR-139: Trace search routes on Enter

**Date:** 2026-09-19

**Status:** Accepted

## Context

The Trace Explorer search bar searched as the user typed. Every keystroke reached the filter store after a short settle, and the store fired a request 600 ms later. Bare words became one free-text filter each, joined by implicit ANDs, so a sentence of eleven words was twenty-one AST nodes and tripped the translator's ceiling of twenty. The user saw "This filter isn't valid" for a sentence that was valid English, and nothing said that quoting it would fix it.

Cmd+Enter was a second way out of the bar. It sent the raw text to Langy with one context chip carrying only the query text, no time range and no lens, so Langy searched a default window and usually found nothing.

Two different readers already sat behind the bar. The Ask AI composer turns a sentence into the filter language with the FAST model (`ai-query.ts`, `generateTraceAction`, a live field catalogue and a validate-and-repair loop). Instant Evals judge each trace with the classifier (`instant-evals/classifier`). Neither was reachable from a plain Enter.

## Decision

Enter is the only path a typed text takes out of the search bar. Typing, pausing and blurring search nothing; the editor keeps chips and autocomplete live from its own document. Explicit store changes (a facet click, a chip removed, a range released) still search at once.

A text made of `field:value` terms is applied as typed, with no request. A text with bare words is a sentence, and a new tRPC procedure, `tracesV2.routeSearch`, decides what it is. The router (`server/app-layer/traces/search-router/route-search.ts`) answers one of four kinds:

- `filter`: the FAST model builds the query through `generateTraceAction`, the same prompt and catalogue the composer uses, and the result is merged with the explicit terms the user typed next to the sentence. The bar shows the query as chips and a strip under it reads "Searched as: ...", with the words offered back as one phrase.
- `instant_eval`: the FAST model rewrites the sentence into a judge question with yes and no criteria (`generateInstantEvalQuestion`), unless an evaluator or event the project already records answers it, in which case the route is a filter naming it. The target is `threads` on the Conversations lens and `traces` on every other lens. The Explorer receives the payload through `useInstantEvalRoute`, which starts the run and applies the `eval` chip (see "The `eval` field" below).
- `free_text`: the sentence is quoted as one phrase and merged with the explicit terms.
- `langy`: the whole text is the question, and it takes the same door as the Ask Langy button.

The classifier decides between the four with one category question over the sentence and a line of context: the lens, the window in hours, the explicit terms, the search applied before, the filter fields, the evaluators and event names the project has. Its gate is that a classifier is configured, not the Instant Evals release flag: routing sends nothing to be judged and is not a customer-facing eval.

Two fallbacks keep Enter working on every deployment. Without a classifier, the FAST model decides and builds in one structured call (`generateSearchRoute`), whose union carries the route and, for a filter, the query. Without a classifier and without a FAST model, the words are searched as a phrase and the result carries `modelTrouble`, which says which of the two problems it was: `no_model` when none is configured for the project, `model_failed` when the one configured refused or produced nothing usable. The result also carries the handled code of the failure when it had one, which is the one part of a provider failure written to be read by a customer. The client turns both into one line under the bar: what the sentence was read as, and why the words were used as typed, with the code named. Beside it, a button to the model provider settings, which can be dismissed and stays dismissed per project; the line itself stays, because it is how a reader learns the search ran degraded. A route the model chose but could not build degrades in kind rather than to the phrase: a judge question no model could write becomes a judgement of the sentence exactly as typed, with no criteria, the way a chip typed by hand already runs. A classifier skip or an empty query from the model's own escape hatch still falls through to the phrase search. The bar has no error state for routing.

Routing is counted, not metered. One category question of a few hundred input tokens per Enter is below the noise floor of the spend spine, and a spend record per keystroke would cost more to write and read than it reports. The decision lands on the counter `langwatch.trace_search.routes` with the route and who decided (classifier, model, fallback).

The translator's node ceiling gets its own handled code, `filter_too_complex`, with the copy "Too many separate terms. Put the sentence in quotes to search it as one phrase." and a one-click fix on the table's error state that requotes the bare words. The client checks the same count in `validateAst` before a query leaves the browser.

Cmd+Enter is removed. The Ask Langy button stays as the explicit route and now attaches the whole trace-view chip (time range, lens, grouping, sort, the applied search) before the filter chip, so the explicit route sends at least what the passive page context sends.

## The `eval` field

An `instant_eval` route ends as one chip, `eval:"<question>"`, whose value is the question the judge reads. `eval:` judges what the lens shows (conversations on the Conversations lens, traces on every other lens); `eval.trace:`, `eval.conversation:` and `eval.llm:` force the unit judged, so a lens change cannot change what a saved chip means. The run behind the chip is not in the query text. The client registers it under a key over the question, the unit judged, the other chips and the window (`instantEvalRunKey`, a rolling preset keyed by its id so the bounds moving every tick do not start a run every tick), keeps the key to run id map in the filter store, writes it into the URL fragment as `run=<key>:<runId>`, and sends the registered runs as `evalRuns` with every list, sessions, facets and new-count read. The server resolves each run against the project through the run service and drops the ones it does not own, and the compiler reads the resolution off the translation context. A chip with a run compiles to `TraceId IN (SELECT TraceId FROM instant_eval_judgments WHERE TenantId = ... AND RunId = ... AND CreatedAt in the run's own write window GROUP BY TraceId, SpanId, QuestionId HAVING argMax(Passed, UpdatedAt) = 1)`, a conversation chip compares the trace's conversation id to the matched `ThreadId`s instead, and a forcing spelling with no run compiles to no rows. The bare field with no run keeps the evaluator-name lookup it was before, so saved queries spelling `eval:<name>` still work.

The run starts through `tracesV2.instantEval.{estimate,start,cancel,get}`, which wraps the run service with the shorthand the CLI already speaks: the target, the other chips as the filter, the exact window and one boolean question. Under 0.50 USD the run starts on the estimate alone; at or over it a dialog shows the question as understood, the rows and the cost. A spent free budget or a missing judge is a closable popover on the search bar, and every refusal ends in the phrase search. The shorthand dialect cannot compile the half of the filter language that lives outside the trace row (evaluator verdicts, events, span attributes); when it refuses a field by name the run service resolves the trace ids once with the Explorer's own compiler, capped at the row limit, and the statement binds them as `instant_eval_selection_ids` instead of the filter text.

While the run judges, the page polls `get` every second, a determinate bar over the table reads the run's counters with a Stop, and every change of progress refetches the list and the facets so matches appear as pages finish. The counts read the run's counters during the run and the plain total after. Stop cancels the run; the chip stays, marked partial with what was judged.

## Rationale / Trade-offs

Enter costs the user one keystroke they already pressed for a sentence and saves a request per pause, a half-typed query hitting ClickHouse, and a table that re-renders under their hands. The 600 ms query debounce existed for keystrokes and is now a 300 ms coalescer for bursts of facet clicks.

Reusing `generateTraceAction` rather than a second DSL prompt keeps one place that knows the filter language and the catalogue; the router adds a merge step and nothing else on that path. The classifier is the router because it is cheap and fast (about 250 ms) and because the question is a classification, which is what it does; a FAST model call for the same decision is several times slower and paid for by the customer.

What is compromised: a single bare word ("timeout") also goes through the router, which is a round trip the old bar did not make. The alternative, a heuristic that skips routing for short input, would have to guess where a sentence begins, and a wrong guess costs more than 250 ms. Blur no longer commits, so text typed and left behind is lost when a facet click applies a different query; the spec names this, and Enter is the answer.

## Consequences

`tracesV2.routeSearch` is a new procedure with no migration. It reads facet values for the context line and calls the classifier and the FAST model; the FAST model uses the project's own keys under the `traces.ai_search` feature. The `instant_eval` kind has a typed payload the Explorer turns into a run through `tracesV2.instantEval`, a nested family with no migration of its own: it reads and writes the Instant Eval tables the REST family already uses, and the `eval` chip reads `instant_eval_judgments` through the filter compiler. The route metric is the only trace routing leaves.

Facets on `stored_spans` and `evaluation_runs` count spans and evaluation runs, and reach a filter through a membership test on the traces the list reads. With no query the test is skipped. Measured on a seeded project with 5,924 traces over 30 days, it adds 100 to 400 ms to each of those reads and reads 12 MB of trace attributes, about 2 KB per trace in the window, because the origin lives in the attributes map. A window of one million traces would read about 2 GB and hold a set of one million trace ids per table on every unfiltered page load. So with no query these facets include the rows of Langy's own traces and rows whose trace starts outside the window (139 of 1,796 evaluation runs on the seeded project). Under any query the test applies to every facet, the one the query names included, so the counts are read again through the listed traces right after a facet click.

## References

- Related ADRs: ADR-045 (handled errors), ADR-137 (Instant Eval runs), ADR-138 (the query reference)
- Spec: `specs/traces-v2/search.feature`, rule "Enter routes a sentence"
- Spec: `specs/traces-v2/instant-eval-search.feature`, the `eval` chip, the cost rule, the progress and the refusals
- Spec: `specs/instant-evals/instant-eval-shorthand.feature`, the selection fallback
