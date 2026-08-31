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

## Names that lie, and a guard that read its own documentation (2026-08-31)

### `fallible-result-naming`: 34 -> 27

`try` in this repo means one specific thing — this call can answer "nothing",
and the caller must handle that. Five methods disagreed, in both directions.

Two claimed it and could not keep it. `TraceSpanDedupPort.tryConfirmProcessed`
and `tryReleaseOnFailure` return `void`; their `try` meant "best effort,
swallows its own failures", a different property the type cannot show. They
are `confirmProcessed` and `releaseOnFailure` now.
`tryAcquireProcessingLock` keeps its prefix, because it really does return
null when the store is unreachable and the caller then ingests the span
anyway rather than dropping a customer's data over a cache.

Three had it and did not claim it: `IdentityEmailService.resolveEmail` and
`verifiedEmailsOf` return null to mean "read the legacy `User.email` column
instead", and `TraceAnalyticsRepository.findByTraceIdWithApplied` returns null
when there is no stored projection row yet.

**Seven were left alone deliberately**, and this is the useful part of the
sweep — not every violation is a naming slip:

| what | why not renamed |
| --- | --- |
| `TraceSummaryStore.get`, `TraceDerivedStore.get` | `FoldProjectionStore` from `@langwatch/eventing` declares `get`; the executor calls it generically |
| `TraceLegacyReadPort.getById` and two siblings | the port mirrors the app's `TraceService` on purpose, so the transports can be package-owned before the service moves |
| `TraceSummaryRepository.findByTraceId` | shares its name with `EvaluationRepository.findByTraceId`, which is not flagged — a textual rename hits both |

### The browser-capability guard was reading comments

`ui-backend-access` and friends are regex searches over the raw file text, so
a module that NAMES a capability in order to explain why it avoids it was
reported as using it. Both files it flagged were prose:

- `apps/ui/src/behavior/public-config.ts` — its header explains that the
  browser has no `process.env`. Saying so was the violation.
- `.../surfaces/api-snippet/get-prompt-snippets.ts` — a JSDoc `@param`
  reading "Optional label/tag to fetch (e.g. production)" matched
  `/\bfetch\s*\(/`.

`withoutComments` now blanks comments with spaces before the scan, using the
TypeScript scanner rather than a regex so a `//` inside a string is not
mistaken for one, and keeping every offset aligned with the file on disk. A
guard that punishes the comment documenting the guard teaches people to
delete the comment.

### One conversion, written six times

`nanoUsdToDecimalString` appeared six times and `usdToNanoUsd` three, in two
variants that disagree: four use `BigInt(Math.round(nano))`, the two webhook
copies use `BigInt(Math.abs(value))`, which throws a `RangeError` on a
fractional input. **Not currently reachable** — `gateway_spend.CostNanoUSD` is
`Int64` and selected raw — so it is a difference between copies, not a bug.

Four of the six were inside two packages and are now one each, under
`adapters/nano-usd.adapter.ts`. The remaining two, in `gateway-server` and
`enterprise/composition/api`, share no dependency that could reasonably hold
money formatting. **Consolidating those needs a new workspace package**, which
is a dependency-graph and lockfile change and should be its own decision.

Removing the pair also took the databricks puller from 753 lines to 704 —
that file is 14 module-level functions with a stateless five-method
pass-through class at the bottom, which is the R2/R3 shape in its purest
form, and is the obvious next target.

### Still nothing tested the sign

Sabotage again found the gap: dropping the minus in either conversion changed
no test. A credit on a vendor bill is negative, so that turns a refund into a
charge of the same size. Sixteen tests now cover the boundaries — the ninth
decimal place, rounding half-up at it, exponent notation, the refusal of an
unparseable amount, and both sign paths.

## Where this session ended

architecture-lint violations **845 -> 822**, with `comment-block-size` at 0,
`service-quality` at 3, and `service-quality-baseline` at 4.

The three service-quality files left are large facades whose overruns need a
real redesign rather than an extraction: `authz.service.ts` (808/775),
`langy-conversation.service.ts` (1275/1250), `organization.service.ts`
(1415/1388).

Two categories were examined and deliberately not started, because each is a
migration rather than a cleanup:

- **`private-runtime-export` (16)** — all sixteen are one file,
  `packages/features/trace/server/src/index.ts`, exporting its repositories,
  stores and projections. 76 references across `platform/app` consume them.
  This is the core-application extraction, not a tidy-up.
- **`api-transport-import-boundary` / `prisma-containment` in `apps/api`** —
  `custom-evaluators.ts` needs `PrismaClient` only as a type, but narrowing it
  would narrow the tRPC output type the client receives. The file's own
  docblock already names the fix: the Workflow vertical should own the query.

## Services that were modules of functions (2026-08-31)

The shape the original complaint named — "tons of tiny files with loads of
functions in them that don't really do very much, it could really just be one
very simple class" — turns out to be one recurring pattern, and it is now
measurable. A sweep for `services/*.service.ts` carrying four or more
module-level functions found nine. Seven are done.

| service | was | what it was |
| --- | --- | --- |
| `puller-databricks-warehouse-cost` | 10 fns + stateless facade | five methods that only renamed the function they called |
| `persist-cap` | 14 fns + **two** facades | six statics AND three instance methods forwarding to the same functions |
| `scenario-target-prefetch` | 7 fns | `tryFetch` threading seven of its own fields into them as arguments |
| `langy-conversation-memory` | 9 fns, **no class at all** | named `.service.ts`, held none |
| `saved-workbench-chart` | 5 fns | a presenter and four parsers |
| `gateway-usage` | 6 fns | six summary helpers |
| `webhook-delivery` | 25 fns + facade | **not done** — see below |

### What the pattern costs, concretely

`ScenarioTargetPrefetchService.tryFetch` is the clearest example. It is a
four-branch dispatch on the target type, and every branch was handing the
fetchers the service's own fields, because the fetchers lived outside the
class and could not reach them. The workflow branch passed nine arguments.
Each branch is now one line.

`AutomationPersistCapService` had the duplication in the other direction:
two public APIs for one behaviour, and neither was the implementation. Two of
its six statics had no call site anywhere.

### The tool, and where it stops working

`fold_into_class.py` (in the job scratch, not committed) does the mechanical
move: it takes a function with its docblock, re-signs it as a method, indents
it, drops it into the class and rewrites the call sites. Three failure modes
found the hard way, each now asserted:

- **A bare reference is not a call.** `.map(cleanId)` and
  `toPayload: confirmedDeliverPayload` pass the function as a value, so a
  regex looking for `name(` misses them and the name silently goes out of
  scope.
- **Docblock styles vary.** A one-line `/** ... */`, a block ending `*/` on
  its own line, and a block ending `... one. */` on the last text line each
  need different detection. Getting it wrong orphans the docblock and leaves
  it floating above the next declaration — which is exactly the defect
  141a2c210e left in `langy-conversation-memory.service.ts` and this session
  fixed.
- **Brace matching over raw text is unsafe** in a file with template
  literals. It put nine members outside the class in `webhook-delivery`.

### webhook-delivery is left, deliberately

25 functions, 1207 lines, and it is the production delivery path. It defeats
the text tooling on both counts above, and it carries a hazard neither the
compiler nor a type check would catch:

```ts
const WEBHOOK_DELIVERY_OUTBOX = { retryDelayMs: webhookRetryDelayMs, ... };
```

That const is evaluated at module load, **before** the class below it is
initialised. Folding `webhookRetryDelayMs` into the class and naming the
static there directly is a temporal-dead-zone `ReferenceError` at import
time, with a clean typecheck. It has to become an arrow, or the const has to
move below the class.

Doing this one properly wants an AST-based move rather than text heuristics.
The attempt was reverted; the file is untouched and its 83 tests pass.

### Coverage found by sabotage, again

Four more untested paths, all in code being restructured:

| what nothing guarded | tests added |
| --- | --- |
| `ScenarioTargetPrefetchService` — the whole service | 10 |
| `LangyConversationMemoryService` — the whole service | 14 |
| the automation cap's ten-minute plan cache | 2 |
| the nano-USD sign, both directions | (in the money commit) |

The langy one is the one to read: it decides what the model sees. Its rules —
an errored call is not a referent, a digest with no ids is not a referent,
the same resource touched twice is the thing as it now stands, and the block
must declare itself DATA with its ids unverified — were all unguarded.
Breaking any of the five now fails between one and three tests.

## Where this session ended, updated

architecture-lint violations **845 -> 822**. `comment-block-size` 0,
`service-quality` 3, `service-quality-baseline` 4.

## The sweep, finished except one (2026-08-31)

The earlier sweep counted only `function` declarations. Counting module-level
arrow consts too — `const x = (a) => {...}` is a module-level function by any
useful definition — found the list was longer. Seventeen services are now
folded; `webhook-delivery` is the one left.

| service | helpers folded |
| --- | --- |
| `workflow-nlp-execution` | 7 |
| `currency` | 5 |
| `trace-attribute-extraction` | 5 |
| `graph-trigger-heartbeat` | 4 |
| `notification` (billing) | 5 |
| `dataset` | 4 |
| `suite` | 4 |
| `audit-log` | 3 |
| `webhook-health` | 3 |
| `evaluator-native` | 3 |
| `coding-agent-pull-request-assignment` | 3 |
| `anomaly-alert-dispatcher` | 3 |
| `auth` | 1 |

### The tool, and the four ways it was wrong

Each failure mode below silently produced something that compiled or looked
right, and each is now an assertion that stops the run instead:

1. **A bare reference is not a call.** `.map(cleanId)`,
   `filter(isAgentTarget)`, `toPayload: confirmedDeliverPayload` pass the
   function as a value; a rewrite looking for `name(` misses them.
2. **Docblocks end three different ways** — `/** ... */` on one line, `*/` on
   its own line, and `... text. */` trailing the last line. Missing a case
   orphans the comment above the next declaration, which is the defect
   141a2c210e left behind and this session fixed.
3. **Brace matching over raw text is unsafe.** Template literals and comments
   contain braces. The class's closing brace is `}` in column 0; that is the
   reliable marker.
4. **An expression-bodied arrow is not a method.** `const x = (a) => expr` and
   `=> ({...})` need an explicit `return` first. Detecting the end by
   searching for the next `};` swallowed whole declarations — including, once,
   the class being folded into. The rule is now: an arrow is foldable only if
   `=> {` appears before any line ends a statement.

The tool refuses rather than guessing on (1) and (4). Nine expression-bodied
arrows were converted by hand.

### Type errors the test runs could not see

Vitest transpiles without checking types, so a package whose tests pass can
still fail `tsc --noEmit`. Three did, and one was mine: the usage-limit split
moved `BillingCooldownCache` to an adapter and imported the adapter's runtime
values but not its type. Six annotations referred to a name that no longer
existed, and 241 tests passed over it.

**Every package touched this session now typechecks — 18 of them, checked one
by one.** Running a package's tests is not the same as checking it.

### More untested paths, found the same way

| what nothing guarded | why it matters | tests |
| --- | --- | --- |
| `CurrencyService` (whole service) | picks the currency a customer is billed in | 20 |
| `DatasetService.getDatasetWithRecords` | what a run is handed, and how much of it | 11 |
| the audit-log `args` bound | written on every privileged action | 8 |
| the health card's rate and p95 | a customer reads these to judge their receiver | 7 |

Two of the currency tests could not exist without mocking geoip. The rule is
that a private address SKIPS the lookup, and a real lookup of `10.0.0.4`
returns nothing anyway — so the outcome is identical whether the guard runs
or not, and only the absent call proves it. The first draft passed under both
sabotages.

### Two more dead guards, recorded not fixed

Following the `ProjectSlugService` precedent:

- `WebhookHealthService.p95Of` clamps its index with
  `Math.min(length - 1, ...)`. For any whole n at least 1, `floor(0.95n)` is
  already at most `n - 1`, so the clamp never binds.
- `DatasetService.selectRecords` clamps a negative index with
  `Math.max(_, 0)`, but the schema is `z.number().int().nonnegative()` and
  refuses one first.

Both tests say what the code does rather than crediting a guard that cannot
fire.

## Where this session ended

architecture-lint violations **845 -> 822**. `comment-block-size` 0,
`service-quality` 3, `service-quality-baseline` 4. Every touched package
typechecks and its tests pass.

## The sweep is finished, and three files say why they are not (2026-08-31)

Twenty-nine services folded. The three left are left for one reason, and it
is the same reason each time: **their module-line ceiling is ratcheted flush
against the file, and folding costs a line.**

| service | lines | ceiling |
| --- | --- | --- |
| `dataset-chunk.service.ts` | 1014 | 1015 |
| `seat-event-subscription.service.ts` | 604 | 605 |
| `organization.service.ts` | 1414 | 1388 (already over) |

`seat-event-subscription` was folded, measured 606 against 605, and
**reverted**. Extracting a method to pay for it makes the module LONGER — a
signature, a docblock, a closing brace and a call line, for a body that only
moves — so the usual remedy does not apply. Raising the ceiling to fit an
improvement is the thing the baseline exists to stop.

Each of these needs a real reduction first. `seat-event-subscription`'s
144-line `createSeatEventCheckout` has a coherent piece in it — cancelling
stale PENDING subscriptions from an abandoned checkout and deleting their
orphaned invites — that comes out cleanly once something else has bought the
lines back.

### webhook-delivery, on the second attempt

The 25-function file that defeated the tooling two rounds ago went through
cleanly once the tool's four bugs were fixed. Three things the compiler could
not have caught:

- `WEBHOOK_DELIVERY_OUTBOX` holds `retryDelayMs: webhookRetryDelayMs` at
  module scope, evaluated **before** the class initialises. Naming the folded
  static there is a temporal-dead-zone `ReferenceError` with a clean
  typecheck. It is an arrow now. That 90 tests import the module is the proof.
- `...attributedColumns(x)` is a spread, and `...` ends in a dot, so a
  lookbehind guarding against member access skips it.
- `toPayload: confirmedDeliverPayload` passes the function as a value.

A fourth, found by the compiler: rewriting call sites AFTER assembling the
class turns `async appendReplayToEndpointStream(` — which reads exactly like
a call preceded by a space — into `async this.appendReplayToEndpointStream(`.
The tool rewrites the original source now, where a declaration still says
`function name(` and cannot be mistaken for one.

### Two more coverage gaps, and one lesson about how to look

| what nothing guarded | tests |
| --- | --- |
| the audit-log `args` bound — written on every privileged action | 8 |
| the health card's success rate and p95 | 7 |
| `ilikeContains` lowering the COLUMN, not just the query | 2 |

The last is the interesting one. There WAS a case-insensitive test — query
`"HELLO"` against `"say hello world"` — but the query is lowered before it
reaches the comparison, so only an upper-case COLUMN exercises the column's
own lowering. Removing `.toLowerCase()` passed 168 tests. An in-memory half
that became case-sensitive would quietly stop an automation firing on traces
the trace list still shows, which is the SQL-versus-read divergence that
parity table exists to catch and records shipping once before.

**And a lesson about sabotage itself:** breaking `SpanCostService.coerceToNumber`
changed nothing in `trace-server`'s suite, which reads as "untested". It is
not — its tests live under `platform/app/src/runtime/app/__tests__/`, and the
package's own run never reaches them. Under the suite that actually covers
it, the same sabotage fails six. A package-scoped run is not proof that a
package's code is untested.

## Where this session ended

architecture-lint **845 -> 822** across 30 commits. `comment-block-size` 0,
`service-quality` 3, `service-quality-baseline` 4. Every touched package
typechecks and its tests pass, and no violation was traded for another.

## The same fold, in repositories and adapters (2026-08-31)

`services/` was only the first third. `repositories/` and `adapters/` hold the
same shape, and — usefully — carry no `service-quality` ceiling, so nothing
blocks them the way it blocks the last three services.

| module | helpers folded | what it was |
| --- | --- | --- |
| `canonical-log.adapter.ts` | 26 | a 12-line class forwarding to 26 functions, plus **two** `export {}` blocks re-exposing six |
| `prisma.model-provider.repository.ts` | 11 | row mappers and JSON coercions |
| `prompt-template.adapter.ts` | 8 | **three** layers of the same thing |
| `webhook-provider.adapter.ts` | 7 | secret encrypt/decrypt/redact |
| `trace-full-record.repository.ts` | 8 | reference resolution and metrics |

### Three names for one function

`prompt-template.adapter.ts` is the clearest specimen of the pattern this
whole cleanup is about:

```
function buildPromptTemplateContextValue(...)                       // 1
static readonly buildContext = buildPromptTemplateContextValue      // 2
export const buildPromptTemplateContext = Adapter.buildContext      // 3
```

Three names, and the class owned none of them. Layers 2 and 3 are gone and
the two consumers call the class, per the repo's own rule against
re-exporting for compatibility. `unboundInputPlaceholder` had no consumer at
any layer and is private.

### Two callers that were already wrong

Folding surfaces these because the compiler starts checking what a re-export
was hiding:

- `session-groups.clickhouse.repository.integration.test.ts` called
  `prepareCanonicalLogRecords({...})` with one argument where two were
  required. It worked by accident — `redaction` was `undefined` and nothing
  touched it, because that fixture runs with PII redaction DISABLED.
- `sha256` and `stableStringify` were exported from the log adapter with no
  importer anywhere.

### Coverage, again where it counts

| what nothing guarded | why it matters | tests |
| --- | --- | --- |
| webhook secret redact/persist | `redact` is what stops header values and the signing secret going back to the settings screen | 13 |
| `LOG_PROCESSING_SHARDS` clamp | zero makes the lane modulo divide by zero | 6 |

The webhook one is worth reading. The `__kept__` marker is both the redaction
placeholder AND the write protocol — submitting it back means "leave this one
alone" — which makes redact/persist a round trip. The case that matters most
is the refusal: a `__kept__` arriving with a CHANGED url must be rejected,
because "leave it alone" would otherwise send the old destination's
credentials to a new one. Dropping redaction fails five tests; accepting a
kept marker on a changed url fails one.

### Four more tool fixes

The fold tool now also knows that a generic declaration `name<T>(` is not a
bare reference, that a name inside a string literal (`Record["bodyType"]`) is
data, that a parameter type literal's `;` does not end an expression-bodied
arrow — the first `=>` decides that — and that a spread call `...name(` is
still a call even though `...` ends in a dot.

## Round: repositories, and five copies of a money rule

Folded five more: the gateway spend-events (9), metric-data-point (13),
trace-list (7), gateway-budget (16) and webhook-endpoint (14) repositories,
plus the two admin pullers (11 and 9). But the folds were the smaller half of
this round.

### The duplication the folds exposed

Folding forces you to read a file end to end, which is how these surfaced.

| duplicated | copies | where |
| --- | --- | --- |
| the gateway spend cursor | 2 | spend-events repository and its adapter |
| `isStorageAnchoredVersion` + the `"2026-05-07"` anchor | 2 | trace contract and trace-list |
| `nanoUsdToDecimalString` | 4 | gateway, governance, webhooks, enterprise API |
| `parseSummedNanoUsd` | 5 | the same four, plus a second copy inside the gateway |
| `usdToNanoUsd` | 2 | gateway and governance |
| `dimension` / `dimensionPath` / `safeResponseText` | 2 | the two admin pullers |

Every copy agreed. That is the reason to fix it now rather than later: these
are rounding rules for money and a version boundary that decides which branch
a trace is read on, and the first fix applied to one copy is what makes the
same value read two ways depending on which surface is asked.

The money conversions now live in `@langwatch/gateway-contract`, which
governance, webhooks and the enterprise API composition can all legally depend
on — enterprise features already import feature contracts. No re-export shims;
every consumer was repointed, including two `platform/app` tests and
`ingestionRoutes` that were reaching through `@langwatch/gateway-server`.

### A comparison that nearly deleted real behaviour

Nine helpers are same-named across the two admin pullers. An `awk` range
ending at `/^}/` terminates on the `}: {` that closes a destructured parameter
list, so for the five helpers taking destructured parameters it compared four
lines of boilerplate and reported "identical". Six of the nine actually
differ, carrying each provider's own cursor shape, watermark rewind and
adapter id. Whole-body comparison is the only kind that answers this question.

### Where the coverage actually is

Two sabotages passed, and neither meant the code was unguarded:

- `trace-list`'s helpers are covered by thirteen ClickHouse integration tests
  under `platform/app`, not by the package suite.
- so is the whole gateway budget repository.

Same lesson as `SpanCostService` earlier: a green package suite under sabotage
says the package suite does not reach that path, never that nothing does.

### One more temporal dead zone

`SUCCESSOR_SEEK_QUERY` was a module const interpolating `orderedAfter` and
`orderedBefore`. Folding those onto the class made the const a read of a class
that does not exist yet. It is now a `private static readonly` field, which
initialises after the static methods are installed. Unlike the webhook outbox
case, the compiler caught this one.

### Tool fix

The fold's bare-reference guard required a leading word boundary but not a
trailing one, so `selectsRole` reported as a bare `selects`.

## Round: the pullers, and two guards worth reading

Folded the two admin pullers (11 and 9), the Copilot Studio Dataverse puller
(15), the activity-monitor repository (8), the coding-agent ClickHouse
repository (2), the Databricks Genie puller (25) and the Copilot Studio trace
mapper (34 — into a class it did not have).

### The security check that explained itself to nobody

`isDatabricksWorkspaceOrigin` existed twice: a URL parse in the adapter with
twenty lines explaining why the rule exists, and a regex in
`PullDestinationService`. Only the regex ran. The adapter's copy had no callers
anywhere in the repo.

The arrangement was deliberate — the docblock says enforcement belongs on the
write path so the rejection reaches whoever is editing, and so the adapter can
still be pointed at a local fixture by its tests. What was not deliberate is
that the enforcement and the explanation had come apart.

The service now calls the adapter's. Consolidating a security check is only
safe in one direction, so the surviving one is at least as strict as the regex
it replaces: the URL parse used to allow a path where the regex allowed only a
bare origin, so it now refuses a port, path, query or fragment and checks the
same hostname character shape. Every existing refusal test passes unchanged.

That path-versus-origin disagreement was pinned by nothing, which is how the
two drifted with a green suite. Five cases pin it now.

### A test that looked like it covered the thing it did not

Sabotaging `byBatchThenArrival` in the Copilot mapper failed nothing, and the
suite contains a test called "orders piece 2 before piece 10".

Activities are re-sorted by timestamp after the rows merge. That test gives its
messages distinct stamps, so the timestamps alone produce the expected order —
the batch comparator could be reversed or stubbed to zero and the test still
passed. What the comparator actually decides is the TIE: same-millisecond
activities keep merged-row order, which the batch number sets.

A name that describes the intent is not evidence the test reaches it. The
sabotage is.

### Where coverage lives, twice more

- the gateway budget ClickHouse repository: thirteen integration tests under
  `platform/app`, none in the package.
- `mapRow` on the coding-agent ClickHouse repository: nowhere at all. Five
  tests now cover it, and they matter more than they look — ClickHouse returns
  JSONEachRow numerics as strings, so the mapping is what keeps the pagination
  cursor a number rather than text that orders "1000" before "9".

## Round: the files with no class at all

The folds so far moved loose functions onto a class that already existed. This
round is the other case, and the one the original complaint was actually
about: files that were nothing but functions.

| file | functions | now |
| --- | --- | --- |
| copilot-studio-trace-mapper | 34 | `CopilotStudioTraceMapper` |
| trace-full-record.mapper | 29 | `TraceFullRecordMapper` |
| genie-trace-mapper | 14 | `GenieTraceMapper` |
| eventing.langy-type-guards | 14 | `LangyEventGuards` |
| trace-full-protection.mapper | 11 | `TraceFullProtectionMapper` |
| clickhouse.metric-data-point.mapper | 9 | `MetricDataPointMapper` |
| gateway-window.adapter | 9 | `GatewayWindow` |
| langy.turn-errors.adapter | 9 | `LangyTurnErrors` |
| prisma.authz-grant.mapper | 8 | `AuthzGrantMapper` |
| prisma.gateway-budget-scope-target.repository | 8 | `PrismaGatewayBudgetScopeTargetRepository` |

Three of the four trace/conversation mappers exported something with no caller
anywhere: `groupTranscriptRows`, `turnsOf` and `toolCallsOf` from the Copilot
one, `flattenThoughts` from the Genie one, and `daysInUtcMonth` /
`monthlyCycleStart` from the window adapter. A module that exports everything
tells you nothing about what is anybody else's business, which is most of the
argument for the class.

### Two invariants that were encoded but not tested

Both found the same way: fold, sabotage a member, watch nothing fail.

- **The Copilot batch comparator.** Reversing it failed nothing, despite a test
  named "orders piece 2 before piece 10". Activities are re-sorted by timestamp
  after rows merge, so with distinct stamps the batch order leaves no trace.
  What it decides is the same-millisecond tie. Now pinned.
- **`firstAcceptanceWinsVersion`.** metric_data_points is a ReplacingMergeTree,
  which keeps the LARGEST version, while the rule is that the FIRST acceptance
  wins. The inversion is what reconciles those, and removing it changes nothing
  visible — rows still write and still dedup, and quietly keep the wrong one.
  Five tests now pin it, and writing them corrected my own wrong assumption
  that `seriesRow` carries the version. Only `rawRow` and `usageEstimateRow` do.

### Left alone deliberately

- `stored-span-row.codec.ts`: its four exports reach platform/app's span
  storage and integration paths I cannot run. The conversion is mechanical; the
  verification is not.
- The fourteen langy event guards, which have no caller at all. Their
  re-export is gone, because the rule against re-exporting is unambiguous.
  Whether the event union should be discriminated through guards or through
  bare `event.type` is a design call, not a cleanup one.

### Two process mistakes, both mine

`oxfmt` on a package directory reformatted 45 files that were not oxfmt-clean
to begin with — the same trap as the earlier billing round. Format the files
you touched, never the tree. And a consumer survey that greps four of nine
names finds four of nine consumers; the typecheck caught the rest, but the
survey should have.

## Round: the query translator, the projections, and two more untested bounds

Folded the trace query translator into its three layers —
`TraceQueryValues` (bind a value, mint a placeholder, refuse a bad one),
`TraceQueryTranslators` (one field becomes one predicate) and
`TraceQueryClickHouse` (walk the filter tree) — plus the trace-derived and
coding-agent projections and the two metric rules modules. 35 + 19 + 17
functions, of which only nine were ever anybody else's business.

### apps/ exists

Every consumer survey in this cleanup had been `packages` + `platform/app`.
It should have been `packages` + `platform/app` + `apps`. Three files there
were stale — two tRPC mounts supplying the trace query port and the automation
filter check, and one still importing `USD_DISPLAY_STRING_FORMAT` from
`gateway-server` after the money round moved it to the contract.

All four `apps/*` packages now typecheck at 0, which retroactively clears the
earlier rounds too. Worth remembering: `apps/**` runs no CI (see the
`ci-typechecked-10-of-156-packages` note), so nothing else would have said so.

### Two more bounds that were encoded but not tested

- **`validateAttributeKey`'s character check.** Removable with the whole
  1447-test suite green. It is NOT the injection defence — the key is bound as
  a `{name:String}` parameter — but it is the readable refusal on top, and its
  message has to name the allowed characters because it is the only thing
  telling the person what to type instead. The test asserts the message, not
  just that something threw.
- **`checkedInteger`'s range check.** Same: `if (false)` and the metric suite
  stayed green. A point declares its integers as UInt64/Int64/UInt32, nothing
  downstream re-checks, and the column takes what it is given — so an
  out-of-range value is stored as a measurement nobody made.

### Three rewrite hazards, all caught by the typecheck

Worth writing down because they recur:

1. **Prose.** A `\s*\(` lookahead matched "Cross-table categorical
   (evaluation_runs...)" in a docblock and turned it into a method call. Use
   `\(` with no whitespace.
2. **Declarations.** The same pattern rewrites a method DECLARATION as readily
   as a call — a port's type-literal signatures, and a class's own
   `static validatePointShape` in a file that was both fold target and
   consumer.
3. **Collisions.** `hasPersistableSignal` is defined three times over three
   different state types; only one was being folded. Same shape as
   `collectDroppedCategories` and the generic `wrap`. A name grep finds
   definitions, not consumers — check what each file actually IMPORTS.

## Round: the trace rules modules and the last of the adapters

Ten more classes: the five trace rules modules (claude-code truncated-request,
response and request, mastra-value, trace-attribute-cap — 46 functions between
them), and conversation-trace-assembly, trace-query-meta-fields,
simulation-clickhouse and scenario-secret-reference.

Two of those five keep a second class rather than folding into it.
`JsonScan` is a character cursor over possibly-cut JSON;
`ClaudeCodeTruncatedRequest` is the salvage algorithm that walks with it. Two
concerns, two classes.

### A three-layer facade

scenario-secret-reference was three layers deep for one function each:

```
resolveSecretRefsValue                                    (module function)
Adapter.resolve = resolveSecretRefsValue                  (class field alias)
export const resolveSecretRefs = Adapter.resolve          (module re-export)
```

Nothing imported the class. Both consumers used the third layer. All three are
now one — `ScenarioSecretReferenceAdapter.resolve` — with no re-export left
behind, the same shape removed from `prompt-template.adapter` earlier.

### A structural fix the fold forces

`META_FIELD_DEFS` calls `scenarioColumnDef` EAGERLY at module load, so once
that became a class member the const had to move BELOW the class. The
compiler catches this one; the earlier webhook-outbox case it did not, because
that reference was inside an object literal. The rule is the same either way:
a module const that reads a class is evaluated before the class exists.

That also decides visibility. Four of the meta-field builders are public
because the module consts build on them — pretending they were private would
only have moved the consts somewhere less honest.

### Rewrite hazards, continued

Two more, on top of the prose / declaration / collision list from last round:

4. **Spread calls.** `...originAttrs(` is preceded by a dot, so a plain
   `(?<![.\w])` lookbehind skips it. The fold tool allows for this; ad-hoc
   consumer rewrites must too.
5. **Import paths.** A consumer importing through the package index rather
   than the module path does not match a module-path pattern — its call sites
   get rewritten and its import block does not, which typechecks as a missing
   name rather than anything obvious.

And the repeat from last round happened again: a fold target that is also a
consumer of another folded module gets its OWN member declarations rewritten.
Exclude fold targets from their own consumer list.

### Where this leaves it

Roughly 515 module-level functions remain across feature services, repositories
and adapters, but the concentration is gone: the largest single file now holds
seven, and most hold one or two — a `create` helper beside its class, or a
genuinely shared utility. `stored-span-row.codec.ts` stays deliberately
untouched, since its four exports reach platform/app span-storage integration
paths that cannot be run here.

## Round: the tail

Ten more classes across gateway, trace, suite and experiment — the spend
filters and grouping, budget resolution, span-record identity, gen-ai span,
trace-summary projection, query fields, the suite-run repository, and the two
`IdUtils` objects.

Both `IdUtils` were the same shape in two packages: a
`const IdUtils = { fn, fn } as const` namespace over module functions. They are
`SpanRecordIdentity` and `ExperimentRunIds` now, named for what they identify
rather than for being utilities.

### The one that was not a rename

Fifteen platform/app tests import `applySpanToSummary` from a FIXTURE that
wraps the package export with the projection runtime bound. The call-site
rewrite pointed them at `TraceSummaryFoldProjection.applySpanToSummary` — the
same name, a different function, without the bound runtime. Both take the same
argument shape, so it would have compiled and the tests would have exercised
the wrong thing.

It surfaced only because the fixture ALSO declares
`export function applySpanToSummary`, which the rewrite mangled into a member
access and vitest refused to parse. `pnpm typecheck` would never have said so:
`tsconfig.tsgo.json` excludes `**/__tests__/**`, so a test file is checked only
by running it.

The lesson is not "be careful". It is that a same-name symbol reached through a
DIFFERENT module is invisible to every check used so far — the name grep finds
it, the import-block rewriter skips it, the typechecker does not see test
files, and the test still passes if the two functions happen to agree. The only
reliable question is which module each consumer imports the name FROM.

### The eager-const rule, third instance

`FIELD_DEFS` joined `META_FIELD_DEFS` and `spendFilterQueryShape`: a module
const that CALLS a class member is evaluated before the class exists, so it
moves below the class and the members it calls become public. Three files, one
rule, and the compiler catches it every time the reference is a direct call
rather than one buried in an object literal.

### The full hazard list

Every rewrite hazard this cleanup has hit, in the order they bite:

1. **Prose** — `\s*\(` matches "categorical (evaluation_runs)" in a docblock.
2. **Declarations** — the pattern rewrites a method or function DECLARATION as
   readily as a call: a port's type literal, a class's own member, a consumer
   with a method of the same name, a fixture with a function of the same name.
3. **Collisions** — `collectDroppedCategories`, `wrap`, `hasPersistableSignal`,
   `groupByColumn`: same name, different function, four times.
4. **Spread calls** — `...originAttrs(` is preceded by a dot.
5. **Import paths** — `../index`, `@langwatch/<pkg>`, an `as` alias, and the
   module path are four different spellings of the same import.
6. **apps/** — a fourth root, alongside packages, platform/app and the tests.

## Round: the directories nobody surveyed

`processes/` and `subscribers/` had never been in any survey. Between them they
held the densest remaining code: 81 loose functions across 22 subscriber files.

Six more classes — TopicClusteringProcess, TriggerSettlement,
SimulationRunExecutionEvolution, TrackedEventSync, CustomEvaluationSync and
ProjectMetadataSync.

Topic got the full treatment: its four EventHandler consts had no consumer
outside the file, so they became private static fields and seven of ten helpers
are genuinely private. The other two process managers keep their handlers at
module level and their members public, and the class docblock says why — the
handlers are registered by a builder and another module wires them, so they are
the module's surface. A class with only public members is a namespace, but a
named one with a docblock beats loose functions, and it is the shape already
accepted for TraceQueryMetaFields and GatewaySpendFilters.

### A bare reference that would have reached production

`trace-processing.adapter.ts` wires its pipeline with bare references:

```ts
when: hasSyncableEvaluations,
dedupId: customEvaluationSyncDedupId,
groupKeyFn: projectMetadataGroupKey,
```

None is followed by `(`, so the call-site rewrite left them while the import
rewrite took their names away — a ReferenceError at pipeline construction, in
runtime code rather than a test.

My own sweep had hidden them. It skipped lines ending in a comma on the
assumption those were import-list entries, and every one of these is a property
in an object literal. The sweep now tracks whether it is INSIDE an import block
rather than guessing from the line, which is the only way to tell
`hasSyncableFeedback,` in an import from `when: hasSyncableFeedback,` in a
pipeline.

It surfaced only because a platform/app test constructs that pipeline. Nothing
else would have: platform/app is not in the typecheck, and the reference is
legal TypeScript right up until the module is evaluated.

### One restructure abandoned rather than patched

Moving scenario's handlers into its class the way topic's went in, my index
arithmetic deleted the class declaration. It was restored from the pre-fold
copy and redone the simpler way. A half-restructured process manager is worse
than an unrestructured one, and the cost of starting over was a minute.

### Where the loose functions are now

| directory | functions | files |
| --- | --- | --- |
| transport | 212 | 144 |
| adapters | 159 | 287 |
| repositories | 158 | 259 |
| services | 137 | 348 |
| subscribers | 81 → ~45 | 22 |
| everything else | < 25 each | — |

`transport/` is next by volume but is mostly route handlers, which are the
framework's shape rather than loose helpers. The three big directories now
average well under one function per file.

## Round: duplication, found on purpose this time

Every previous duplicate was found by accident, while folding. This round
looked for them: hash the body of every function of four or more lines across
the feature packages and report the collisions. Eight came back.

### The one worth reading

The model-provider feature had two authorization services side by side, and the
write rule written twice — `writePermission` in one, `requiredPermission` in
the other, byte for byte — plus two copies of the `getDecision` call. One
answers, one refuses. Joining them surfaced something the dedup did not cause:

| what answers "may this actor write a model-provider scope" | PROJECT tier |
| --- | --- |
| the service the write path really checks | `project:update` |
| the tRPC route's `serviceAuthorizedPolicy` declaration | `project:manage` |
| platform/app's legacy `requiredManagePermission` | `project:manage` |

`project:update` is in MEMBER_ADDITIONS; `project:manage` is in
ADMIN_ADDITIONS. So on the project tier the enforced requirement is
member-level and the declared one is admin-level, and the route's own policy
`reason` says the service is what checks.

Nothing pinned any of it — changing `team:manage` to `team:view` left all 124
tests green. Thirteen tests now pin the mapping for all three tiers on both
read and write, and the tRPC docblock, which stated `project:manage`, now
describes what is enforced and names the divergence. **The permission itself is
unchanged**: which answer is right is a product decision.

### The rest

- `toCanonicalModels`, identical in the REST and tRPC writes — one reader now,
  and the two wire shapes it accepts (a string array, and
  `{ modelId, displayName }`) are pinned, since dropping the older one left
  every test green.
- `addReservedTokenSum`, identical in both trace projections, which a parity
  test already asserts agree. One owner.
- The evaluation metric keys, written four times in the analytics package —
  once as a const list with a derived type, twice as hand-written unions (one
  under the SAME type name), each with its own predicate.

Left alone deliberately: `isBlocklisted` and its 23-key payload blocklist are
identical across the trace and analytics packages, and neither depends on the
other. Consolidating needs a new cross-feature dependency edge, which is an
architectural call rather than a cleanup.

### What the sweep is worth

Four of the eight duplicates hid a path nothing tested — in each case the
sabotage that proved it took a minute, and the fix was a handful of tests. The
pattern is consistent enough to state plainly: **code that exists twice is
usually code that is tested zero times**, because each copy looks like the
other's coverage.

## Round: the last small duplicates, and one large one left alone

`emitSystemPrompt` (coding-agent, two transcript builders) and `quantile`
(experiment, two confidence-interval calculations) each had one home made for
them. Both were untested in both copies — the fourth and fifth time this
cleanup has found that pairing — and each sabotage passed before the tests
were written and fails after.

### The analytics ClickHouse layer exists twice

Widening the sweep to all of `packages`, `platform/app` and `apps`, and to
arrow consts as well as function declarations, turned up 69 duplicated bodies.
Thirteen of the top fourteen are one thing:

```
packages/features/analytics/server/src/clickhouse/   ← live
platform/app/src/server/analytics/clickhouse/        ← 5,780 lines, no importer
```

Four files each — `aggregation-builder`, `field-mappings`,
`filter-translator`, `metric-translator`. `translatePerformanceMetric` alone
is 141 duplicated lines, `buildGroupByUnionAllQuery` 93.

Facts established, since the conclusion depends on all of them:

- **Nothing outside that directory imports the fork.** The only importers are
  its own four files and its own tests; the live path is
  `app-layer` → `@langwatch/analytics-server` → `AnalyticsAdapter` →
  `ClickHouseAnalyticsRepository` → the PACKAGE's `buildTimeseriesQuery`.
- **The two are functionally the same.** A line diff says 326 differing lines,
  but normalising whitespace shows the differences are line wrapping, an
  import moved to `@langwatch/analytics-contract`, and
  `crypto.randomUUID()` → `randomUUID()`. No behavioural difference.
- **The fork's 11 test files are UNIQUE.** None of their names appear among
  the package's 13. Nine need ClickHouse. They cover cross-evaluator group-by,
  join time bounds, memory safety, model group attribution, offline-experiment
  joinability and trace/eval mix inflation.

So this is a MIGRATION, not a deletion: the coverage is real and it is the only
copy of itself, but it runs against a query builder no request reaches.

**Not done, deliberately.** Moving those tests needs the package to export its
builders — it exports neither `buildTimeseriesQuery` nor a `clickhouse`
subpath — which is an API decision, and it needs nine ClickHouse integration
tests re-run, which cannot be done here. Deleting the fork without moving them
would drop eleven real test files.
