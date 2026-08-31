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
