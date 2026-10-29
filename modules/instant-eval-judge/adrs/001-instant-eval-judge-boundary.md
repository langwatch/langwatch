# ADR-001: Instant-eval-judge is a dependency leaf

**Status:** Accepted

**Behavioural contract:** [Instant Evals judge pricing](../specs/instant-eval-judge-pricing.feature)

**Related:** [The Instant Evals judge call is metered](../../../dev/docs/adr/174-instant-evals-judge-call-is-metered.md),
decision 13, and `dev/docs/ARCHITECTURE.md` section 5.
[A routed judgement is priced from the summed cost of its calls](../../../dev/docs/adr/190-instant-evals-routed-judgement-is-priced-from-summed-call-cost.md) (ADR-190, proposed)
supersedes ADR-174 decisions 6, 8 and 11 for routed calls and amends decision 13.

## Context

Evaluation needs to judge with Instant Evals, and Instant Evals already reaches evaluation through
gateway and trace. Evaluation depending on Instant Evals would close a peer cycle. ADR-174 decision
13 puts the judge in a leaf module that both depend on and that depends on no peer.

## Decision

`instant-eval-judge` owns what a judge is asked and answers (questions, verdicts, skip reasons,
the classifier's limits) and two pricing rules: the classifier's input-token rule, moved from
Instant Evals unchanged and used for unrouted calls, and the routed rule of ADR-190, which prices a
judgement from the summed cost of its calls. Instant Evals and
evaluation import them from this module's contract. It also owns LangWatch's cloud classifier client,
its key, rate limits and settings, its own tables, the $1 check and the metered judge method
(ADR-174 decisions 10, 13 and 14).

## Public surfaces and transports

`@langwatch/instant-eval-judge-contract` exports the question, verdict and judgement types, the skip
reasons, the classifier limits and wire format, the token estimates, the pricing rule, the Instant
Evals request type the ledger rows carry, the $1 free budget, the two judge errors, the config
slice and the priced event's schema. There is no transport.

`InstantEvalJudgeApi` has three methods:

- `judge` is the metered call. In order, it refuses a project it has not learned
  (`instant_eval_project_unknown`), refuses off LangWatch cloud (`classifier_not_configured`),
  refuses an organization that is not usage-billed once its spend rows reach $1
  (`instant_eval_free_budget_exhausted`), classifies, prices, and appends the priced fact. A refusal
  is returned, never thrown, and calls no classifier. The spend id comes from the caller's retry key.
- `judge` and `classify` also take an optional route. A call with a route goes through the router,
  which may call a decision model, Jev and an LLM judge, and answers with a judgement that carries
  its cost and the input tokens that cost covers (`routedInputTokens`). A call without one takes
  the single hosted classifier call.
- `queryHoldPricing` returns the rate a judged query is held at: the dearest input rate any backend
  the route table can reach, never below the classifier rate, at the one markup. It is computed
  once at boot (ADR-190 decision 7).
- `classify` is the unmetered call Instant Evals uses for its own runs and queries, which keep their
  own spend rule in wave 1.
- `isClassifierConfigured` tells Instant Evals whether LangWatch's key is set, so it can choose this
  classifier or Connect on its first call.

`@langwatch/instant-eval-judge-process` exports the process module only.

## Dependencies

No peer `*Api`. The contract depends on `zod`, `@langwatch/config` and `@langwatch/handled-error`.
It cannot import the trace contract, which depends on it through Instant Evals' contract, so the
text cuts that need trace's helper live in the process half. The process half reads one peer's event
contract, never its Api: billing's `lw.billing.usage_billing_changed`. A peer subscriber is not a
dependency edge. It reads project's `Project` and organization's `Team` rows through their declared
Postgres shares to place a project (round 46 E1, R40); a share is not an Api edge either.

## Persistence

Three Postgres tables, created in migration `20261007140001_instant_eval_judge_tables` (ADR-174
Schema). Each is the leaf's own copy of a fact; none has a relation or foreign key.

- `InstantEvalJudgeProject`, keyed by `projectId`: retired by round 46 E1. Nothing writes or reads it;
  a contract migration drops it later. The judge places a project through the shares instead.
- `InstantEvalJudgeUsageBilling`, keyed by `organizationId`: whether the organization is usage-billed,
  when that was true, and whether a catch-up wrote it.
- `InstantEvalJudgeSpend`, keyed by `organizationId` and `requestId`: one judge request's spend in
  nano USD. The organization's total is the sum of its rows.

One Prisma repository claims each table, with an in-memory twin. Every query names the project or
the organization. Each write is safe to repeat, since a peer event is delivered at least once:

- The billing row keeps the newest stamp, and a real fact wins a tie over a catch-up
  (`usageBillingFactWins`, ADR-174 decision 17). The Postgres update states the same rule in SQL, so
  two folds racing on one row cannot both land.
- A spend row is never rewritten. A request that already has one keeps it.

## Runtime and registration

`defineProcessModule("instant-eval-judge")` with its repositories, `InstantEvalJudgeModule` as its
Api and two eventing modules. Installed by api, worker and tasks from each app's generated list.

The pipeline `instant_eval_judge_facts` (aggregate `global`) appends no events. Its two peer
subscribers fold project's created fact and billing's usage-billing fact into the tables above.

The pipeline `instant_eval_judge_spend` (aggregate per organization) has one command,
`recordSpendPriced`, which appends `lw.instant_eval_judge.spend_priced` keyed by organization and
request id. Its own subscriber writes the spend row from it. Gateway's peer subscriber writes the
ledger row from the same fact (ADR-174 decision 13), so the two never disagree on a price. Gateway
reads only this contract, so the request type lives here rather than in Instant Evals' contract.
A fact whose project has no team is logged and dropped; one gateway cannot write yet is retried.

The cloud classifier is an HTTP channel built only when the key is set, wrapped in a Redis token
bucket per project and one for the deployment. The module owns and closes it.

The router adds two outbound HTTP channels, each built only when its key is set: the hosted
decisions endpoint (`http.instant-eval-hosted-decisions.channel.ts`) and an LLM judge channel for
Anthropic and OpenAI (`http.instant-eval-llm-judge.channel.ts`). The module owns and closes them.
The leaf now has four upstreams. It still calls no peer Api.

Pricing has two rules. An unrouted judgement is priced from its input tokens at the classifier's
rate, under the model `jev`. A routed judgement is priced from the summed cost of its calls at
the same markup, under the model `langwatch-judge` and the rate version
`instant_eval_judge_router@<version>x<markup>`. A judgement that carries a cost, including 0, is a
routed one. It also carries `routedInputTokens`, the input tokens its cost covers; a page or run
costs its routed cost plus its other input tokens at the classifier's rate, so a run that mixes
routed and unrouted calls is billed correctly. The flag `release_instant_evals_judge_router` gates routing per organization.

## Environment and configuration

Moved from Instant Evals with the client, under the same names:

- `JEV_API_KEY` (secret, optional): LangWatch's classifier key. Unset, the judge answers
  `classifier_not_configured`.
- `JEV_BASE_URL` (https only) and `JEV_MODEL`.
- `INSTANT_EVAL_GLOBAL_TOKENS_PER_SECOND` and `INSTANT_EVAL_TENANT_TOKENS_PER_SECOND`.
- Whether the install is LangWatch cloud, from the shared config.

Added by the router (ADR-190), all read on LangWatch cloud only:

- `INSTANT_EVAL_JUDGE_ROUTES` (JSON, optional): the route table. Unset, every slot asks the hosted
  classifier alone.
- `INSTANT_EVAL_JUDGE_PRICING` (JSON, optional): per-backend input and output prices, with an
  optional long-context tier and a version. A backend a route can reach with no price refuses boot.
  Unset, the hosted classifier is priced at its published rate.
- `INSTANT_EVAL_DECISIONS_API_KEY`, `INSTANT_EVAL_ANTHROPIC_API_KEY` and
  `INSTANT_EVAL_OPENAI_API_KEY` (secrets, optional): LangWatch's keys for the router's decision
  model, Anthropic and OpenAI legs.

## Errors

`InstantEvalClassifierUnavailableError` and `InstantEvalFreeBudgetExhaustedError`, moved from
Instant Evals with their codes. The judge returns its three refusal codes as answers, never throws
them (ADR-174 decision 7).

## Contracts and validation

The question schemas are Zod. The scenarios under `specs/` are bound by the contract's unit tests.
The process half binds the fold, judge call and spend scenarios of Instant Evals' judge model
spec, and the classifier scenarios moved with the client. Its repository
contract test runs every case against memory and Postgres.

## Consequences

Instant Evals and evaluation price and name a judgement from one place, and neither depends on the
other for it.
