# Feature cleanup — progress

Three stages per feature, per the standard in
[`feature-cleanup-review.md`](../../best_practices/feature-cleanup-review.md).

| Stage | What | Writes |
| --- | --- | --- |
| 1 · review | Audit the feature against R1–R8 | `<feature>.md` |
| 2 · verify | Adversarially check the review: struck claims, missed problems, over-reach | `<feature>.md` (a Verification section) |
| 3 · enact | Apply the verified review, commit by commit | source |

Stage 1 and 2 are read-only over source. Stage 3 writes, and runs in small
batches because features share `platform/app/src/features/errors/logic/{codes,presentation}.ts`.

`dataset.md` is the reference review. The orchestrator builds dataset's
enactment by hand first; stage-3 agents copy that, they do not invent it.

## Status

| Feature | Files | Lines | 1 · review | 2 · verify | 3 · enact |
| --- | ---: | ---: | --- | --- | --- |
| dataset | 35 | 9147 | done | | commits 1-4 |
| secret | 9 | 639 | done | |  |
| stored-object | 22 | 2592 | done | |  |
| api-key | 24 | 4102 | done | | hidden-name list |
| trace | 181 | 29990 | done | |  |
| governance (ent) | 143 | 24097 | done | | 3 layers cut |
| scenario | 90 | 16758 | done | |  |
| gateway | 79 | 16278 | done | |  |
| langy | 85 | 15111 | done | |  |
| authz | 51 | 13531 | done | | engine gate |
| automation | 78 | 10925 | done | | TS2554 fixed |
| coding-agent | 52 | 10059 | done | | registry + typecheck |
| analytics | 30 | 9917 |  | |  |
| ops | 49 | 9508 |  | |  |
| organization | 20 | 7885 |  | |  |
| experiment | 40 | 7106 | done | |  |
| identity | 48 | 6956 |  | |  |
| model-provider | 33 | 6595 | done | | REST statuses |
| billing (ent) | 42 | 6287 | done | |  |
| prompt | 19 | 6156 |  | |  |
| webhook (ent) | 20 | 5056 |  | |  |
| topic | 29 | 4783 |  | |  |
| github | 34 | 4668 |  | |  |
| evaluation | 31 | 4284 |  | |  |
| dashboard | 16 | 3889 |  | |  |
| scim (ent) | 20 | 3860 |  | |  |
| workflow | 16 | 3814 |  | |  |
| metric | 26 | 3334 |  | |  |
| suite | 22 | 3136 |  | |  |
| project | 12 | 2740 |  | |  |
| annotation | 11 | 2691 |  | |  |
| evaluator | 14 | 2619 |  | |  |
| user | 11 | 2567 |  | |  |
| agent | 14 | 2269 |  | |  |
| data-retention | 18 | 1792 |  | |  |
| role | 10 | 1658 |  | |  |
| feature-flag | 16 | 1653 |  | |  |
| monitor | 8 | 1605 |  | |  |
| share | 11 | 1601 |  | |  |
| licensing (ent) | 16 | 1571 |  | |  |
| log | 13 | 1366 |  | |  |
| sso (ent) | 5 | 1202 |  | |  |
| auth | 9 | 971 |  | |  |
| presence | 9 | 731 |  | |  |
| data-privacy | 6 | 391 |  | |  |
| entitlement | 5 | 338 |  | |  |
| managed-provider (ent) | 7 | 305 |  | |  |
| audit-log (ent) | 5 | 206 |  | |  |
| notification | 5 | 114 |  | |  |

49 features, 268,000 lines of feature-server source. 15 reviewed, 7 partly enacted.

Every feature package typechecks clean — server, contract, web and separate
test configs — as of `c078e26d88`. That was not true before it: the test-move
commit left `coding-agent-server` with ten TS2352s that main does not have.

Stage 1 fans out; stage 3 does not, until the dataset enactment is finished by
hand — agents copy a proven reference, they do not discover a design.

## Where the value has actually been (2026-08-31)

The lint count moves slowly — 866 to 864 over a long pass — because the two
biggest policies are inventories (`legacy-feature-fragment` 465,
`feature-source-layout` 207) that shrink only when whole modules move. The real
finds sit underneath them, and they repeat:

**A feature package holds the live copy; `platform/app` holds the tests.** Seen
three times in one pass — the analytics ClickHouse cluster (385 cases on a copy
nothing imports, one on the copy that runs — see
`analytics-clickhouse-divergence.md`), `TraceIOAccumulationService`, and
billing's `UsageLimitService`. The check is cheap: for a duplicated or extracted
module, ask which copy has importers and which has the tests. When the answer
differs, the tests are guarding nothing.

**Extraction widens types to break a dependency.** The analytics filter
translator lost `Record<FilterField, …>` for `Record<string, …>` because
`FilterField` lived in `platform/app`, taking the guarantee that every filter
field has a handler with it. Publishing the vocabulary from the contract gets it
back. Worth grepping for wherever a package copy of a platform module names
`string` where the original named a union.

**A long method is nearly always a phase list with no names.** Every
`service-quality` fix in this pass — `accumulateIO` (194 lines),
`accumulateAttributes` (141), `extractAttributes` (140), `checkAndSendWarning`
(184), `SuiteExecutionService.execute` (98) — was a sequence of steps writing
into one mutable bag, where the order was the contract and nothing said so. They
split the same way: one private method per step, taking what it needs, and a
top-level method that reads as the list.

Refactor behind a test net in the package, not the one in `platform/app`, and
sabotage it first — a `GROUP BY` replaced inside a comment passed 368 tests and
proved nothing.

## R1 (a repository, not a client, comes into the service) — where it stands

`prisma-containment` is at 25. Most entries are `adapters/postgres.*.adapter.ts`
naming `PrismaClient` only to type the option they hand a repository; the fix
there is the one applied to saved views — the repository declares
`Pick<PrismaClient, "…">` for the delegates it uses, and the port carries a
portable record so nothing above the repository names a generated type.

Two are the real thing, services that take the client itself:

- `gateway/server/src/services/gateway-end-user-caps.service.ts` — a free
  function taking `prisma: PrismaClient` and running two `findMany`s
  (`gatewayBudget` filtered to `ATTRIBUTED_USER`, then
  `gatewayBudgetBucketBoundary` for those ids). Both tables already have reads
  on `PrismaGatewayBudgetRepository`, and everything the function computes from
  a row is already covered by `GatewayBudgetResource` in the contract, so the
  port methods can return that and need no mapper.

  **What blocks it is composition, not the package.** Its caller,
  `platform/app/src/server/api-router.ts:128`, binds `prisma` because it has no
  budget repository in scope: `app.gatewayStores.budgets` is
  `GatewayBudgetSpendPort | undefined` — the ClickHouse spend reader — and the
  Postgres `GatewayBudgetRepository` is not on the App at all. Finishing this
  means adding it as an app dependency, which is a `platform/app` change with no
  local typecheck, and its only test is an integration one needing containers.
  Landing the package half alone would leave a service nothing constructs.

- `gateway/server/src/services/gateway-usage.service.ts` — 366 lines,
  constructor takes `PrismaClient`, and it imports the `Prisma` namespace rather
  than only the client type, so it is likely writing raw SQL. Not yet examined.

The remaining `service-quality` entries are a different problem and should not
be mistaken for this one: they are big classes whose surface a contract
mandates (`ExperimentService` alone has ~40 methods across four subjects —
experiments, runs, DSPy, workbench). Splitting those means splitting the
contract and every transport that mounts it, not moving a dependency.

## Round: the credential and permission services (2026-08-31)

`ProjectService` joins `ExperimentService` as a confirmed contract-mandated
surface — its contract declares 29 abstract members, the trace-destination
cluster among them, so the 513-line class is not a mechanical split either.
Three of the `service-quality` entries are now known to be this shape. Treat
that list as "needs a contract change", not "needs tidying".

With structure blocked there, this round went at the untested services in the
domains where being wrong costs the most. 84 feature services still have no
test naming them; 13 are security- or money-adjacent, and the API-key cluster
was the largest of those.

**One live defect, found and fixed.** `ApiKeyGrantPolicyService.writeBindings`
guarded its replace-revoke on `attached.attached.length` alone. `attachBindings`
runs with `onDuplicate: "skip"`, so a binding the caller asks for again comes
back in `duplicates`, not `attached` — and when *every* requested binding
already exists, `attached` is empty, the `notIn` clause is dropped, and the
revoke runs as `where: { apiKeyId }`. Every grant on the key, gone.

The path is live and reachable from the settings UI: the edit drawer always
sends `bindings`, `ApiKeyLifecycleService.update` always passes `replace: true`,
so renaming a key without touching its scopes silently strips its permissions.
Change one scope and `attached` is non-empty, which is why it survived. Fixed
by building the keep-list first, with a regression scenario in
`specs/api-keys/scope-based-permissions.feature`.

**A correction to the untested-service sweep.** It matches on class name, so a
service covered only through its facade reads as untested. `ApiKeyService`'s
685-line suite in `repositories/__tests__` drives seven services at once and
already covered some of what looked uncovered. The suite is decent — a real
in-memory `ApiKeyRepository` fake rather than mocks — but it is filed under
`repositories/` while testing services, and its 22 `it`s are flat under one
`describe`. Worth splitting along service lines eventually; not urgent.

Now covered directly, all sabotage-verified:

- `ApiKeyVisibilityService` — a key from another organization sees nothing; a
  project a binding pulled in but authorization refuses is dropped; past the
  candidate bound it throws rather than returning a truncated list that reads
  as complete.
- `ApiKeyGrantPolicyService` — the escalation ceiling, both halves: the
  permission each role stands for, and the check that the granting user holds
  it. Plus the tenant boundary on scopes and the personal-workspace owner
  check. Six `@unit` scenarios in `scope-based-permissions.feature` were bound
  to nothing; that file is now 22/22.
- `ApiKeyTokenResolutionService` — revoked, expired and non-matching secrets;
  the opportunistic re-hash and its tolerance of a failed write; the
  cross-organization project boundary. Recorded there: resolution is not
  authorization, which is why naming an unbound project still resolves — the
  ceiling check in the auth middleware is what refuses it.
- `AuthzGrantSnapshotService` — the cache key separates organizations and
  callers, the epoch is what makes a revocation take effect, and the age bound
  is the backstop for whatever fails to bump it.

## Round: R2, and what a dead config object was hiding (2026-08-31)

**R2 has a smaller true surface than the file listing suggests.** Seven files
are named `*.service.ts` and contain no class. Only some of those are wrong:

- `trace-attribute-redaction.service.ts` genuinely was — `compile`, `apply` and
  `apply-with-precompiled-matchers` are one object with state, and the third
  existed only so a request could compile once. Now `TraceAttributeRedactor`.
- `model-provider-defaults-scopes.service.ts` was fifteen lines, one function,
  one caller in the same directory. Folded in.
- `langy-prompt-value.service.ts` was a byte-identical copy of a function the
  contract already exported. Deleted; the memory service reads the contract's.
- `trace-query-evaluation.service.ts` and `langy-conversation-memory.service.ts`
  are pure transforms whose callers bring a fresh input each time. A class
  there holds nothing and would be the static-holder shape `layer-class`
  already flags. **Leave them.**
- `gateway-end-user-caps.service.ts` is the known R1 entry, blocked on
  composition.

The `.rules.ts` files are not R2 candidates either — that suffix is the trace
package's established name for a module of pure rules, and there are fifteen
of them.

**The find.** `webhook-delivery.service.ts` is the largest service in the repo
and its class was forty lines of one-line delegations under 1300 lines of
module functions. Extracting the batching policy (`WebhookBatchPlanner`) left
one unused-variable warning behind: `WEBHOOK_DELIVERY_OUTBOX`, declared and
never referenced — and it was already dead before the extraction.

It is not dead code. It is the outbox configuration the delivery process was
supposed to hand the runtime, and the builder chain ended at `.transient()`
without the `.outbox(...)` call its three governance siblings all make. Every
webhook send has therefore been running on runtime defaults:

    retry window   4m03s   (1+2+4+8+16+32+60+60+60s, the default backoff)
    instead of     68h36m  (the ladder the code documents)
    lease          30s instead of 120s
    concurrency    1 instead of 4

A receiver down for a ten-minute deploy lost its webhooks permanently. Fixed,
with six cases that fail if the call is removed again.

**Worth generalising:** an unused-variable warning on a *configuration object*
is a wiring bug, not dead code. A sweep for other process managers missing
`.outbox(...)` found one more candidate, which turned out to configure it in
its pipeline file instead — so webhook delivery was the only one.

## Round: the automation graph-trigger cluster (2026-08-31)

Eight files under `automation/server/src/services/` implement one thing:
evaluating a graph trigger. Two of them implemented nothing.

`graph-trigger-evaluation.service.ts` was a re-export of
`graph-trigger-evaluator.service.ts`, which re-exported eight symbols from
`trigger-evaluator.service.ts` — three files to reach one implementation,
against CLAUDE.md's rule that consumers name the module owning the symbol.
The class it also held bound a deps object and forwarded one call; its
instance method had one caller and its static, commented *"Test seam for
characterisation coverage"*, had one: the test. **A layer that exists so a
test can get in is the test telling you the layer is in the way.** The
evaluator takes its own deps now and the barrel file is gone.

`TriggerEvaluatorService` was a bag of six unrelated statics behind a
`create()` nothing had ever called — every member was static, so the instance
it minted had no methods. Five of the six had exactly one caller and moved to
it. One pass-through went away entirely: its caller already held the deps it
was forwarding.

**Sabotage found the one relocation that was unguarded.** Four of five were
already covered. The fifth — whether a ClickHouse "too many rows" refusal
becomes a skipped evaluation or an error — could be disabled with nothing
failing. It now has six cases, including that a *different* failure still
propagates: a classification that widened would turn an outage into a quiet
"skipped" and the trigger would stop alerting with no sign.

**A tension worth knowing about.** `trigger-evaluator.service.ts` is now
sixteen shared types plus one shared helper — a types module wearing a
service name. It cannot be renamed while it lives there: `lintServer` requires
every path under `services/` to match `<subject>.service.ts`. The real home
for those types is the contract package; that is a larger move than this
round, and until then a `*.service.ts` holding no service is sometimes the
layout policy's doing rather than a smell.

### Webhook delivery, continued

`webhook-delivery.service.ts` went from 3 tests to 83 across four suites. The
send path is covered through the real intent handler rather than by exporting
internals — including that a receiver's Retry-After is honoured on a retryable
failure and DROPPED on a terminal one, and that a disabled endpoint drops its
batch silently on purpose. `payloadToRow` is covered too: the cost is integer
nano-USD rendered to a decimal string, and one case pins why that is integer
arithmetic and not a divide — at nine million dollars of spend, `value / 1e9`
answers a different amount from the one billed.

The class also stopped declaring its methods as `ReturnType<typeof runDeliver>`;
they are `IntentExecutor<DeliverPayload>` and friends now, so a reader can see
which payload each executor accepts.

## Round: an id and a tenant id, side by side (2026-08-31)

A sweep for methods taking two or more **same-typed** positional parameters
found 23 across feature services and repositories. Nearly all pair a resource
id with a tenant id — two strings in a fixed order, where transposing them
still compiles.

What the swap actually costs is worth being precise about, because it is not
a leak. Both governance services scope correctly (read by id, then compare the
row's organizationId), so a transposed call looks a row up *by an organization
id*, finds nothing, and reports "not found" — quietly, forever. The gateway
and secret repositories put both values in the `where`, so the query simply
misses. Wrong, silent, and hard to spot in review.

The layering made it easy to see: in gateway and in secret, everything ABOVE
the repository already took a single input object, and the positional pair
survived on the last hop — the one nearest the query.

Converted, with the compiler enumerating call sites rather than a grep:

- **gateway** — `tryGet`, `tryGetWithHealth`, `tryGetDetail`, `tryCacheRuleGet`,
  `tryGuardrailGet` on the contract and service, plus the cache-rule and
  guardrail repositories. Fully inside the package.
- **governance** — the anomaly-rule and ingestion-source lookups, archive, and
  `ingestionSourceRotateSecret`. These are contract-declared, so the change
  reached three tRPC procedures and two CLI route handlers in `platform/app`.
  Those were read one at a time: the package typechecks, `platform/app` does
  not, so none was rewritten by pattern alone.
- **secret** — `get` and `delete` on the repository.

One finding fell out of it: the secret suite's stub repository ignored
projectId (`get(_projectId, id)`), so nothing there could have caught a lookup
crossing projects. It scopes by both now and the suite still passes.

Named parameters do not stop a *deliberate* mis-assignment. They stop an
accidental one, and they make the call site say which value is which — the
`auth-cli.ts` ingest-source handlers carry a comment worrying about exactly
this, and now read `{ id: sourceId, organizationId: tokenRecord.organization_id }`.

Seven pairs remain, in scenario, presence, scim, managed-provider and ops.

### Also this round

`data-retention.service.ts` forwarded an error class from its contract that
nothing imported from there. Most of what the re-export sweep flagged is
legitimate and should not be "fixed": `testing.ts` files are a package's test
surface, and the langy `eventing.*-index.adapter.ts` files look like barrels
but are the targets of declared `exports` subpaths, imported by seventeen
files. Deleting those would have broken all of them.

### The sweep was under-counting

The first scan only matched signatures on one line, so its 23 was a floor.
Re-run multi-line aware, the count of methods putting a **tenant id beside
another same-typed argument** was 48. It is 31 now — trace (5), scenario (4),
api-key (3), gateway (3), then singles. Some of the remainder are private
key-builders (`key(projectId, sessionId)`) where the risk is confined to one
file; the rest are worth doing.

**The worst one was in the gateway's virtual keys**, and it is the argument
for the whole exercise:

    rotateSecret(id, organizationId, newHashedSecret, newDisplayPrefix,
                 previousHashedSecret, previousSecretValidUntil, tx?)

Five strings in a row, where positions three and five are the incoming
secret and the one being retired. Transpose them and it compiles: the key
keeps working on its old secret, the newly issued one is filed as retired,
and the rotation reports success having rotated nothing. Its one caller —
platform/app's legacy VirtualKeyService — passed exactly those seven
arguments positionally.

Two of the same port's members, `updateConfig` and `setRoutingPolicy`, were
abstract, implemented in Prisma, and called from nowhere in the repository.
Gone.

**Also worth recording, because it recurs:** in gateway, secret, presence and
the virtual-key port, the named-object form was already in use *in the same
file* — `create(input, transaction?)`, `findPageInOrganization(input)`,
`tryGetWithHealth(input)`. The positional pairs were not a house style, they
were the members that never got converted. That makes the remaining 31 a
finishing job rather than a decision.

## Round: the sweep finished, and a second dead guard (2026-08-31)

The tenant-adjacent positional pairs are done: **48 → 3**, and the three left
are file-local (two key-builders and a handle helper called only from within
its own class), where a swap cannot cross a boundary and the compiler could
not have helped either way.

Two more of the seam were worth naming. `TraceApp` accepted
`{ projectId, evaluationId }` and `{ projectId, spanId, protections }` and
took them apart to call the port positionally — the same unwrapping as
`isManagedProvider` and `ModelProviderService`. Whenever the object exists on
one side and the positional list on the other, the unwrapping IS the seam.

The span dedup port produced the round's best simplification. Its three
operations each took `(tenantId, traceId, spanId)`; they take a `SpanDedupRef`
now, and because platform/app declared its own restatement of the same three
methods plus an adapter that forwarded each one, giving both sides the same
type deleted the adapter — 34 lines. What made that safe without a
platform/app typecheck is a type test in the package: a plain object with the
three methods is assignable to `TraceSpanDedupPort`. If a private member ever
makes that false, the test says so where it can be read.

### The second dead source-reading guard

`trace-dedup-oom-safety.unit.test.ts` enforces the `LIMIT 1 BY` ban across
five files — a rule with a real production cost. It had stopped loading,
because two of those files moved into feature packages and its paths counted
`../`. One missing file takes twenty-one rules out of CI and shows up as a
single red test file.

That is now two of these found in one day (the other was Langy's documented
card examples). **Both were dead for the same reason and neither was noticed**,
because the symptom is one red file rather than N unguarded rules.

Reviving it exposed the sharper problem: every assertion is a substring check
against source text *including comments*, and these files explain in prose the
exact patterns being asserted. `toContain("max(UpdatedAt)")` was satisfied by
a comment about why the dedup uses it — the SQL could drop the aggregate and
the guard would pass. Comments are stripped before assertion now, verified in
all three directions.

Neither rule had actually been violated while its guard was down.

## Round: hunting for more dead guards, and the model resolver (2026-08-31)

Finding two dead source-reading guards in one day made the obvious question
worth answering: are there others? Two sweeps say no.

The first resolved every `__dirname`-relative source read in every test file —
20 of them — against the filesystem. All resolve. The second ran **all 125
feature packages**: 18,410 tests, one package with failures, and both of those
are integration tests that want Redis rather than dead suites. So the two
found earlier were the only ones, and the class is now understood well enough
to recognise on sight.

Worth keeping in mind about that class: the symptom is one red *file*, not N
unguarded rules, which is why both survived several layout commits. And once
revived, their substring assertions were satisfied by the comments in the
files they read — the prose explains the very patterns being asserted.

### ModelProviderResolutionService

Untested, and it decides the model every AI surface runs on. Fifteen cases
now hold the precedence (project over team over organization, feature
override over role default, newest on a tie, another project's configuration
never consulted).

The case worth having is not a preference. A Codex model bills the user's
ChatGPT plan through a backend licensed for coding harnesses and light
assists, so it may run Langy and the FAST assists and nothing else. The
resolver steps over one configured anywhere else — and the refusal is a
different error from "nothing is configured", because one sends the customer
to change the model and the other to set one at all. Both pinned, plus the
same model resolving fine where the licence does cover it.

`findAlternate` on that class remains uncovered: one caller, and it is the
"offer a different tier" path behind a picker rather than the resolve every
request takes.

## Round: one licence rule, three throw sites, one code (2026-08-31)

The Codex licence — a model billing the user's ChatGPT plan may run Langy and
the FAST assists and nothing else — is enforced at three points. Only one of
them threw something a caller could act on.

    resolver (choosing a default)   ModelRestrictedForFeatureError  ✓ coded
    defaults writer (saving one)    ModelRestrictedForFeatureError  ✓ coded
    execution (running one)         new Error("...")                ✗

The third is exactly the case CLAUDE.md names: a knowable failure the caller
can act on, degraded to a generic "unknown error" plus a trace id. And it
explains a smell two features away — `scenario-infra-error.ts` classifies this
failure by grepping the message for `CODING_ASSISTANT_SURFACES_ONLY_NEEDLE`,
because there was no code to match on. **The needle exists because the code
did not.**

`model_restricted_for_execution` is a separate code from the feature one on
purpose: the remedies differ. One names the feature whose default to change;
the other is a model arriving at a surface it cannot run on, usually a value
saved before the restriction existed. Message kept byte-identical so the
scenario classifier's needle still matches — it can move to the code when
someone wants to, but it no longer has to grep.

Worth noting for the next one of these: adding a code is a three-file change
the standard spells out — the error class, `logic/codes.ts` (sorted), and
`logic/presentation.ts` in the same commit — and `codes.unit.test.ts` is
runnable, so the registration is verifiable without a platform/app typecheck.

There turned out to be a **fourth** site, in the app rather than a package:
`codexGatewayModel.getCodexVercelAIModel`, which refuses a restricted model
reaching the AI gateway. It threw a plain Error too. Both it and the litellm
path throw the same code now; the error carries the two sentences the two
paths need — the gateway knows the feature it was running, the litellm path
knows only that this is not a coding-assistant surface — because the remedy
is the same either way. Both are pinned in the contract's error test, since
they are what the classifier matches.

And the classifier is not itself a smell: its other eight rules match Node
TLS codes, OpenAI's own rejection prose and module-loader failures. **Needle
matching is the only option for an error we did not throw.** The codex rule
was the single one pointed at our own code, which is why it stood out.

**The execution gate runs twice and the two are not redundant**: once on the
model reference before any lookup, once on the provider it resolved to,
because a model id that looks ordinary can still reach the Codex provider
through a row id (`mp_<id>/<model>`). Deleting either fails a different set of
cases.

### A red test found on the way in

`presentation.unit.test`'s meta-echo guard was failing on
`automation_trace_filter_invalid`, which rendered `meta.reason` into the
customer's sentence — "That filter query isn't valid auth_failed". The echo
is deliberate (it is the filter parser's own line, ours, clamped by
`safeProse`), so it is recorded in ALLOWED_PER_CODE with the reason, which is
what the failure message asks for. The exemption is per-code: a different
entry echoing `reason` is still caught.

### And a third, in the same area

`model-provider-defaults.codex-refusal` — two cases, both failing with
"Cannot read properties of undefined (reading 'id')". `setDefault` grew a
second parameter (the caller, who is both the author of the value and the
actor of the write) and the test still passed one argument.

That one matters more than an ordinary red test, because both cases carry a
`@scenario` annotation for "The server refuses Codex outside the allowed
surfaces". The parity check counts a scenario as bound when a test claims it
— it does not know the test throws before reaching the assertion. So the
spec read as covered while the guard behind it was inert. Restored, and
sabotage-verified against the write-side check it exists to protect.

**Three red guards in one afternoon, all in the same feature.** The shapes
differ — a path that moved, a signature that grew an argument, an assertion
satisfied by a comment — but the failure mode is the same: the suite goes
quiet and nothing says the rule stopped being enforced.

## Finding: platform/app's server unit tests are widely red on this branch

Chasing dead guards into `platform/app`, I ran
`pnpm --filter @langwatch/web test:unit run src/server/` in the background. It
was still going after about twenty-five minutes, 71 of roughly 557 files in,
so I stopped it. **Of those 71 files, 66 had failing cases.**

It is not one systemic cause. Three sampled:

- `server/rbac/**` — "App not initialized. Call initializeDefaultApp() first."
  `checkRoleBindingPermission` asks `getApp().permissions.isOnEngine` before
  falling through to the binding resolution the tests exercise, and the tests
  populate a prisma fake but not the App singleton. **Fixed** — one
  `wireDefaultTestApp()` per file, 65 cases restored.
- `server/gateway/__tests__/budget.service.unit.test.ts` —
  "Cannot read properties of undefined (reading 'listIdsByOrganization')": the
  service reaches a collaborator the test's fake does not provide.
- `server/clickhouse/__tests__/metrics.unit.test.ts` —
  "register.getSingleMetric is not a function": a prom-client mock that no
  longer matches.

Different shapes, one theme: **the code grew a dependency and its test did
not follow**. Same family as the three dead guards found earlier today, and
the same consequence — a rule stops being enforced and nothing says so.

Two things I could not establish and did not assume: whether CI sees the same
(I cannot run it), and whether this predates the branch. What I did check is
that none of it comes from this session's work — the failing files were not
touched by any commit here, and the symbols involved (`listIdsByOrganization`,
prom-client's register) are nowhere near it.

The RBAC cluster was worth fixing on sight because of what it guards: the
tenant-isolation regression test, the API-key ceiling, and the poisoned-binding
cases. Deleting the org-membership predicate from the direct-binding query now
fails that regression test; before, it produced no failure at all, because the
case never reached the query.

**The rest is a decision, not a cleanup.** Sixty-odd files is a body of work
whose owner should choose whether it is fixed, quarantined, or already known.

### The same remedy does NOT work for `server/api`'s RBAC tests

`server/api/__tests__/rbac*.test.ts` fail with the same "App not initialized",
and `wireDefaultTestApp()` takes 118 failures down to 4 — which is exactly why
it is worth spelling out that **it must not be used there.**

The four that remain are the POSITIVE cases ("still grants a genuine member"),
and their failing is the tell. These tests pass their own prisma fake to
`hasProjectPermission`; with a default App wired, the decision routes through
`getApp().permissions` and never reads the fake, so everything denies. The
negative cases then pass for the wrong reason. Sabotage says so plainly:
with the wiring in place, deleting the org-membership predicate from the
direct-binding query fails NOTHING. Loud failure traded for silent green that
guards nothing.

`appPermissionsMock()` is the obvious next idea and is also wrong here: it
backs the App's permissions with the very resolvers under test, so the call
recurses and the suite hangs. It exists for tests of OTHER things that need a
permission decision, and its consumers pair it with
`vi.mock("~/server/api/rbac", ...)`, which is not available to a test of that
module.

What these need is an App whose `permissions.isOnEngine` answers false, so the
legacy binding resolution runs against the fake each case supplies. Left
alone rather than guessed at.

The difference from `server/rbac/**`, which the same one-liner did fix: those
call `checkRoleBindingPermission` directly, `isOnEngine` answers false under
the default App, and the fake IS used — proven by the predicate sabotage
failing there.

## Round: saved views (2026-08-31)

`SavedViewService`, untested. Twenty-one cases, two rules.

**Ownership.** A personal view belongs to one person, and reaching for
somebody else's is refused as NOT FOUND — the same class and the same message
as an id that does not exist. A case now asserts the two are
*indistinguishable*, because a distinct error would confirm the id names a
real view belonging to another user. The refusal also happens before the view
is touched.

**Seeding.** First access seeds a project's defaults; a project that has some
gets the rest backfilled by NAME, so a renamed view is not re-created. Both
are for the legacy tab strip only — the traces-v2 lens UI brings its own
defaults from code, and seeding on its behalf would double-populate the tab
strip a customer sees. That guard has its own case, and sabotaging it fails.

**A comment that described an error nobody wrote.** `delete` and `rename` both
carried `@throws {SavedViewNotOwnedError}`. No such class exists anywhere in
the repository — grep finds it in exactly those two docblocks. What they throw
is `SavedViewNotFoundError`, which is the more interesting fact, so the
comments now say why rather than naming a fiction.

That is a third shape of the same underlying problem this tracker keeps
recording: **the code moved and the thing describing it did not.** A path, a
signature, an assertion satisfied by prose — and now a docblock.

## Round: the citations (2026-08-31)

The `@throws {SavedViewNotOwnedError}` finding suggested a sweep: comments
that name something the repository does not have. Two ran.

**`@throws` naming a class that does not exist** — one hit across every
feature package, and it is `@throws {Error}`, which is fine. The saved-view
one was the only real instance.

**Spec citations** — 1,588 "Spec:" / "See" references to a `.feature` file in
comments; **23 named a path that is not there.**

Twelve were the wrong root. The repository has sixty-odd spec directories —
`specs/`, `platform/app/specs/`, one per feature package, one per SDK — and
these cited the top-level path for a file living in another. That is the
"second specs root" trap in a new guise, and it is worth remembering that a
basename search under `specs/` alone reports these as GONE when they are
merely elsewhere. Repointed.

Three more had genuinely moved and were confirmed **by their `Feature:` line**
before repointing, never by name similarity. That mattered: `agent-issue-
reports` looked like a rename of `agent-report-discovery` by name, and is
not — the spec `bug-reports.ts` actually wants is "Bug Reports Intake".

Six occurrences are left alone, and deliberately. Two sit in generated Prisma
output (the same spec, cited from two generated files). The other four name
specs with no confident equivalent anywhere: workflow-agent-mapping,
install-cli-card, drawer-opt-in-routing and scenario-job-id-uniqueness. **A confident
pointer at the wrong spec is harder to notice than a broken one**, so a guess
would have made them worse.

### The spec that was cited but never written

`saved-view.api.ts` has always opened with "Spec:
packages/features/dashboard/specs/saved-views.feature". No such file existed,
and the dashboard spec beside it covers the shared dashboard service without
mentioning saved views. So the service's rules were written down nowhere.

They are now — nine scenarios, each bound to a case from the previous round,
`check:feature-parity` reporting 9/9. Written after the tests rather than
before, which is not the order the repo asks for; the behaviour predates both,
and a spec describing what the code does beats a citation of a file nobody
wrote.

## Round: the first of the two R1 violations is gone (2026-08-31)

`applicableEndUserCaps` — a free function holding a `PrismaClient` and running
two `findMany` calls — is now `GatewayEndUserCapsService`, taking a repository
and the ledger's spend port.

The earlier note said this was **blocked on composition**: its caller had no
budget repository in scope, only `prisma` and the ClickHouse spend port. That
turned out to be the wrong conclusion. The block was only real if the app had
to build the repository itself; a `GatewayEndUserCapsAdapter` inside the
package does the wiring, the app calls that, and the Prisma repository stays
private — the same shape `WebhookEventsAdapter` and `PrismaGatewayAdapter`
already use here.

The two reads went onto `GatewayBudgetRepository` and answer with **portable
records**, so the port carries no generated Prisma row across the repository
boundary. Worth noting how the record was arrived at: the first draft guessed
its fields (`periodAnchor`, `limitUsd: unknown`) and the compiler rejected
every wrong guess in turn — the period helpers want
`currentPeriodStartedAt`/`resetsAt`/`lastResetAt`/`cycleAnchorAt`, the bucket
key wants `providerKey`, and the money adapter wants something with
`toString()`. Reading the consumers would have been faster than guessing.

Twelve cases where there were none. The join between Postgres and the ledger
is the bucket scope id, and getting it wrong shows a customer somebody else's
spend — or, more quietly, zero.

**One R1 violation left**: `gateway-usage.service.ts`, 366 lines, constructor
takes a PrismaClient and it imports the `Prisma` namespace rather than only
the client type, which suggests raw SQL. Not yet examined.

## R1 is clear (2026-08-31)

**No service in any feature package holds a `PrismaClient`.** The count was
two when this tracker started listing them; both are gone.

The second, `GatewayUsageService`, held one for exactly two reads — the
organization's project ids, and a label for each key the ledger reported spend
against. Both moved to collaborators: `listIdsByOrganization` already existed
on ProjectService, and the virtual key repository gained `findMetaByIds`.

**The service depends on neither whole interface.** It declares the one read
it makes of each:

    GatewayUsageProjectsPort     { listIdsByOrganization }
    GatewayUsageVirtualKeysPort  { findMetaByIds }

`ProjectService` and `GatewayVirtualKeysPort` satisfy those structurally, so
composition passes what it already held — and an integration test satisfies
them with two queries against the database it just seeded, no cast, no
PrismaClient anywhere near the service. That is worth repeating elsewhere: a
narrow port is what let the awkward caller stay honest instead of being handed
a mock of a forty-method interface.

The key-label read is now scoped to the organization as well as the ids. It
was not leaking — the ids come from that org's own spend rows — but a read
that can only answer within one tenant cannot be made to leak by a caller that
assembles its list somewhere unexpected.

**And the tightening needed a test to mean anything.** The first sabotage of
it passed: the existing fake ignored `organizationId`, so handing the read the
wrong organization changed nothing. The fake filters on both now. A guard
added without a fake that can tell the difference is not a guard.

`Prisma.Decimal` stays in that file. It is the money type the aggregates are
summed in, not a database handle; replacing it is a separate decision.

## Comment blocks: 0 (2026-08-31)

`comment-block-size` caps a block at 60 lines. Four were over. All four were
file headers that had grown into a table of contents, so the reader who
arrived at the code an explanation was about to describe had to scroll back
up to find it.

Nothing was deleted. Each header kept the part that explains why the module
exists, and each section moved onto the declaration it is about:

| module | was | narrative moved onto |
| --- | --- | --- |
| `langy-conversation-memory.service.ts` | 68 | `extractLangyConversationMemory` |
| `api/src/rest/validation.ts` | 63 | `SchemaFailure`, `MalformedRequestError` |
| `server/api/idempotency.ts` | 84 | `TAKEOVER_AFTER_MS`, `readStoredBody` |
| `app-layer/identity/birth.ts` | 66 | `bear`, `claimAddress` |

The rule this leaves behind: a header says why the module exists. Anything
that explains a decision belongs on the declaration that makes it, because
that is where the next reader will be standing.

## service-quality: 10 -> 7 (2026-08-31)

The policy caps a service module at 500 lines, a method at 80, and a method's
complexity at 24. Three came off the list, and each overrun turned out to name
a real design problem rather than a formatting one.

**`span-normalization.service.ts`** was a class plus three loose functions that
no method of the class called. One of them, `enrichRagContextIds`, is declared
on `TraceSpanNormalizationPort` — so the app adapter implemented the port by
importing a free function alongside the service it already held. Two imports,
one collaborator. They are methods now, and the package exports the class
alone. The over-long method was `decodeOtlpSpan`, 83 lines of one object
literal with two inline mappers buried in the middle; `decodeEvents` and
`decodeLinks` came out.

**`trace-ingestion.service.ts`**: half of `handleOtlpTraceRequest` was
bookkeeping — five `let` counters, a five-arm switch that only incremented
one of them, five `setAttribute` calls, and an arithmetic at the end.
`SpanIngestionTally` holds it instead, keyed by the status the result already
carries, so the switch disappears and one place knows that only `dropped` and
`failed` are a rejection. Two local helpers also duplicated `TraceRequestUtils`,
which this file's own sibling already imports.

**`project.service.ts`**: 38 of its 513 lines were two module-level functions
called once, one of which rebuilt a sixteen-entry `Set` on every call. Now
`ProjectSlugService.mint`. It is a `.service.ts` and not a `.rules.ts` because
that is what the strict layout admits under `services/` — a `.rules.ts` there
would have been a new `feature-source-layout` violation, which is how the
existing `*.rules.ts` files elsewhere in the tree got onto that list.

### Tests came first where the refactor was risky

`handleOtlpTraceRequest` — the whole OTLP traversal, three drop rules, the
coding-agent filter and the tally — had no coverage at all; only
`ingestNormalizedSpan` did. Sixteen tests were written and passing against the
OLD implementation before any of it was touched. The two that matter most say
a filtered span and a deduped span are **not** rejections: the transport turns
`rejectedSpans` into the sender's HTTP answer, so counting either would tell a
healthy SDK it is failing.

Every extraction was sabotage-checked. `decodeEvents` returning nothing fails
two tests; the rejection sum counting `filtered` fails two; a malformed
resource throwing instead of degrading fails one; the slug's diacritic strip
fails one, its dash trim three, its suffix length ten.

### A dead guard, reported not fixed

`ProjectSlugService.mint` refuses a slug that equals a reserved top-level route
(`admin`, `api`, `settings`, ...). It cannot fire. The slug is always
`${slugified}-${idPrefix}`, so it is `settings-`, never `settings`, and no
reserved name contains a dash. Making it guard the slugified NAME instead
would newly refuse a project called "Settings" — a product decision, not a
cleanup one. The test records what the code does and says why it does not
claim more.

## service-quality: 10 -> 4, and the baseline ratcheted (2026-08-31)

Three more services came off, and the seven stale baseline entries went to
four.

**`authz-grants.service.ts`** (511): the three checks every grant write runs
were private methods that each took a `repository` parameter, and all six
call sites passed the same value — `this.options.repository`, destructured
on the line above. `AuthzGrantGuardsService` holds it once. 410 lines.

The thirteen ledger pass-throughs below stayed. They are contract methods
with 100+ call sites between them; collapsing that facade is a redesign.

**`experiment.service.ts`** (749) held four sub-domains. The evaluations
workbench came out as three collaborators — slug minting, reference
checking, and the seven workbench operations — and `PostgresUniqueConflict`
went to an adapter, which is where reading P2002 and the driver's two
constraint shapes belongs. 415 lines.

**`usage-limit.service.ts`** (827) answered two unrelated questions: report
a hard limit to our internal channels, and warn the customer's own admins
on the way up. `UsageWarningService` owns the second. The alert cooldown was
three exported module-level singletons in a service module and is now an
adapter. 320 lines.

### The baseline only shrinks if something shrinks it

`service-quality-baseline.json` is meant to ratchet, but nothing tightens an
entry when the file gets smaller — it keeps the old number and the file is
free to grow back. Three had drifted, holding 310 lines of regrowth room
between them, measured with the policy's own
`collectServiceQualityCeilings` and applied as min(existing, measured).

The other four are stale for the opposite reason: the file has grown PAST
its ceiling. Tightening cannot fix those and must not paper over them.

## Where to put things, learned the hard way

Two attempts added a violation instead of removing one, and both are worth
knowing before the next extraction:

- **`services/` admits only `<subject>.service.ts`.** A `.rules.ts` there is
  a `feature-source-layout` violation, which is how the existing `*.rules.ts`
  files elsewhere in the tree got onto that list. `ProjectSlugService` is a
  service for that reason.
- **`ports/` wants an abstract Port class.** Structural interfaces that
  composition satisfies with plain objects are not that, so shared types go
  in the feature's contract package instead — where the usage-limit ones now
  sit, next to the notifier inputs that are the same kind of thing.
- **Technology qualifiers are dotted.** `postgres.unique-conflict.adapter.ts`,
  not `postgres-unique-conflict`.

## Sabotage found four untested paths

Every extraction was sabotage-checked, and four sabotages passed, which is
the interesting result — each one named code that no test exercised:

| what was broken | nothing failed, so |
| --- | --- |
| skipping the workbench reference check on save | 16 tests written for it |
| storing run results in the version snapshot | 1 test written for it |

`WorkbenchMissingReferenceError` — the refusal a customer reads as "this
evaluation points at something that no longer exists" — was tested nowhere
at all. The new tests pin the distinction that matters most in that path: an
evaluator or workflow service that is DOWN must not read as one that is
GONE. One is a retry; the other tells the customer to go and fix a workbench
that is fine.

Elsewhere the existing tests carried the moves, and said so under sabotage:
the grant guards fail 2/2/1, the ingestion tally 2, the slug transforms
1/3/10, the usage-warning rules 1/1/1.

## A dead guard, reported not fixed

`ProjectSlugService.mint` refuses a slug equal to a reserved top-level route
(`admin`, `api`, `settings`, ...). It cannot fire: the slug is always
`${slugified}-${idPrefix}`, so it is `settings-`, never `settings`, and no
reserved name contains a dash. Making it guard the slugified NAME would
newly refuse a project called "Settings" — a product decision, not a cleanup
one. The test records what the code does rather than claiming more.

## Running total

architecture-lint violations 845 -> 832 for the session, with
`comment-block-size` at 0 and `service-quality` at 4.
