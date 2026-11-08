# ADR-182: The Instant Evals decision model is a Default models column, and an own key is unmetered

**Date:** 2026-10-19

**Status:** Accepted

> One line: Settings > Model Providers > Default models gains an **Instant Evals** column. It defaults to **LangWatch Evals Preview**, the hosted classifier, metered and capped as today. An organization can pick a decision model from another provider, run on its own key, which LangWatch neither meters nor caps.

## Context

- tasks#964. Instant Evals today runs on one classifier with LangWatch's key (ADR-174 decision 14). The choice lives in global environment variables, so no customer can change it.
- Several providers now sell decision models: a model that takes a text and typed questions (yes or no, one of several options, a score) and answers each with probabilities. The LangWatch benchmark ranks OpenAI's Decisions API first, then Inception's Mercury Decide, then others.
- An enterprise customer asked to run Instant Evals on its own decision model account.
- ADR-174 decision 14 says customers never supply a classifier key. This record narrows that rule: it still holds for the hosted classifier, and an own key is allowed only for a decision model the organization picks, behind a flag.

## Decision

1. **A new role, `INSTANT_EVALS`, is a column of the Default models table.** It sits beside DEFAULT, FAST, LANGY and EMBEDDINGS, and is stored in the same `ModelDefaultConfig.config` map, so no migration is needed. Its one feature is `instant_eval.judge`. Unset, it resolves to `langwatch/instant-evals`, never to another role and never to the `langy.chat` fallback. Rejected: a separate settings page. The meeting placed it in this table, and the scope walk (project, team, organization) already exists there.
2. **The column offers decision models only,** from a catalogue in the model-provider contract (`DECISION_MODELS`). Each entry names its provider, its wire format and its label. LangWatch Evals Preview is first and is the default. The catalogue is the only list: the drawer, the write check and the resolver all read it. _Revised 2026-11-06:_ a label is the full name: the provider, then the model or, for OpenAI's and Azure's Decisions, the API ("Inception Mercury Decide", "OpenAI Decisions"), for text with no provider icon, such as a save refusal. A picker row may carry a shorter title in `pickerLabel` (OpenAI's and Azure's gpt-6-luna both read "Decisions API"), because the row's provider icon names the provider; with no `pickerLabel` the row shows the label. The hosted model is titled "Evals Preview". The drawer lists every catalogue entry while own models are on, but only what the server offers can be picked; the rest say which key to add.
3. **Providers that only sell decision models are registry entries of type `decision`.** Inception, Perplexity and Cloudflare are added beside `azure_safety` (type `safety`). They are not dispatchable, never appear in the chat model lists, and keep their keys in `ModelProvider.customKeys` like every other provider. OpenAI's Decisions API reuses the existing `openai` provider and its key.
4. **The flag gates writes and reads.** `release_instant_evals_own_decision_model`, off by default, always asked of the organization (never a project, so reads and writes agree). A write that newly picks an own model is refused when the flag is off for the scope's organization; a value kept as it was is not refused, so other columns stay editable. A read that finds an own model with the flag off answers `own_unavailable` (`not_enabled`), and the call skips as `classifier_not_configured`. It never moves the organization onto the billed classifier on its own. Rejected (red team, 2026-10-19): answering LangWatch Evals Preview, which would silently start metering and capping an organization that chose its own key. _Revised 2026-11-04:_ the flag is on by default, on cloud and self-hosted alike, and stays as a kill switch until it is removed. Billing is unchanged: decision 7 keeps an own-key call unmetered, and the hosted path still meters and caps.
5. **Model provider resolves; it does not judge.** `ModelProviderApi.resolveDecisionModel({ projectId })` answers one of: `langwatch` (the hosted classifier), `own` (model, wire format, the endpoint with any account id filled in, and the decrypted key), or `own_unavailable` (the model the project picked, and why it cannot run: the flag is off, no provider row, the row is off, or no key). The endpoint is the catalogue's own: a row's custom base URL is not honoured, so a key is only ever sent to the provider that issued it. _Revised 2026-11-02:_ an entry may name `{placeholders}` filled from fields of the provider row. A plain field (Cloudflare's account id) is URL-encoded into a path segment. An Azure endpoint field gives only its resource name, read from an `https` URL on `openai.azure.com`, `cognitiveservices.azure.com` or `services.ai.azure.com` with no port or credentials; the catalogue writes the host suffix and path itself. Any other host answers `own_unavailable` (`endpoint_invalid`). Containment is unchanged: an Azure key reaches only the customer's own Azure resource. An entry may also name a row field that replaces its model name (an Azure deployment name) and send its key in `api-key` instead of a bearer token. Model provider adds the feature flag Api as a peer. It reaches no Instant Evals module, so no cycle forms.
6. **Callers pass the resolved model to the judge leaf.** Evaluation and Instant Evals call the resolver and hand the `own` answer to the leaf's `judge` or `classify` as `decisionModel`. The leaf keeps calling no peer (ADR-174 decision 13). Instant Evals adds model provider as a peer, which closes no cycle.
7. **An own-key call is unmetered and uncapped.** The leaf skips the unknown-project refusal, the $1 check, the rate limiter and the spend record. It reports zero billed tokens and a price of zero, so a run or query records nothing. Instant Evals skips its budget hold and its $1 check for a project on an own model. The leaf calls an own model on any install, since the key is the customer's (this narrows ADR-174 decision 14). Instant Evals' own access check is unchanged, so off cloud a run still needs Instant Evals released there first. _Revised 2026-11-05:_ a project whose column resolves to `own` is released by that alone, whatever `release_instant_evals`, the opt-in or a Connect license says, and needs no LangWatch classifier configured. Those gates now govern LangWatch's own model only. The access answer carries `hostedReleased` beside `released`, so the judge picker offers own models without Evals Preview. `own_unavailable` releases nothing.
8. **Each wire format is one channel in the leaf.** A decision model channel takes the key per call, translates the leaf's questions into the provider's request and its answer back into verdicts. The hosted classifier channel is unchanged.
9. **A key failure never falls back to LangWatch.** No retry against another model, no charge. Each failure names a reason with a next step, and never shows the provider's own error text:
   - no provider row, row off, no key, or the key or account refused (401, 402, 403): `classifier_key_invalid`, "check the key in Settings > Model Providers", not retried;
   - rate limited (429): `classifier_rate_limited`, "wait and retry";
   - provider down, timed out or unreadable answer (5xx, network): `classifier_provider_unavailable`, "retry later";
   - the text too large (413): `classifier_input_too_large`, a skip and not an error, since the trace's size is nothing to fix;
   - any other refusal (400, 422): `classifier_failed`, "retry; if it keeps failing, pick another decision model".
     For an LLM judge these are error results (ADR-174 decision 7). For a run or a judged query they are skips, counted by reason.
10. **The hosted path is untouched.** A project on LangWatch Evals Preview runs exactly as before: same classifier, same Connect choice off cloud, same meter, same cap.

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
- **Jev with an own key.** Out of scope for now (the user, 2026-10-19). Reversed 2026-11-02, see the revision log.

## Consequences

- The Default models table grows a fifth column, and every hard-coded role list gains `INSTANT_EVALS`.
- An own-key project's Instant Evals usage shows no cost in LangWatch; the provider bills the customer.
- A decision model with smaller limits than the hosted one may skip long texts as `classifier_input_too_large`; Clef Flash truncates a long text itself.
- The answer is cached per project for a minute in model provider, so a page of rows or a busy monitor reads the column once, and concurrent callers share one lookup. A change to the column or the flag takes up to a minute to reach a running page, and a run that spans the change may mix verdicts from two models. Every page still checks the $1 total for a hosted project.
- The search bar keeps classifying on LangWatch's key, unmetered (ADR-144), whatever the column says.
- A run's estimate for an own-model project still shows the hosted price, with no $1 standing. Showing no price is a follow-up.

## Revision log

- **2026-11-02.** Decision 5 widened as written there, so Azure OpenAI Decisions and Microsoft Decision 1 on Foundry join the catalogue on the customer's Azure row (api-key only; Entra tokens stay out). Jev joins on a TypeSafe key, and Jev, Microsoft Decision 1 and Liquid d1.1 through OpenRouter, Rune through Fireworks. The rejected "Jev with an own key" is reversed. No wire format was added. The settings picker now offers exactly what `listDecisionModelsForProject` offers, so every pick runs.
- **2026-11-04.** Decision 2 revised: decision model labels drop the provider and read as the model name, as chat models do. The judge picker's built-in heading reads "Decision models", not "LangWatch".
- **2026-11-06.** Decision 2 revised again: the picker drops provider headings, so a label names provider and model, and an entry may set a shorter picker title (`pickerLabel`, "Decisions API" on OpenAI's and Azure's gpt-6-luna) where the row's provider icon names the provider. LangWatch Instant Preview is titled "Evals Preview" ("Optimized for evals"). Unpickable entries come back as listed but disabled rows with an add-a-key line, so every pick still runs. LangWatch's decision models (Evals Preview, Scenario Judge Preview, Search Preview) head the Instant Evals picker. Only Evals Preview is hosted; the others are listed as coming soon, display only, until the catalogue names a column they fill, and show only with `release_instant_evals_judge_router` on. The Judge picker lists no decision model, LangWatch's or the organization's own: the Judge column feeds only the scenario judge (`scenarios.judge`), whose chat calls a decision model does not answer, so it lists the LLMs and the server's role rule is unchanged. An LLM-judge evaluator runs a decision model through its own model field, which never reads the Judge column. Picking Evals Preview for Instant Evals stores it, so a wider scope cannot take the column over. Later the same day, OpenAI's and Azure's labels drop the "(gpt-6-luna)" suffix and read "OpenAI Decisions" and "Azure OpenAI Decisions", naming the provider and the API, not the model; the model they call is unchanged.

## Open questions

- Entra ID, SigV4 and service-account tokens: an own model carries one static key, so a provider needing a fetched token has nowhere to put it.
- Splitting the LLM judge picker into "Evals Preview" and "Judge Preview" is a later issue.
