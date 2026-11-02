# ADR-182: The Instant Evals decision model is a Default models column, and an own key is unmetered

**Date:** 2026-10-19

**Status:** Accepted

> One line: Settings > Model Providers > Default models gains an **Instant Evals** column. It defaults to **LangWatch Instant Preview**, the hosted classifier, metered and capped as today. An organization with the `release_instant_evals_own_decision_model` flag can pick a decision model from another provider, run on its own key, which LangWatch neither meters nor caps.

## Context

- tasks#964. Instant Evals today runs on one classifier with LangWatch's key (ADR-174 decision 14). The choice lives in global environment variables, so no customer can change it.
- Several providers now sell decision models: a model that takes a text and typed questions (yes or no, one of several options, a score) and answers each with probabilities. The LangWatch benchmark ranks OpenAI's Decisions API first, then Inception's Mercury Decide, then others.
- An enterprise customer asked to run Instant Evals on its own decision model account.
- ADR-174 decision 14 says customers never supply a classifier key. This record narrows that rule: it still holds for the hosted classifier, and an own key is allowed only for a decision model the organization picks, behind a flag.

## Decision

1. **A new role, `INSTANT_EVALS`, is a column of the Default models table.** It sits beside DEFAULT, FAST, LANGY and EMBEDDINGS, and is stored in the same `ModelDefaultConfig.config` map, so no migration is needed. Its one feature is `instant_eval.judge`. Unset, it resolves to `langwatch/instant-evals`, never to another role and never to the `langy.chat` fallback. Rejected: a separate settings page. The meeting placed it in this table, and the scope walk (project, team, organization) already exists there.
2. **The column offers decision models only,** from a catalogue in the model-provider contract (`DECISION_MODELS`). Each entry names its provider, its wire format and its label. LangWatch Instant Preview is first and is the default. The catalogue is the only list: the drawer, the write check and the resolver all read it.
3. **Providers that only sell decision models are registry entries of type `decision`.** Inception, Perplexity and Cloudflare are added beside `azure_safety` (type `safety`). They are not dispatchable, never appear in the chat model lists, and keep their keys in `ModelProvider.customKeys` like every other provider. OpenAI's Decisions API reuses the existing `openai` provider and its key.
4. **The flag gates writes and reads.** `release_instant_evals_own_decision_model`, off by default, always asked of the organization (never a project, so reads and writes agree). A write that newly picks an own model is refused when the flag is off for the scope's organization; a value kept as it was is not refused, so other columns stay editable. A read that finds an own model with the flag off answers `own_unavailable` (`not_enabled`), and the call skips as `classifier_not_configured`. It never moves the organization onto the billed classifier on its own. Rejected (red team, 2026-10-19): answering LangWatch Instant Preview, which would silently start metering and capping an organization that chose its own key.
5. **Model provider resolves; it does not judge.** `ModelProviderApi.resolveDecisionModel({ projectId })` answers one of: `langwatch` (the hosted classifier), `own` (model, wire format, the endpoint with any account id filled in, and the decrypted key), or `own_unavailable` (the model the project picked, and why it cannot run: the flag is off, no provider row, the row is off, or no key). The endpoint is the catalogue's own: a row's custom base URL is not honoured, so a key is only ever sent to the provider that issued it. Model provider adds the feature flag Api as a peer. It reaches no Instant Evals module, so no cycle forms.
6. **Callers pass the resolved model to the judge leaf.** Evaluation and Instant Evals call the resolver and hand the `own` answer to the leaf's `judge` or `classify` as `decisionModel`. The leaf keeps calling no peer (ADR-174 decision 13). Instant Evals adds model provider as a peer, which closes no cycle.
7. **An own-key call is unmetered and uncapped.** The leaf skips the unknown-project refusal, the $1 check, the rate limiter and the spend record. It reports zero billed tokens and a price of zero, so a run or query records nothing. Instant Evals skips its budget hold and its $1 check for a project on an own model. The leaf calls an own model on any install, since the key is the customer's (this narrows ADR-174 decision 14). Instant Evals' own access check is unchanged, so off cloud a run still needs Instant Evals released there first.
8. **Each wire format is one channel in the leaf.** A decision model channel takes the key per call, translates the leaf's questions into the provider's request and its answer back into verdicts. The hosted classifier channel is unchanged.
9. **A key failure never falls back to LangWatch.** No retry against another model, no charge. Each failure names a reason with a next step, and never shows the provider's own error text:
   - no provider row, row off, no key, or the key or account refused (401, 402, 403): `classifier_key_invalid`, "check the key in Settings > Model Providers", not retried;
   - rate limited (429): `classifier_rate_limited`, "wait and retry";
   - provider down, timed out or unreadable answer (5xx, network): `classifier_provider_unavailable`, "retry later";
   - the text too large (413): `classifier_input_too_large`, a skip and not an error, since the trace's size is nothing to fix;
   - any other refusal (400, 422): `classifier_failed`, "retry; if it keeps failing, pick another decision model".
     For an LLM judge these are error results (ADR-174 decision 7). For a run or a judged query they are skips, counted by reason.
10. **The hosted path is untouched.** A project on LangWatch Instant Preview runs exactly as before: same classifier, same Connect choice off cloud, same meter, same cap.

## Invariants

- Nothing outside `DECISION_MODELS` can be stored in the `INSTANT_EVALS` column.
- An own-key call never writes a spend row and never reads the $1 total.
- A failed own-key call never reaches the hosted classifier.
- The provider's error text never reaches a result, a log line a customer reads, or the UI.
- With the flag off, no project runs on an own model, and none is moved onto the billed classifier.
- A decrypted key is resolved at call time in the process that makes the call, and never enters a command, an event, a log line or a browser response.
- A catalogue entry is never deleted. A stored id the catalogue no longer offers reads as unset.

## Rejected alternatives

- **The leaf calls model provider itself.** It would break the leaf's no-peer rule (ADR-174 decision 13).
- **Falling back to the hosted classifier when the own key fails.** It would charge an organization that chose not to be charged, and hide a broken key.
- **A route through the AI gateway for own keys.** The gateway has no decision model adapter, and an own-key call is not metered, so the gateway adds nothing yet. Revisit when the gateway learns decision models.
- **Jev with an own key.** Out of scope for now (the user, 2026-10-19).

## Consequences

- The Default models table grows a fifth column, and every hard-coded role list gains `INSTANT_EVALS`.
- An own-key project's Instant Evals usage shows no cost in LangWatch; the provider bills the customer.
- A decision model with smaller limits than the hosted one may skip long texts as `classifier_input_too_large`; Clef Flash truncates a long text itself.
- The answer is cached per project for a minute in model provider, so a page of rows or a busy monitor reads the column once, and concurrent callers share one lookup. A change to the column or the flag takes up to a minute to reach a running page, and a run that spans the change may mix verdicts from two models. Every page still checks the $1 total for a hosted project.
- The search bar keeps classifying on LangWatch's key, unmetered (ADR-144), whatever the column says.
- A run's estimate for an own-model project still shows the hosted price, with no $1 standing. Showing no price is a follow-up.

## Open questions

- Azure's Microsoft Decision 1: its request format is not documented yet. It joins the catalogue once it is.
- Splitting the LLM judge picker into "Instant Preview" and "Judge Preview" is a later issue.
