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
- `instant_eval`: the FAST model rewrites the sentence into a judge question with yes and no criteria (`generateInstantEvalQuestion`), unless an evaluator or event the project already records answers it, in which case the route is a filter naming it. The target is `threads` on the Conversations lens and `traces` on every other lens. The Explorer receives the payload through `useInstantEvalRoute`; the run itself is the next part of this feature.
- `free_text`: the sentence is quoted as one phrase and merged with the explicit terms.
- `langy`: the whole text is the question, and it takes the same door as the Ask Langy button.

The classifier decides between the four with one category question over the sentence and a line of context: the lens, the window in hours, the explicit terms, the search applied before, the filter fields, the evaluators and event names the project has. Its gate is that a classifier is configured, not the Instant Evals release flag: routing sends nothing to be judged and is not a customer-facing eval.

Two fallbacks keep Enter working on every deployment. Without a classifier, the FAST model decides and builds in one structured call (`generateSearchRoute`), whose union carries the route and, for a filter, the query. Without a classifier and without a FAST model, the words are searched as a phrase and the result says `modelUnavailable`, which the client turns into a closable "connect a model for smarter search" popover, once per page session. A model failure, an empty query from the model's own escape hatch, or a classifier skip each fall through to a phrase search. The bar has no error state for routing.

Routing is counted, not metered. One category question of a few hundred input tokens per Enter is below the noise floor of the spend spine, and a spend record per keystroke would cost more to write and read than it reports. The decision lands on the counter `langwatch.trace_search.routes` with the route and who decided (classifier, model, fallback).

The translator's node ceiling gets its own handled code, `filter_too_complex`, with the copy "Too many separate terms. Put the sentence in quotes to search it as one phrase." and a one-click fix on the table's error state that requotes the bare words. The client checks the same count in `validateAst` before a query leaves the browser.

Cmd+Enter is removed. The Ask Langy button stays as the explicit route and now attaches the whole trace-view chip (time range, lens, grouping, sort, the applied search) before the filter chip, so the explicit route sends at least what the passive page context sends.

## Rationale / Trade-offs

Enter costs the user one keystroke they already pressed for a sentence and saves a request per pause, a half-typed query hitting ClickHouse, and a table that re-renders under their hands. The 600 ms query debounce existed for keystrokes and is now a 300 ms coalescer for bursts of facet clicks.

Reusing `generateTraceAction` rather than a second DSL prompt keeps one place that knows the filter language and the catalogue; the router adds a merge step and nothing else on that path. The classifier is the router because it is cheap and fast (about 250 ms) and because the question is a classification, which is what it does; a FAST model call for the same decision is several times slower and paid for by the customer.

What is compromised: a single bare word ("timeout") also goes through the router, which is a round trip the old bar did not make. The alternative, a heuristic that skips routing for short input, would have to guess where a sentence begins, and a wrong guess costs more than 250 ms. Blur no longer commits, so text typed and left behind is lost when a facet click applies a different query; the spec names this, and Enter is the answer.

## Consequences

`tracesV2.routeSearch` is a new procedure with no migration. It reads facet values for the context line and calls the classifier and the FAST model; the FAST model uses the project's own keys under the `traces.ai_search` feature. The `instant_eval` kind has a typed payload and a hook the Explorer implements next; until then it applies the phrase search. The route metric is the only trace routing leaves.

## References

- Related ADRs: ADR-045 (handled errors), ADR-137 (Instant Eval runs), ADR-138 (the query reference)
- Spec: `specs/traces-v2/search.feature`, rule "Enter routes a sentence"
