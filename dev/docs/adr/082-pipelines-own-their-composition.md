# ADR-082: A pipeline is defined in its own file, in layers

- Status: Accepted — executed
- Date: 2026-07-28
- Amended: 2026-07-29 — Rule 1's method list named two builder methods ADR-075
  deleted; corrected in place under "the two `Deps` rules".
- Builds on: ADR-052 (automations on the process-manager substrate — which
  introduced the "only the executor dependencies are injected" rule that this
  ADR generalises), ADR-074 (package topology), ADR-075 (post-event work is
  subscribers and process managers), ADR-081 (the unit of dispatched work)
- Applies to: `src/server/event-sourcing/pipelineRegistry.ts`, every
  `pipelines/*/**`, and `src/server/app-layer/presets.ts`

## Context

`README.md` in this directory has always described pipeline definition as
"**Step 1: Define the Pipeline (static, no runtime deps)**". That is not what
the code does. Every pipeline takes a `Deps` object, and for most of them a
large part of that object is not data — it is the pipeline's own behaviour,
constructed somewhere else and handed back in.

The measurements, taken 2026-07-28 on `feat/retire-reactors`:

| | |
| --- | --- |
| `pipelineRegistry.ts` | **1,450 lines**, 140 `import` statements |
| `private register*Pipeline` methods | **10** (+2 pipelines registered inline in `registerAll`, +1 enterprise set = **13 pipelines**) |
| `PipelineRegistryDeps` top-level members | **22** |
| `PipelineRepositories` members | **21** |
| Projection store adapters the registry constructs | **17** (`new *Store` / `new *AppendStore` / `createExperimentRunStateFoldStore`) |
| Redis fold-cache wraps (`this.cached`) | **6** |
| Reactors constructed | **10** |
| Subscribers / handlers constructed | **12** |
| Projections constructed | **3** |
| Command instances constructed | **3** |
| `new Deferred<…>` late-bindings | **7** (plus 2 hand-rolled `let x = null` thunks and 1 `getPipeline()` lookup — three mechanisms for one problem) |
| Standalone `registerJob` calls | **3** |
| `automationDispatch.wiring.ts` | **284 lines**, 41 `import` statements, **2 exports**; `buildAutomationDispatchPorts` runs lines **68–284** — one **216-line** function |
| `createTestApp` (`presets.ts:1322`) | **377 lines**, 84 uses of one `const noop`, 27 distinct `new Null*Repository()` |
| `as any` / `as unknown as` in `pipelines/**` tests | **262** |
| Optional (`?:`) members across the twelve pipeline `Deps` | **15**, nine of them on `trace-processing` |

And on the other side of the seam, across the twelve `pipelines/*/pipeline.ts`
files: **63 `Deps` members, of which 27 are behaviour** — a
`ReactorDefinition`, an `EventSubscriberDefinition`, a `MapProjectionDefinition`
or a constructed command instance, passed in and then handed straight to
`.withReactor` / `.withEventSubscriber` / `.withMapProjection` /
`.withCommandInstance` (`.withReactor` is a measurement of the state on that
date; ADR-075 has since deleted it). Fifteen of those 27 are on
`trace-processing` alone,
whose `Deps` has 21 members and whose file cannot tell you what the pipeline
does without reading a thousand lines of registry to find out what was passed.

**ADR-075 does not fix this, and the evidence landed while this ADR was being
written.** Converting `gatewayBudgetSync`, `governanceKpisSync` and
`governanceOcsfEventsSync` from reactors to projections replaced three
`ReactorDefinition` deps with three `MapProjectionDefinition` deps on the same
pipeline, still constructed in the registry, still injected, still guarded by
`if (deps.x)`. The reactor retirement changes *what kind* of behaviour is
injected. It does not change *that* behaviour is injected.

### The diagnosis: "wiring" is not a concern

The first draft of this ADR proposed moving composition out of the registry and
into each pipeline's own directory, and held up
`pipelines/automations/automationDispatch.wiring.ts` as the pattern to copy. It
is not. It has the right *instinct* — the pipeline owns its composition — and
the wrong *execution*, and measuring it against the repo's own code checklist
(`review-code`, `references/code-checklist.md`) says so without needing an
opinion:

- **Function > 50 LOC is a smell.** `buildAutomationDispatchPorts` is 216 lines.
  Four times over.
- **SRP — "describe it in one sentence without using *and*."** It constructs
  services *and* decides Redis topology *and* maintains an in-flight coalescing
  cache *and* adapts ports. Four reasons to change. Inside it: 11 construction
  sites, 2 topology decisions, 4 lines of inline mutable caching, and roughly 5
  lines of actual port adaptation. **The adaptation is 2% of the function.**
- **Dependency direction is strictly downward.** This file sits in
  `event-sourcing/pipelines/` and imports `createOrUpdateQueueItems` from
  `~/server/api/routers/annotation` and `getProtectionsForProject` from
  `~/server/api/utils` — a pipeline file reaching *up* into the tRPC router
  layer.
- **Domain-aware helpers belong in the right domain module, not a grab bag.**
  `protectionsInFlight` / `getProtectionsDeduped` is a promise-coalescing cache
  strategy, hand-rolled inline. That is an implementation. It belongs in
  `TraceService` or a shared `dedupeInFlight()`, not in a composition file.
- **Hidden mutability is bug bait.** `protectionsInFlight` is a `Map` mutated
  inside a closure in a file whose job is supposed to be declarative.
- **File > 300 LOC is a smell.** `pipelineRegistry.ts` is 1,450. Five times
  over.

The common cause of all six is one thing: **"wiring" is not a concern. It is a
junk drawer named after a verb.** Nobody can state what belongs in a file called
`*.wiring.ts`, so everything does. This is exactly why the first draft's rule —
which bound `pipeline.ts` and stopped there — would have failed: under it,
`getProtectionsDeduped` is fully compliant while being obviously wrong. Moving
the mess out of the registry and into thirteen pipeline directories relocates it
and calls that progress.

So the decision below is not a rule about `Deps` members. It is a set of named
layers with a downward-only dependency rule and a one-line membership test each,
binding **every file in a pipeline's directory**.

### On "100% compile-time safety"

The constraint driving the type-level parts of this ADR is that errors should be
compile-time, never runtime. Taken literally that is not achievable and chasing
it produces the opposite: queue payloads arrive deserialised from Redis,
ClickHouse rows arrive as `unknown`, env vars arrive as strings. Those
boundaries are validated at runtime by construction — that is what the Zod
command schemas are *for*.

The achievable and correct form of the constraint, which this ADR adopts, is:

> **No cast may bridge a gap the compiler could have checked.**

That is a rule about `as`, not about eliminating runtime errors, and it is
mechanically greppable. Every unsoundness identified below is an instance of it:
`this.deps.redis as Redis`, `{…} as unknown as PromptTagRepository`, and the 262
`as any` in pipeline tests.

## Decision

### 1. Six layers, one membership test each, dependencies downward only

| # | Layer | Owns | Membership test | May import values from |
| --- | --- | --- | --- | --- |
| 1 | **Infrastructure** | Clients, connections, topology | Does it hold a socket, a pool, or a decision about how they are shaped? | — |
| 2 | **Repository** | Data access over exactly one storage system | Could you swap the storage engine behind it with no caller noticing? | 1 |
| 3 | **Service** | Behaviour over repositories | Does it *decide* anything — retry, cache, coalesce, fan out, validate, authorise? | 1, 2 |
| 4 | **Port** | The narrow function *types* a pipeline declares it needs | Is it a `type`, declared in the pipeline's own directory, naming no implementation? | nothing — ports are types |
| 5 | **Adapter** | `service.method` → port | Is every line of the form `port: (args) => something.method(args)`? | 3, 4 |
| 6 | **Pipeline** | Structure | Is every statement a `.with*()` call, or the construction of an argument to one? | 2, 4, 5 |

> **The table is missing a row, and it is the row that matters most.** Applying
> this to the worst file exposed the gap: `new TraceService(...)` has to happen
> *somewhere*, and under the table as written that somewhere is illegal at every
> layer — layer 5 may import 3 and 4, but nothing is permitted to *construct*
> across them. "Construction belongs at the composition root" is advice with no
> address, and advice with no address is exactly how the junk drawer formed.
>
> Add **layer 0 — Composition root.** It may import from anything. Its
> membership test: *does it only construct?* `presets.ts` is that layer today
> and this ADR never named it, which is why an adapter was able to absorb
> eleven constructions without breaking any stated rule.
>
> The naming convention that falls out is `*.composition.ts` beside the services
> it builds — a file that constructs and never adapts, sibling to `*.adapter.ts`,
> which adapts and never constructs. Both have a one-line membership test;
> `*.wiring.ts` had neither, which is the whole diagnosis.

> **Two further corrections from applying this to `automations`:**
>
> - **`getProtectionsDeduped` does not belong in `TraceService`,** as §4 said.
>   `TraceService.getById` *receives* protections as an argument — it does not
>   own them, so caching them inside it would have a service cache a value it
>   cannot invalidate. The ADR reached for the nearest named service instead of
>   asking who owns the data. The right home is a service whose *method
>   boundary* is the pair of calls.
> - **§4 over-credits its most quotable finding.** The dedup cache is **14 of
>   216 lines — 6%**. Moving it alone would have left a 202-line function. What
>   actually shrank the file was relocating the eleven constructions and
>   splitting the remainder into named port bundles.

> **An adapter declares two interfaces, not one.** §1 splits `*.adapter.ts`
> (layer 5) from a `ports.ts` (layer 4) holding the produced ports. But an
> adapter must also name the *collaborators it consumes*, and that side has no
> row in the table — despite being the more load-bearing of the two, since it is
> what makes the composition root's output checkable. Splitting one interface
> pair across two files buys nothing; keep both with the adapter.

> **§7's port example is not representative, and it resizes the generator plan.**
> The `AutomationDispatchPorts` sample lists three trivially-nullable ports and
> omits `settlementDeps`, a **17-member bundle** that is the only member with
> real surface. Sized against the example, "auto-generate the port half" covers
> 3 of 20 members — about 15% of this contract, not half of it. The other 17 are
> exactly the value-returning and object-typed cases §7 already admits cannot be
> generated soundly.

**Dependency direction is strictly downward for values.** Types may be imported
in any direction — a type import has no runtime edge — which is what lets layer
6 name an app-layer type without depending on it. Layer 4 is types-only by
construction, so it is importable from anywhere.

**The membership test that matters most, stated on its own:** *if a file whose
job is composition **constructs**, **decides**, or **caches**, it is in the
wrong layer.* Adaptation only. A 216-line adapter is not a long function; it is
a category error.

This binds every file in `pipelines/<x>/`, and directory position declares
layer:

| Path | Layer |
| --- | --- |
| `pipelines/<x>/pipeline.ts` | 6 — structure |
| `pipelines/<x>/*.adapter.ts` (today: `*.wiring.ts`) | 5 — adaptation |
| `pipelines/<x>/ports.ts` | 4 — port types |
| `pipelines/<x>/{commands,subscribers,projections,process-manager}/` | domain code; imports layer-4 types, never layer-3 values |
| `pipelines/<x>/repositories/` | 2 |

**Renaming `*.wiring.ts` to `*.adapter.ts` is not cosmetic.** "Wiring" has no
membership test, which is why the file grew to 284 lines. "Adapter" has one, and
`buildAutomationDispatchPorts` fails it on line 1.

### 2. What the layering does to the two `Deps` rules

The first draft's two rules survive, demoted from the decision to the layer-6
membership test — they are what "is every statement a `.with*()` call" means in
practice.

**Rule 1 — nothing in `Deps` may be a value the builder registers.** Every
argument to `.withFoldProjection`, `.withMapProjection`, `.withProjection`,
`.withEventSubscriber`, `.withProcessManager`, `.withCommand` and
`.withCommandInstance` is constructed in `pipeline.ts` from a symbol
`pipeline.ts` imports. `deps.x` may appear *inside* those arguments; it may
never *be* one.

> **Corrected 2026-07-29.** This list named `.withReactor` and `.withSubscriber`
> as well. Both were deleted by ADR-075 in the same change that this ADR ships
> in, so the list as written pointed a reader at two methods that do not exist.
> The seven above are the builder's registering methods; `withName`,
> `withAggregateType` and `withFeatureFlagService` are the rest of its surface
> and register nothing. The rule itself is unchanged — narrowing the list makes
> it exhaustive, not weaker.

```ts
// illegal — the dep is the registered value
.withMapProjection("governanceKpis", deps.governanceKpisProjection)

// legal — the dep is an argument to a value this file constructs
.withMapProjection("governanceKpis",
  new GovernanceKpisMapProjection({ store: deps.governanceKpisRepository }))
```

**Rule 2 — a dep is a noun, never a verb.** Every `Deps` member is a repository
(layer 2), a store, a client (layer 1), a scalar config value, or a port (layer
4). If a member's type name ends in `Reactor`, `Subscriber`, `Projection`,
`Command` or `Pipeline`, Rule 1 has already rejected it; if it ends in `Service`
and the pipeline calls more than one of its methods, it is a layer-3 value that
should be narrowed to the layer-4 ports actually used.

> **Rule 2's narrowing test can never fire, because Rule 1 disarms it.** "…if
> the pipeline calls more than one of its methods" assumes `pipeline.ts` calls
> methods on its deps. After Rule 1 it does not — it only *constructs*; the
> collaborators it builds are what call methods. Applied literally,
> `broadcast: BroadcastService` passes the test while being exactly the layer-3
> value the rule exists to catch. Restate it in terms of the methods reached
> **through** the pipeline's constructions, not by the file itself.

### 3. Infrastructure resolves `Redis | Cluster` once — and `this.cached()` is a bug, not a policy

The first draft listed `pipelineRegistry.cached()` as centralised policy worth
preserving. It is the opposite: it is the clearest single instance of a cast
bridging a gap the compiler could have checked.

- `RedisCachedFoldStore`'s constructor takes `redis: Redis` — standalone client
  only.
- `PipelineRegistryDeps.redis` (`pipelineRegistry.ts:295`) is `Redis | Cluster`.
- `pipelineRegistry.ts:362` reconciles the two with
  `new RedisCachedFoldStore<State>(inner, this.deps.redis as Redis, { keyPrefix })`
  — an unchecked cast narrowing a union that genuinely includes `Cluster`.
- `automationDispatch.wiring.ts:99–106` guards the *same* construction with
  `redis && !(redis instanceof Cluster)` and falls back to the uncached store.

So there are two implementations of one policy and **they disagree** — and they
disagree about the same store, wrapped with the same key prefix. Both wrap a
`TraceSummaryStore` with `keyPrefix: "trace_summaries"`; under a Cluster client
the registry path caches and the automations path does not. Six pipelines go
through the casting one. This is not an abstraction to protect. It is a
divergence hiding behind a helper that *looks* like shared policy, which is a
better motivation for this whole restructure than "the file is long."

It is also worth being precise about the blast radius rather than overstating
it: `RedisCachedFoldStore` only issues `get` and `set` (lines 196 and 314), both
single-key, both of which ioredis' Cluster client handles. The cast is unsound
in the type system and survivable at runtime *today*. It becomes a live bug the
moment anyone adds `mget`, `pipeline`, `scan` or a multi-key `del` — which is
precisely the change nobody will think to check, because the type says `Redis`.

> **RESOLVED, and this ADR had the answer backwards.** Step 0 shipped, and the
> reconciliation is **cache under Cluster**, not degrade to uncached.
>
> This section proposed degrading, on the grounds that it matched what the
> automations path already did. Two errors in that.
>
> **First, caching is not optional.** ADR-066 §5 is explicit: *"Caching is
> neither optional nor a speed feature — it is the event processor's
> read-your-write consistency layer,"* and *"the cache TTL is a correctness
> invariant, not a latency knob."* ClickHouse replicates asynchronously, so a
> miss only implies settlement while a cache is actually in front of it.
> Degrading under Cluster would strip that invariant from six fold **writers**.
>
> **Second, the two sites are not symmetric.** The automations path holds three
> `.get()` calls and no writes — it is a pure *reader* of the fold the trace
> pipeline writes. Uncached costs it a read-back; uncached costs the writer its
> consistency layer. Calling them "the same policy" was the mistake that made
> degrading look safe.
>
> The hazard this section was really guarding against — someone later adding
> `mget`/`pipeline`/`scan` because the type said `Redis` — is closed better than
> a guard closes it. `FoldCacheClient` exposes only `read` and `write`, so a
> multi-key command is a compile error. Note `Pick<Redis, "get" | "set">` would
> **not** have closed it: `Cluster` exposes `mget` too, so that fails at runtime.
> The fix was narrowing what the store *demands*, not narrowing which
> deployments get a cache.
>
> Net effect is also smaller than this ADR anticipated: the registry path is
> behaviour-preserving and only the automations reader changes, gaining the warm
> tier under Cluster.
>
> **Shape rule, learned by getting it wrong twice.** A factory that takes a
> nullable and branches (`createFoldCache(client | null)`) is a hidden decision —
> the same failure as `buildAutomationDispatchPorts`, one level down. And a port
> whose no-cache implementation is called `UncachedFoldCache` is a null object in
> a class costume; the tell is that you cannot name it without contradicting
> yourself. Constructor composition —
> `new CachedFoldStore(inner, new RedisFoldCacheClient(redis), { keyPrefix })` —
> gives the decision to the layer that should own it and makes it greppable at
> the composition root.

**The decision: infrastructure publishes a resolved tier, not a client.**

```ts
// layer 1 — the only place the topology is looked at
const foldCacheClient: FoldCacheClient = redis
  ? new RedisFoldCacheClient(redis)   // Redis *and* Cluster: single-key get/set
  : new InMemoryFoldCacheClient();    // no Redis: the in-process map is the tier

// layer 5/6 — composition, no client, no branch
new CachedFoldStore(inner, foldCacheClient, { keyPrefix: "trace_summaries" });
```

`FoldCacheClient` exposes `read` and `write` and nothing else, so a downstream
site cannot reach a multi-key command and `as Redis` cannot be written — there
is nothing to cast. Which tier backs the cache is decided once, at the
composition root; every store downstream is composed over the same client, so
the registry path and the automations path cannot disagree about whether
`trace_summaries` is cached.

Note that `Pick<Redis, "get" | "set">` would not have closed the hazard —
`Cluster` structurally satisfies it and also exposes `mget` — and that a
`createFoldCache(client | null)` factory that branches would only move the
hidden decision one level down. Narrowing what the store *demands* is what
closes it.

**A sharpening of the general rule, because the absolute version is wrong.** The
`Redis | Cluster` union appears at 62 non-test sites, and three of them
discriminate on it legitimately: `groupQueue.ts:342` (Cluster needs
`.duplicate()` with no args for blocking connections) and
`envelopeBlobLifecycle.ts:67` (Cluster needs hash-tagged queue names) are
infrastructure code that genuinely must know. So the rule is not "collapse the
union once and nothing ever sees it again". It is:

> **The `Redis | Cluster` union is legitimate inside layer 1 and must not cross
> into layers 2–6.** Layers above receive a resolved capability, never a client
> and never a union.

`pipelineRegistry.ts:362` and `automationDispatch.wiring.ts:100` are both
layer-5/6 files holding the union. Both are violations. `groupQueue.ts` is not.

**What changes behaviourally.** The registry path is behaviour-preserving: it
was already cached, and stays cached in every Redis topology. The automations
path is the one that changes — it read `trace_summaries` uncached under a
Cluster client and now reads through the same warm tier as everyone else. No
deployment loses a cache, which is the point: ADR-066 §5 makes this cache the
event processor's read-your-write consistency layer, not a latency knob.

### 4. Where each thing lives

| Thing | Lives in | Layer | Constructed by | Crosses `Deps` as |
| --- | --- | --- | --- | --- |
| Command handler | `pipelines/<x>/commands/` | domain | `pipeline.ts` | the repositories/ports its constructor takes |
| Fold / map projection | `pipelines/<x>/projections/` | domain | `pipeline.ts` | — |
| Projection **store adapter** (`TraceSummaryStore`, `SpanAppendStore`) | `pipelines/<x>/projections/` | 2 | `pipeline.ts` | the **repository** it wraps |

> **This assumes a two-layer split that does not always exist.** Some store
> adapters have no repository beneath them: `createExperimentRunItemAppendStore(resolveClient)`
> *is* the ClickHouse data access for `experiment_run_items`. Building it in
> `pipeline.ts` would drag a `ClickHouseClientResolver` into layer 6. The
> escape: **where a store adapter has no repository beneath it, it is itself
> the layer-2 value and crosses `Deps`.**
>
> Also: re-homing a store adapter brings its **cache tier** with it — the wrap
> and its `keyPrefix` are inseparable from the store. So a pipeline that
> re-homes a cached fold *gains* a `FoldCacheClient` dep. §4 says the fold cache
> crosses as a port; the migration table never says which steps add it. Steps 3
> and 5 both do.
| Fold cache | `event-sourcing/projections/` | 1 | app boundary | a `FoldCache` port |
| Subscriber | `pipelines/<x>/subscribers/` | domain | `pipeline.ts` | the ports its `Deps` declare |
| Process-manager `evolve`/`onWake` | `pipelines/<x>/process-manager/*.process.ts` | domain | `pipeline.ts`, via the in-file `xPM()` applier | — |
| Process-manager **intent handler** | `pipelines/<x>/process-manager/*IntentHandlers.ts` | domain | `pipeline.ts` | its `DispatchDeps` port bundle |
| Cross-pipeline dispatcher | the pipeline that owns the **domain knowledge**, i.e. the one whose commands it sends | domain | `pipeline.ts` | the command bus (§5) |
| Caching / coalescing / retry strategy | the owning **service** | 3 | the app boundary | as a port on the service it belongs to |
| `service.method` → port adaptation | `pipelines/<x>/*.adapter.ts` | 5 | the composition root | the ports it produces |

`getProtectionsDeduped` lands in row 9, not row 10 — in `TraceService`, or as a
shared `dedupeInFlight()` if a second caller appears. That single reassignment
is most of what makes `automationDispatch.wiring.ts` shrink to something a
person can read.

### 5. Cross-pipeline dispatch: a command bus keyed on identity, not strings

Every cross-pipeline coupling in this codebase — all eleven of them — is command
dispatch. Not one is "pipeline A needs pipeline B's handler":

| From | To | What is dispatched |
| --- | --- | --- |
| trace | evaluation | `executeEvaluation`, `reportEvaluation` |
| trace | simulation | `computeRunMetrics` |
| trace | topic clustering | `requestClustering` (rate-limited bootstrap) |
| trace, evaluation | automations | `recordTriggerMatch` |
| trace, metric, log | coding agent | `contributeSpanFacts` / `contributeMetricFacts` / `contributeLogFacts` |
| trace | trace (self) | `resolveOrigin` |
| simulation | simulation (self) | `computeRunMetrics` |
| langy | langy (self) | `failAgentResponse`, `generateConversationTitle` |
| topic clustering | topic clustering (self) | the three run-outcome commands |
| billing | billing (self) | `reportUsageForMonth` |
| EE ingestion pull | itself | the two run-outcome commands |

> **Right conclusion, wrong mechanism — and a boundary this ADR never states.**
> Step 4 proved the bus absorbs self-reference, with a test that registers the
> real pipeline and asserts a `computeRunMetrics` job lands on its own queue.
> But this section credits the fix to *moving the handler in* ("the only thing
> that still has to be late is the lookup"). That is not what makes it work.
> What makes it work is that `port()` **records without resolving**, and
> `indexCommandClasses` runs as the **last** act of `register()`. The bus would
> absorb self-reference even with the handler still injected; moving it in is a
> Rule-1 consequence, not the enabling condition.
>
> **The boundary: the bus subsumes late binding to a *command*. It does not
> subsume late binding to a *job*.** `registerJob` appears **zero** times in
> `staticBuilder.ts` — jobs exist only on the runtime service, with no static
> declaration for an identity-keyed command bus to key on. Three of the seven
> `Deferred`s are job-shaped (`scheduleRetry`, `scheduleDeferred`, and
> `datasetNormalize`'s enqueue), so §"Consequences"' promise of "one
> late-binding mechanism instead of three" lands at **two**, not one — unless
> jobs also become declarable on the builder, which is real scope this plan
> currently hides.
>
> `scheduleRetry` therefore stays, and its named error is the right failure
> mode: a missing retry lane should say so, not surface as
> `undefined is not a function`.

Self-reference is therefore not a separate problem, and the `Deferred` pattern is
not inherent to it — it is an artefact of building the dispatching *handler*
outside the pipeline, at a moment when the pipeline does not exist yet. Move the
handler in, and the only thing that still has to be late is the *lookup*.

`billing-reporting` already does the late lookup in one line, with no `Deferred`,
no resolve step and no ordering constraint:

```ts
selfDispatch: (data) =>
  this.deps.eventSourcing
    .getPipeline(BILLING_REPORTING_PIPELINE_NAME)
    .commands.reportUsageForMonth.send(data),
```

But `getPipeline(name: string)` returns `PipelineWithCommandHandlers<any, any>`,
so that line is entirely untyped — two string keys and an `any`. It is the right
*timing* with none of the safety. The bus keeps the timing and adds the types by
keying on the **imported command class itself**.

#### The signature

Verified against `commands/commandHandlerClass.ts`, `commands/commandSchema.ts`,
`pipeline/staticBuilder.ts` and `mapCommands.ts`:

```ts
import type { CommandHandlerClassStatic, ExtractCommandHandlerPayload }
  from "../commands/commandHandlerClass";
import type { QueueSendOptions } from "../queues";

export interface CommandBus {
  send<C extends CommandHandlerClassStatic<any, any>>(
    command: C,
    data: ExtractCommandHandlerPayload<C>,
    options?: QueueSendOptions<ExtractCommandHandlerPayload<C>>,
  ): Promise<void>;

  sendBatch<C extends CommandHandlerClassStatic<any, any>>(
    command: C,
    data: ExtractCommandHandlerPayload<C>[],
    options?: QueueSendOptions<ExtractCommandHandlerPayload<C>>,
  ): Promise<void>;

  /** Bind once, hand the result to a subscriber as a layer-4 port. */
  port<C extends CommandHandlerClassStatic<any, any>>(
    command: C,
  ): CommandDispatcher<ExtractCommandHandlerPayload<C>>;
}
```

Call site — no string keys, no `declare module` augmentation, no central
registry type to keep in sync, and the import *is* the type:

```ts
// pipelines/metric-processing/pipeline.ts
import { ContributeMetricFactsCommand }
  from "../coding-agent-processing/commands/contributeMetricFactsCommand";

const factsDispatch = createCodingAgentMetricFactsDispatchSubscriber({
  contributeMetricFacts: deps.bus.port(ContributeMetricFactsCommand),
});
```

#### Four things this signature was checked against, and one correction

**(a) The constraint is `CommandHandlerClassStatic`, not `DefinedCommandClass`.**
This matters and the obvious choice is wrong. `DefinedCommandClass<P, T>` is
`CommandHandlerClass<P, T, Event> & { makeJobId? }`, and `CommandHandlerClass`
includes `new () => CommandHandler<…>` — a **zero-argument constructor**. Four
commands are registered through `.withCommandInstance` precisely because they
take constructor DI and therefore have no zero-arg constructor:

| Command | Constructor |
| --- | --- |
| `ExecuteEvaluationCommand` | `constructor(private readonly deps: ExecuteEvaluationCommandDeps) {}` |
| `ComputeRunMetricsCommand` | `constructor(private readonly deps: ComputeRunMetricsDeps) {}` |
| `ReportUsageForMonthCommand` | `constructor(private readonly deps: ReportUsageForMonthCommandDeps) {}` |

> **Corrected during implementation.** `RecordSpanCommand` was listed here and
> does not belong: its constructor is
> `constructor(deps?: Partial<RecordSpanCommandDependencies>)` — the argument is
> optional, so it *does* satisfy `new () =>`. There are **four**
> `.withCommandInstance` call sites and **three** classes genuinely excluded.
> The conclusion is unchanged; the count was wrong.

Constraining the bus to `DefinedCommandClass` would exclude `executeEvaluation`
(trace → evaluation), `computeRunMetrics` (trace → simulation *and* simulation →
self) and `reportUsageForMonth` (billing → self) — three of the eleven rows
above, including the one the pattern was derived from. `CommandHandlerClassStatic<any,
any>` is the widest constraint that covers both registration paths, and the
builder already proves it works: `withCommand` extracts with
`ExtractCommandHandlerPayload<handlerClass>` (line 528) and `withCommandInstance`
with `ExtractCommandHandlerPayload<TStatic>` (line 577), where `TStatic extends
CommandHandlerClassStatic<any, any>`.

**(b) `ExtractCommandHandlerPayload` is not a new helper.** It already exists in
`commands/commandHandlerClass.ts` and is the mechanism the entire typed command
surface runs on today — `commands.traces.recordSpan` gets its payload type
through it. Reusing it means the bus cannot drift from the builder.

**(c) A correction to a premise this ADR was drafted against.**
`ContributeMetricFactsCommand` is *not* a `defineCommand(...)` export. It is a
hand-written class with `static readonly schema = defineCommandSchema(...)`.
Both shapes satisfy `CommandHandlerClassStatic`, which is another reason the
constraint has to be the static interface rather than `defineCommand`'s return
type — the codebase has at least three command shapes (`defineCommand` results,
hand-written zero-arg classes, and DI'd classes) and the bus must accept all
three.

**(d) The runtime index is buildable and exact.**
`StaticPipelineBuilder.commands` is
`Array<{ name, handlerClass: CommandHandlerClass<any,any,any>, handlerInstance?, options? }>`
(`staticBuilder.ts:134`), and the array survives into
`StaticPipelineDefinition.commands`. `EventSourcing.register()` already walks
`pipeline.service.getCommandQueues()` into a `dispatchers` record keyed by name
(`eventSourcing.ts:319–323`). Adding
`this.byCommandClass.set(cmd.handlerClass, dispatchers[cmd.name])` in that same
loop is a four-line change and gives true object identity — no string, not even
`schema.type`, is involved in resolution.

#### Where safety can still be lost, and the guard

Because `ExtractCommandHandlerPayload<C>` is a deferred conditional type, `C` is
inferred solely from the first argument. That is the desired behaviour — the
imported symbol drives the type, and a typo in a payload literal is an
excess-property error. But it means **`C` must be inferred from the class
directly**. If a command class is first stored in a variable annotated
`CommandHandlerClassStatic<any, any>`, `C` is inferred as that widened type, the
payload collapses to `any`, and the bus silently stops checking anything. The
rule is: pass the imported symbol, never a widened variable.

That is not a rule worth trusting to discipline, and it is also the one claim in
this section that is structural inference rather than a read of existing code. So
the first migration step ships a compile-time guard, using machinery the repo
already has rather than introducing `expectTypeOf`:

```ts
// a *.type.test.ts checked by `pnpm typecheck:tests`
// @ts-expect-error — payload must reject an unknown member
bus.send(ContributeMetricFactsCommand, { ...validPayload, typo: 1 });
```

If the bus ever degrades to `any`, the `@ts-expect-error` becomes unused and
`typecheck:tests` fails. The guard cannot rot, and it costs one file.

#### What the bus deletes

Resolution happens at *call* time, which removes registration order as a
constraint. The first draft listed registration order under "what is better than
it looks". That was wrong: the constraint is self-inflicted. `mapCommands` does
`Object.entries(commands)` — an eager enumeration — and the function it returns
is already deferred. The eagerness, and only the eagerness, is why the three
ordering comments in `registerAll` exist. Under an identity-keyed bus those three
comments are **deleted, not honoured**. The residual risk is re-introducing an
eager lookup somewhere else, which the boot assertion below catches.

**The bus is not weaker than `Deferred`, and it is important to be precise about
why.** A `Deferred` throws on an unresolved *call*, not at boot — it never gave a
startup guarantee, only a better error message (`deferred.ts` names the binding
in the message, and that must survive). To recover the guarantee everyone
*assumed* `Deferred` provided, the composition root asserts after registration
that every command class reachable from a registered pipeline resolves in the
identity map — a boot check that does not exist today in any form, and which
should ship with the first migration step rather than the last.

### 6. Exhaustive composition: prefer the mechanism that already works

The ask was: *adding a dependency to a pipeline should be a compile error until
every composition site supplies it* — and whether a pipeline should export its
dependency contract as a **value** so the `Deps` type and an exhaustiveness check
derive from one declaration.

**Verdict: contract-as-value does not earn its complexity here, because plain
structural checking already delivers the property and three specific holes are
what defeat it.** Each pipeline factory takes a `Deps` interface and is called
from exactly one production site; adding a *required* member is already a compile
error at `createXPipeline({…})`. There is no framework to build. There are three
leaks to close:

**Hole 1 — optional members.** Fifteen `?:` members across the twelve pipeline
`Deps`, nine on `trace-processing`. Adding an optional dep and forgetting to pass
it is silent by definition, and this is exactly the EE-feature pattern. Fix:
**required-but-nullable beats optional.**

```ts
// silent when the composition root forgets
governanceKpisRepository?: GovernanceKpisRepository;

// compile error until every site says `null` on purpose
governanceKpisRepository: GovernanceKpisRepository | null;
```

The `if (deps.x)` guard at the use site is unchanged. What changes is that
omission is no longer expressible. This is a one-character-class edit per member
and it is the whole of Addition 2's requested property.

**Hole 2 — casts at test composition sites.** 262 `as any` / `as unknown as` in
`pipelines/**` tests. A `Deps` literal built with `{} as any` satisfies any
interface forever. Fix: `satisfies XDeps` on dep literals, and the null/in-memory
doubles of §7 so that `as any` stops being the path of least resistance. This is
the same rule as §"100% compile-time safety" above — no cast may bridge a gap the
compiler could have checked.

**Hole 3 — `Partial<AppDependencies>`.** `createTestApp(overrides?:
Partial<AppDependencies>)` is correct for an *override bag* and should stay; the
body already must satisfy the full `AppDependencies` because `new App({…})` takes
it. The genuine defect in that file is not the `Partial` — it is
`{ seedForOrg: async () => {} } as unknown as PromptTagRepository` (`presets.ts`
~1355): a two-property object asserted to be a full repository. Green typecheck,
runtime crash the moment anything else on `PromptTagRepository` is called. That
is the trap of §7 already present in the codebase.

**On the `Record<PipelineName, …>` alternative:** an exhaustive record at the
composition root is worth having, but for a different property. It catches a
*missing pipeline*, not a missing dep, and it is the natural home for the boot
assertion in §5 (every registered pipeline named exactly once, every reachable
command class resolvable). Adopt it for that, not for dep exhaustiveness.

**Where contract-as-value does earn its keep** is §7, and only there — not
because it improves type checking, but because it is the only way to give a
generator a *runtime* description of a contract. That is the next section, and it
is the honest reason to build the small amount of machinery it needs.

### 7. Auto-generated test doubles: the port half only, and why that is the honest line

The ask was *"typesafe null versions auto generated for tests"*, against a
`createTestApp` that is **377 lines**, uses one hand-rolled
`const noop = async () => {}` **84 times**, and hand-instantiates **27 distinct
`Null*Repository` classes**.

**The trap, stated first, because it decides the design.** TypeScript types are
erased. Nothing can generate an implementation from a type alone. A `Proxy`
declared as the contract type *looks* maximally type-safe and is a lie:

- For a **function** member, a no-op is a real, total implementation. `(data) =>
  Promise.resolve()` genuinely satisfies `(data: T) => Promise<void>`.
- For an **object** member, it is unsound. `repo.findAll` on a no-op Proxy
  returns a *function* where the caller expects an array; the very next line
  crashes. That is a runtime failure wearing a green typecheck — the exact
  inversion of the constraint driving this ADR.

So the boundary falls exactly where the owner drew it — *"repos, but never
implementations"*:

| | Auto-generatable? | Why |
| --- | --- | --- |
| **Ports** returning `void` / `Promise<void>` | **Yes** | A no-op is a total implementation. Nothing observes a return value. |
| **Ports** returning a value | **Only with a declared default** | `decideSweepCandidates: () => Promise<GraphTriggerSweepCandidate[]>` and `pruneWebhookDeliveries: () => Promise<number>` are both real ports in `AutomationDispatchPorts`. No generator can invent `[]` vs `null` vs `0` correctly. |
| **Stores / repositories** | **No** | Their return values *are* their behaviour. Inventing them is how you get tests that pass for the wrong reason. |

The port half needs the runtime descriptor from §6 — this is the one place a
contract-as-value pays for itself, because the generator needs to *see* which
members are ports and what each non-void one returns:

```ts
// pipelines/automations/ports.ts — layer 4
export const automationDispatchPorts = {
  evaluateGraphTrigger: voidPort<(p: EvaluateGraphTriggerInput) => Promise<void>>(),
  decideSweepCandidates: port<() => Promise<GraphTriggerSweepCandidate[]>>(() => []),
  pruneWebhookDeliveries: port<() => Promise<number>>(() => 0),
} as const;

export type AutomationDispatchPorts = InferPorts<typeof automationDispatchPorts>;
export const nullAutomationDispatchPorts = nullify(automationDispatchPorts);
```

`port<T>(default)` requiring its default is what makes the value-returning case a
compile error rather than a silent `undefined`. `nullify` is ~20 lines. Adding a
port to the contract adds it to the null double automatically, which is the
"never miss one" property applied where it is soundly achievable.

**The store half must be hand-written, and this is not a limitation to
apologise for.** A null store's return values are a *decision*: does
`findByTraceId` return `null` (absent) or throw (should never be called in this
test)? Does `findAll` return `[]` or the one row this suite needs? Those choices
determine whether a test can fail. A generator that picks for you produces
doubles that make every test pass. The correct move is to reuse the two things
the repo already has rather than invent anything:

**Yes — in-memory and null implementations already exist, in both flavours.**

- **39 `Null*Repository` / `Null*Client` / `Null*Service` classes**, e.g.
  `NullTraceSummaryRepository`, `NullSpanStorageRepository`,
  `NullEvaluationRunRepository`, `NullTopicRepository`,
  `NullCodingAgentSessionRepository`, `NullTriggerRepository`. Every one is
  `implements XRepository`, which means **the compile-time property already
  holds for the store half**: adding a method to a repository interface is
  already an error at every null implementation. Generation was never what
  delivered that — `implements` is. What generation would save is typing the
  bodies, and the bodies are the part that carries meaning.
- **`BaseMemoryProjectionStore`** (`event-sourcing/stores/baseMemoryProjectionStore.ts`)
  — a real `Map`-backed `ProjectionStore<T>` with `getProjection` /
  `storeProjection`, subclassed by exactly two repositories today
  (`simulationRunState.memory.repository.ts`,
  `experimentRunState.memory.repository.ts`). This is the right base for the
  ~21 `PipelineRepositories` members, and it is currently used by two of them.

So the store-half plan is: **extend `BaseMemoryProjectionStore` to the remaining
projection repositories, and keep hand-writing `Null*` for everything else.**
Both already exist, both already give the compile-time guarantee, and neither
needs a framework.

**One cost worth stating plainly**, because it cuts against the constraint: a
generated no-op port makes a test pass when production code *should* have
dispatched something. The 39 `Null*` classes have the same property. Null doubles
buy compile-time completeness at the price of behavioural blindness, which is why
§"Consequences" argues the real win is `subscriberWiring.test.ts` running the
*real* handlers over in-memory stores rather than getting better stubs.

### 8. What `pipelineRegistry.ts` is left holding

Three things, and it should be a function, not a class:

1. **Registration order** — as a flat list, because it no longer encodes
   dependencies, only the order pipelines appear in the ops explorer.
2. **The repository and client bundle** it forwards, unchanged.
3. **The single assembled command surface** — the `registerAll()` return object
   that gives the whole app `commands.traces.recordSpan` with types. This is
   load-bearing and must stay in exactly one place.

The class exists only to hang `this.deps` and `this.cached` off; both move —
`cached` into the layer-1 `FoldCache` of §3. What remains is roughly 150 lines of
`const x = es.register(createXPipeline({…}))`.

**The introspection tail moves out.** `getProjectionMetadata`,
`getEventSubscriberMetadata`, `getProcessManagerMetadata`,
`getKillSwitchDescriptors` and `getDejaViewProjections` — 200 lines at the bottom
of the file, importing `getApp()` — read the *live runtime*, not the registry.
(`getReactorMetadata` was in this list; #6047 replaced the ops surface's
`reactors` with `eventSubscribers` and left it with no caller, so it has been
deleted rather than moved.)
They are a consumer of registration, not part of it, and they are already the
only thing tests import from this module. They belong in `introspection.ts`.


> **Placement corrected.** This row said the *consuming* pipeline's
> `subscribers/`, which contradicted §5's own call-site example and would put
> `codingAgentMetricFactsDispatch.subscriber.ts` under `metric-processing/`
> because metric events are what it consumes. That is wrong: it would drag
> `detectCodingAgent`, `liftCodingAgentLogFacts` and
> `scalarsFromCanonicalAttributes` across the boundary with it, and
> `metric-processing` has no business knowing what a coding agent is. **The
> owning pipeline is the one holding the domain knowledge** — the one whose
> commands the dispatcher sends. `codingAgentMetricFactsDispatch` stays in
> `coding-agent-processing/subscribers/`, which is also where it already lives,
> so nothing moves.

> **Bus corrections from implementation (§5).** Three, one of them a
> correctness bug.
>
> - **`DisabledPipeline` was missed entirely.** `register()` returns early into
>   a disabled proxy when event sourcing is off, *before* any dispatcher loop
>   exists. A bus built to this ADR's letter resolves nothing there, so every
>   cross-pipeline send throws where the codebase's contract is a logged silent
>   drop. The disabled proxy's dispatchers must be indexed too.
> - **"A four-line change in that same loop" is not buildable.** The
>   `eventSourcing.ts` loop walks `pipeline.service.getCommandQueues()`, a
>   `Map<name, processor>` — `handlerClass` is not in scope. The index comes
>   from `definition.commands`, a separate array, keyed by name against the
>   dispatchers record.
> - **The boot assertion was specified as something uncomputable.** "Every
>   command class reachable from a registered pipeline" has no static
>   description — nothing declares what a pipeline dispatches into. Inverted:
>   the bus records every class handed to `port()` and asserts those resolve.
>   Binding a port enrols you, so it cannot rot. It does not cover bare `send()`
>   sites, which is the honest limit.

> **Ordering comments: one, not three, and not yet deletable.** `registerAll`
> carries a single ordering comment (plus one on the `registerCodingAgentPipeline`
> docblock). It cannot go at step 1 either: trace-processing still builds
> `createCodingAgentSpanFactsDispatchSubscriber` in the registry, closing over
> `codingAgentCommands.contributeSpanFacts` eagerly. Both comments are narrowed
> to trace and go at step 7.
>
> **DONE (2026-07-29).** Both comments are gone. Trace-processing mounts
> `codingAgentSpanFactsDispatch` itself, binding
> `deps.commands.port(ContributeSpanFactsCommand)` — the shape
> `metric-processing` already used — which deletes the last eager
> `contributeSpanFacts` closure and with it the registration-order constraint
> the comments existed to record. The `subscribers?: EventSubscriberDefinition[]`
> dep is replaced by a layer-4 `getNormalizedSpanById` port.

## Migration order

Ten-plus pipelines, one at a time, each independently shippable. Ordered by what
each step *proves*, not by size.

**The checklist says not to impose a layering in a single PR. That caveat mostly
does not apply here, and it is worth saying why:** the layers already exist in
this codebase. `app-layer/` has services and repositories, with 39 null
implementations and a repository/service split CLAUDE.md already enforces
(`findAll`/`findById` on repositories, `getAll`/`getById` on services). Layers 4
and 6 exist in five pipelines under ADR-052. What does not exist is layer 5 as a
*bounded* thing, and what is not respected is the boundary at composition. That
is a much smaller ask than inventing a layering, and it is why this can proceed
incrementally instead of as one PR.

0. **`FoldCacheClient` and the layer-1 seam, before any pipeline moves.** It
   deletes `as Redis`, deletes the `instanceof Cluster` ternary, and reconciles
   the two divergent cache paths onto one tier. It touches six pipelines'
   construction but no pipeline's contents, and it is the step that carries the
   one behaviour change — the automations reader gains the warm tier under
   Cluster — so it should land alone and be called out.
1. **`metric-processing` and `log-processing`.** Sixty-two and thirty-nine
   lines, one illegal dep each (`subscribers`), and that dep is precisely the
   cross-pipeline dispatch case — so the smallest possible diff is the one that
   proves the command bus. Ships with the `@ts-expect-error` type guard and the
   boot assertion. Deletes the first of the three ordering comments.
   `metricCommandLanes.unit.test.ts` stubs only stores today, so the test delta
   is a clean read on whether the new shape helps.
2. **`automations`.** Out of order relative to the first draft, and deliberately:
   it is already Rule-1 compliant, so this step is *purely* the layering.
   `automationDispatch.wiring.ts` becomes `automationDispatch.adapter.ts`,
   `getProtectionsDeduped` moves to `TraceService`, the eleven construction sites
   move to the composition root or to services, and what is left should be under
   50 lines of `port: (args) => service.method(args)`. This is the step that
   proves the layering does what it claims, on the worst file.
3. **`coding-agent-processing`** — only the three store adapters re-home.
   Establishes "repository crosses, store adapter does not" with no behaviour in
   play.
4. **`simulation-processing`** — self-dispatch, cross-dispatch and a
   `withCommandInstance` command in one file. Proves the bus on a self-reference
   and on a DI'd command, and kills two `Deferred`s.
5. **`langy-conversation-processing`, `topic-clustering-processing`,
   `billing-reporting`, `experiment-run-processing`** — mechanical; each removes
> **There are two untyped `getPipeline()` self-dispatch sites, not one.** The
> registry site is retired by this step. The second lives in the `EventSourcing`
> **constructor** (`eventSourcing.ts:156`), feeding
> `createBillingMeterDispatchReactor` for the SaaS billable-events meter. It is
> invisible to the migration table because it is not on a pipeline at all — it
> is on the runtime, and its row would read "billing → billing (self)". It
> cannot be retired the same way: the bus lives on the instance being
> constructed, and importing the command class as a *value* into
> `eventSourcing.ts` adds a runtime edge to a module every pipeline already
> imports. It needs its own decision.

   one late-binding mechanism. `billing-reporting` retires the untyped
   `getPipeline()` self-dispatch.
6. **`evaluation-processing`** — the honest one. See below.
7. **`trace-processing` last**, when everything it dispatches into already
   exposes its command classes and the bus has run in production for weeks. Its
   nine optional deps become nullable in the same step.

   > **PARTIALLY DONE (2026-07-29), and the remainder is not a move.** The one
   > OSS dep — `subscribers?: EventSubscriberDefinition[]` — is gone: the
   > pipeline mounts `codingAgentSpanFactsDispatch` itself. The other five
   > (`triggerMatchSubscriber`, `gatewayBudgetDebitsProjection`,
   > `virtualKeyLastUsedSubscriber`, `governanceKpisProjection`,
   > `governanceOcsfEventsProjection`) are all constructed from `@ee/governance/*`,
   > and "What does not move" below already forbids the obvious fix: an OSS
   > pipeline file cannot import `ee/` unconditionally without breaking an OSS
   > build. So they stay injected, and they are the repo's remaining Rule 1
   > violations — named individually in the pipeline's own docblock rather than
   > papered over.
   >
   > Closing them needs an **enterprise composition seam** (a registration point
   > an EE build supplies and an OSS build leaves empty), not a relocation. That
   > is its own decision, and it is the real step 7 remainder.

## What does not move

- **`ExecuteEvaluationCommand`'s dependencies are seven app-layer services**
  (monitors, span storage, trace events, evaluation execution, cost recorder, an
  Azure env resolver, and the inputs-offload gate). Constructing it inside
  `evaluation-processing/pipeline.ts` moves the `new` but not the service-ness:
  that pipeline's `Deps` will name seven layer-3 values, not seven repositories.
  This is more honest than hiding them in the registry, and it is not "repos
  only". Say so rather than pretending. Narrowing them to layer-4 ports is a
  decomposition of the evaluation-execution service and belongs in its own
  decision.
- **The `offloadInputs` closure** — 30 lines of feature-flag reads and fail-open
  policy currently inline in `registerEvaluationPipeline`. It is evaluation
  domain policy, i.e. layer 3. It moves *sideways*, into
  `pipelines/evaluation-processing/commands/`, not up into `pipeline.ts`.
- **`datasetNormalize`.** A standalone GroupQueue job over Postgres and S3,
  mounted on the trace pipeline for no reason but proximity, wired into the
  dataset module through a global mutable setter. It belongs to no pipeline. It
  should get its own the way `blob_maintenance` did; until it does it stays as
  registry-held wiring, and it is the clearest single piece of evidence that the
  registry became a place to put things.
- **The `if (deps.x)` optional-dep pattern.** It is how enterprise features stay
  out of OSS builds. The *guard* survives verbatim; what changes is that the dep
  becomes `T | null` rather than `T?` (§6) and that the thing guarded is a
  repository, not a projection.
- **`registerEnterprisePipelineSet`.** `ee/` cannot be imported unconditionally
  from OSS pipeline files. The enterprise set stays a separate composition
  called from the core one, and gets the same treatment inside its own boundary.

## What is better than it looks

Two things in the current design are load-bearing and must survive the move. The
first draft listed four; two of them were wrong and are corrected above.

**`Deferred` is the honest version of a hard problem.** It names the binding and
throws with that name (`deferred.ts`: *`Deferred "x" not yet resolved — pipeline
registration order issue`*). Whatever replaces it must keep the named error; a
bare thunk would be a regression. The bus's resolution failure must name the
command class and list what is registered, which `getPipeline` already models.

**Five pipelines already do this.** `automations` and
`topic-clustering-processing` declare their whole topology inline; "only the
executor dependencies are injected" is `automations`' own docblock, from ADR-052.
The `Ports` / `DispatchDeps` bundle those five use is layer 4 in everything but
name — a record of narrow function types declared inside the pipeline's own
directory, consumed through an applier the pipeline file constructs
(`scenarioExecutionPM(deps.dispatch)`). This ADR generalises a shape that is
already load-bearing in production, which is why it is a restructure and not an
experiment.

**Corrected — `automationDispatch.wiring.ts` is not the pattern to copy.** It had
the right instinct and the wrong execution; see "The diagnosis" above. It is
cited here as the file the layering exists to fix, and as migration step 2.

**Corrected — `this.cached()` is not centralised policy.** It is one of two
divergent implementations of one policy, held together by a cast; see §3.

## Consequences

- `pipeline.ts` becomes the file you read. `trace-processing/pipeline.ts` goes
  from 316 lines of holes to roughly 450 lines of statements.
- **`Deps` interfaces get wider, not narrower.** Trace-processing trades fifteen
  behaviour members for the repositories, clients and ports those fifteen
  handlers actually need, and the member count may well go up. The win is not
  fewer dependencies; it is that every remaining dependency is inert — you can
  read the file and know what happens, and a test can satisfy it with an
  in-memory store instead of a `vi.fn()`.
- **A file called `*.wiring.ts` stops existing.** Every file in a pipeline
  directory has a layer, and every layer has a one-line membership test, so
  "where does this go" has an answer that does not require taste.
- `as Redis` and the `instanceof Cluster` ternary both disappear, and the two
  fold-cache paths stop disagreeing.
- Tests get simpler at exactly the point they are worst today.
  `subscriberWiring.test.ts`'s seven `reactorStub()` calls become the real
  handlers over in-memory stores, so the test starts asserting against what runs
  in production rather than against placeholder objects with the right shape.
- **Cost: there stops being one file that shows the whole wiring graph.** Today
  you can read `pipelineRegistry.ts` and see what talks to what. After this you
  cannot, and that is a genuine loss for exactly the question people most often
  ask. The mitigation is to extend the introspection functions to include
  cross-pipeline command dispatch, so the ops explorer answers it from the live
  runtime — better than a source read did, but only if that work ships with the
  migration rather than after it.
- **Cost: the command bus defers existence checking to first call**, unless the
  boot assertion ships with it. It ships in step 1, not the last step.
- **Cost: null doubles buy completeness at the price of blindness.** A generated
  no-op port cannot fail a test that should have failed. This is why the port
  generator is scoped to ports and why in-memory stores, not null stores, are the
  target for the repository half.
- **Cost: `pipeline.ts` gains type imports from `~/server/app-layer/**`.** Types
  carry no runtime edge, so the layering holds, but the coupling is real; the
  layer-5 adapter exists precisely for the cases where a *value* would otherwise
  be needed.
- Registration order stops being load-bearing, which removes a whole class of
  boot-order bug that currently has no test guarding it.
- One late-binding mechanism instead of three.
- This is a refactor with no behavioural change **except the fold-cache
  correction in §3**, and therefore no spec of its own beyond a corrected
  `specs/event-sourcing/pipeline-model.feature`, whose three scenarios are
  currently **untagged and therefore enforce nothing**. The layer membership
  tests are mechanically checkable and should become lint rules or bound
  scenarios — otherwise the next ADR-075-style conversion re-adds an injected
  projection, or the next composition file grows a cache, and nothing notices.
  That is exactly how the current state was reached.

## References

- `dev/docs/CODING_STANDARDS.md` and the `review-code` skill's
  `references/code-checklist.md` — the length, SRP, layering, utility-placement
  and hidden-mutability tests applied above; this ADR invents no new standard
- [`specs/event-sourcing/pipeline-model.feature`](../../../specs/event-sourcing/pipeline-model.feature)
  — untagged today; the layer membership tests are the scenarios it is missing
- [`specs/event-sourcing/post-event-work.feature`](../../../specs/event-sourcing/post-event-work.feature)
- `src/server/event-sourcing/README.md` — "Step 1: Define the Pipeline (static,
  no runtime deps)", the claim this ADR makes true
- `src/server/event-sourcing/commands/commandHandlerClass.ts` —
  `CommandHandlerClassStatic` and `ExtractCommandHandlerPayload`, the two types
  the bus signature is built from
- `src/server/event-sourcing/pipeline/staticBuilder.ts` — `withCommand` (528) and
  `withCommandInstance` (577) already extract payloads exactly this way;
  `commands` (134) is the array the identity map is built from
- `src/server/event-sourcing/eventSourcing.ts` — `register()` (319–323) is where
  the identity map is populated; `getPipeline()` (196) is the untyped bus
- `src/server/event-sourcing/pipelineRegistry.ts:295,362` — the `Redis | Cluster`
  dep and the `as Redis` cast that hides it
- `src/server/event-sourcing/pipelines/automations/automationDispatch.wiring.ts`
  — the file this ADR's layering exists to fix; migration step 2
- `src/server/event-sourcing/projections/redisCachedFoldStore.ts` — takes
  `redis: Redis`, issues only `get`/`set`; the narrow requirement the union
  cannot satisfy
- `src/server/event-sourcing/stores/baseMemoryProjectionStore.ts` and the two
  `*.memory.repository.ts` subclasses — the existing in-memory store half
- `src/server/app-layer/presets.ts:1322` — `createTestApp`, 377 lines, and the
  `as unknown as PromptTagRepository` that is the §7 trap already in the tree
- `src/server/event-sourcing/deferred.ts` — the mechanism this replaces, and the
  named error the replacement must keep
- ADR-052 (automations on the process-manager substrate) — where "only the
  executor dependencies are injected" was first written down, for one pipeline
- ADR-074 (package topology) — the same boundary question one level up
- ADR-075 (post-event work is subscribers and process managers) — its
  conversions land as injected projections and subscribers under today's shape,
  which is what makes this decision urgent rather than cosmetic
