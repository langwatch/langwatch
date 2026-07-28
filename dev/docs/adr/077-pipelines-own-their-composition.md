# ADR-077: A pipeline is defined in its own file

- Status: proposed
- Date: 2026-07-28
- Builds on: ADR-052 (automations on the process-manager substrate — which
  introduced the "only the executor dependencies are injected" rule that this
  ADR generalises), ADR-074 (package topology), ADR-075 (post-event work is
  subscribers and process managers), ADR-076 (the unit of dispatched work)
- Applies to: `src/server/event-sourcing/pipelineRegistry.ts` and every
  `pipelines/*/pipeline.ts`

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
| Pipelines whose registration order is load-bearing | **3** (`codingAgent` before metric/log/trace; `evaluation` before trace) |

And on the other side of the seam, across the twelve `pipelines/*/pipeline.ts`
files: **63 `Deps` members, of which 27 are behaviour** — a
`ReactorDefinition`, an `EventSubscriberDefinition`, a `MapProjectionDefinition`
or a constructed command instance, passed in and then handed straight to
`.withReactor` / `.withEventSubscriber` / `.withMapProjection` /
`.withCommandInstance`. Fifteen of those 27 are on `trace-processing` alone,
whose `Deps` has 21 members and whose file cannot tell you what the pipeline
does without reading a thousand lines of registry to find out what was passed.

**ADR-075 does not fix this, and the evidence landed while this ADR was being
written.** Converting `gatewayBudgetSync`, `governanceKpisSync` and
`governanceOcsfEventsSync` from reactors to projections replaced three
`ReactorDefinition` deps with three `MapProjectionDefinition` deps on the same
pipeline, still constructed in the registry, still injected, still guarded by
`if (deps.x)`. The reactor retirement changes *what kind* of behaviour is
injected. It does not change *that* behaviour is injected. Every conversion in
ADR-075's remaining classes will land the same way unless the seam itself moves.

Three concrete symptoms:

**You cannot read a pipeline.** `trace-processing/pipeline.ts` registers seven
reactors, three optional projections, two subscribers and an open-ended
`subscribers[]` array, and names none of what they do. `originGateReactor` could
be anything. The file is a list of holes.

**The registry is a god object by accretion, not by design.** It holds S3
offload policy with its own feature-flag fail-open (30 lines inside
`registerEvaluationPipeline`), an in-memory `setTimeout` fallback for when Redis
is absent, the dataset-normalize job — which has nothing to do with traces and
is mounted on the trace pipeline because that pipeline was handy — and a
`registerDatasetNormalizeEnqueue` call into a global mutable setter. None of
this is composition. It is domain code that ended up in the composition root
because the composition root was where the pieces met.

**Late binding is solved three different ways in one file.** `Deferred` (7
sites), a `let x: T | null = null` closure that throws a bespoke message (topic
clustering, and again in `ee/event-sourcing/pipelineSet.ts`), and
`eventSourcing.getPipeline(NAME).commands.x.send(...)` (billing). All three do
the same thing.

The tests already voted. **No test constructs `PipelineRegistry`** — the two
test files that reference the module import its *introspection* functions.
`createTestApp` (`presets.ts:1322`) bypasses it entirely and hand-builds an
`App` with noop command dispatchers. The ten test files that exercise a real
pipeline call its factory directly with a hand-built `Deps`, and in those files
the stores are `{} as any` while the behaviour has to be faked one stub at a
time — `subscriberWiring.test.ts` writes a `reactorStub()` helper and calls it
seven times to test two subscribers.

## Decision

**A pipeline's topology is declared in its own `pipeline.ts`, from symbols that
file imports. Its `Deps` carry data access and nothing else.**

### The boundary, stated so it needs no judgement

Two rules. Both are mechanical, both are greppable, and together they decide
every case.

**Rule 1 — nothing in `Deps` may be a value the builder registers.** Every
argument to `.withFoldProjection`, `.withMapProjection`, `.withProjection`,
`.withReactor`, `.withSubscriber`, `.withEventSubscriber`, `.withProcessManager`,
`.withCommand` and `.withCommandInstance` is constructed in `pipeline.ts` from a
symbol `pipeline.ts` imports. `deps.x` may appear *inside* those arguments; it
may never *be* one.

```ts
// illegal — the dep is the registered value
.withMapProjection("governanceKpis", deps.governanceKpisProjection)

// legal — the dep is an argument to a value this file constructs
.withMapProjection("governanceKpis",
  new GovernanceKpisMapProjection({ store: deps.governanceKpisRepository }))
```

**Rule 2 — a dep is a noun, never a verb.** Every `Deps` member is a
repository, a store, a client (prisma, redis, an object store), a scalar
config value, or a named port function over one of those. If a member's type
name ends in `Reactor`, `Subscriber`, `Projection`, `Command`, or `Pipeline`,
Rule 1 has already rejected it; if it ends in `Service` and the pipeline calls
more than one of its methods, it is a verb wearing a noun's clothes and should
be narrowed to the ports actually used.

The pipeline-owned **`Ports` / `DispatchDeps` bundle stays legal**, because it
is a record of narrow functions the pipeline calls, its type is declared inside
the pipeline's own directory, and the process builder consumes it through an
applier the pipeline file constructs — `scenarioExecutionPM(deps.dispatch)`.
That is exactly the shape ADR-052 approved and five pipelines already use.

### Where each thing lives

| Thing | Lives in | Constructed by | Crosses `Deps` as |
| --- | --- | --- | --- |
| Command handler | `pipelines/<x>/commands/` | `pipeline.ts` | the repositories/ports its constructor takes |
| Fold / map projection | `pipelines/<x>/projections/` | `pipeline.ts` | — |
| Projection **store adapter** (`TraceSummaryStore`, `SpanAppendStore`) | `pipelines/<x>/projections/` | `pipeline.ts` | the **repository** it wraps |
| Redis fold cache | framework | `pipeline.ts` | a `foldCache.wrap(store, prefix)` port |
| Subscriber | `pipelines/<x>/subscribers/` | `pipeline.ts` | the ports its `Deps` declare |
| Process-manager `evolve`/`onWake` | `pipelines/<x>/process-manager/*.process.ts` | `pipeline.ts`, via the in-file `xPM()` applier | — |
| Process-manager **intent handler** | `pipelines/<x>/process-manager/*IntentHandlers.ts` | `pipeline.ts` | its `DispatchDeps` port bundle |
| Cross-pipeline dispatcher | the *consuming* pipeline's `subscribers/` | `pipeline.ts` | the command bus (below) |
| App-layer glue too impure for `pipeline.ts` | `pipelines/<x>/wiring.ts` | the composition root | the ports it produces |

That last row is not a loophole invented here — `pipelines/automations/
automationDispatch.wiring.ts` already is it. It takes prisma, redis, services
and a repository and produces `AutomationDispatchPorts`, and it lives inside the
pipeline's own directory, so "read the pipeline" is still one place to look. The
division is: **`wiring.ts` builds ports, `pipeline.ts` builds topology**, and
`pipeline.ts` may import a *type* from `~/server/app-layer/**` but never a
*value*.

### Self-reference and cross-pipeline dispatch are one problem

Every cross-pipeline coupling in this codebase — all eleven of them — is
command dispatch. Not one is "pipeline A needs pipeline B's handler":

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

Self-reference is therefore not a separate problem, and the `Deferred` pattern
is not inherent to it — it is an artefact of building the dispatching *handler*
outside the pipeline, at a moment when the pipeline does not exist yet. Move the
handler in, and the only thing that still has to be late is the *lookup*.

**The repo already contains the right mechanism and nobody generalised it.**
`billing-reporting` does this today in one line, with no `Deferred`, no resolve
step and no ordering constraint:

```ts
selfDispatch: (data) =>
  this.deps.eventSourcing
    .getPipeline(BILLING_REPORTING_PIPELINE_NAME)
    .commands.reportUsageForMonth.send(data),
```

Promote it to a typed, name-keyed **command bus** — a client, in exactly the
sense redis is a client, with no domain behaviour of its own. Each pipeline
exports a typed reference beside its factory:

```ts
// pipelines/simulation-processing/pipeline.ts
export const SIMULATION_PIPELINE = pipelineRef<SimulationCommands>("simulation_processing");
```

and any pipeline — including itself — dispatches through it:

```ts
// pipelines/trace-processing/pipeline.ts
const simulationMetricsSync = createSimulationMetricsSyncSubscriber({
  computeRunMetrics: deps.commands.of(SIMULATION_PIPELINE).computeRunMetrics,
});
```

The ref is a type-only import, so there is no runtime cycle. Resolution happens
at *call* time, which is what removes registration order as a constraint: today
`registerAll` carries the comment *"Registered BEFORE the metric, log and trace
pipelines: their coding-agent dispatch subscribers close over this pipeline's
contribution commands"*, and under the bus that sentence stops being true of
anything.

**This is not weaker than `Deferred`, and it is important to be precise about
why.** A `Deferred` throws on an unresolved call, not at boot — it never gave a
startup guarantee, only a better error message. The bus must keep that error
message (name the ref, list what is registered, which `getPipeline` already
does). To recover the guarantee everyone *assumed* `Deferred` provided, the
composition root asserts after registration that every ref reachable from a
registered pipeline resolves — a boot check that does not exist today in any
form.

### What `pipelineRegistry.ts` is left holding

Three things, and it should be a function, not a class:

1. **Registration order** — as a flat list, because it no longer encodes
   dependencies, only the order pipelines appear in the ops explorer.
2. **The repository and client bundle** it forwards, unchanged.
3. **The single assembled command surface** — the `registerAll()` return object
   that gives the whole app `commands.traces.recordSpan` with types. This is
   load-bearing and must stay in exactly one place.

The class exists only to hang `this.deps` and `this.cached` off; both move. What
remains is roughly 150 lines of `const x = es.register(createXPipeline({…}))`.

**The introspection tail moves out.** `getProjectionMetadata`,
`getReactorMetadata`, `getEventSubscriberMetadata`, `getProcessManagerMetadata`,
`getKillSwitchDescriptors` and `getDejaViewProjections` — 200 lines at the
bottom of the file, importing `getApp()` — read the *live runtime*, not the
registry. They are a consumer of registration, not part of it, and they are
already the only thing tests import from this module. They belong in
`introspection.ts`.

**The registry keeps a small residue that is genuinely nobody's pipeline**, and
this ADR does not pretend otherwise. See "What does not move".

### Migration order

Ten-plus pipelines, one at a time, each independently shippable. Ordered by what
each step *proves*, not by size.

1. **`metric-processing` and `log-processing` first.** Sixty-two and thirty-nine
   lines, one illegal dep each (`subscribers`), and that dep is precisely the
   cross-pipeline dispatch case — so the smallest possible diff is the one that
   proves the command bus. It also deletes the first of the three load-bearing
   ordering constraints in `registerAll`, which is the payoff made visible.
   `metricCommandLanes.unit.test.ts` stubs only stores today, so the test delta
   is a clean read on whether the new shape helps.
2. **`coding-agent-processing`** — already compliant under Rule 1; only the three
   store adapters re-home. This is the step that establishes
   "repository crosses, store adapter does not" with no behaviour in play.
3. **`simulation-processing`** — self-dispatch, cross-dispatch and a constructed
   command in one file. Proves the bus on a self-reference and kills two
   `Deferred`s.
4. **`langy-conversation-processing`, `topic-clustering-processing`,
   `billing-reporting`, `experiment-run-processing`** — mechanical; each removes
   one late-binding mechanism.
5. **`evaluation-processing`** — the honest one. See below.
6. **`trace-processing` last**, when everything it dispatches into already
   exposes a ref and the bus has run in production for weeks.

The `automations`, `blob-maintenance` and EE `ingestion-pull` pipelines are
already compliant and need no step.

### What does not move

- **`ExecuteEvaluationCommand`'s dependencies are seven app-layer services**
  (monitors, span storage, trace events, evaluation execution, cost recorder,
  an Azure env resolver, and the inputs-offload gate). Constructing it inside
  `evaluation-processing/pipeline.ts` moves the `new` but not the service-ness:
  that pipeline's `Deps` will name seven services, not seven repositories. This
  is more honest than hiding them in the registry, and it is not "repos only".
  Say so rather than pretending. Narrowing them to ports is a decomposition of
  the evaluation-execution service and belongs in its own decision.
- **The `offloadInputs` closure** — 30 lines of feature-flag reads and fail-open
  policy currently inline in `registerEvaluationPipeline`. It is evaluation
  domain policy. It moves *sideways*, into
  `pipelines/evaluation-processing/commands/`, not up into `pipeline.ts`.
- **`datasetNormalize`.** A standalone GroupQueue job over Postgres and S3,
  mounted on the trace pipeline for no reason but proximity, wired into the
  dataset module through a global mutable setter. It belongs to no pipeline. It
  should get its own the way `blob_maintenance` did; until it does it stays as
  registry-held wiring, and it is the clearest single piece of evidence that the
  registry became a place to put things.
- **The `if (deps.x)` optional-dep pattern.** It is how enterprise features stay
  out of OSS builds. It survives verbatim — what changes is that the optional
  dep is a repository, not a projection.
- **`registerEnterprisePipelineSet`.** `ee/` cannot be imported unconditionally
  from OSS pipeline files. The enterprise set stays a separate composition
  called from the core one, and gets the same treatment inside its own boundary.

### What is better than it looks

Four things in the current design are load-bearing and must survive the move.

**Registration order is a real constraint, correctly observed.** The comments in
`registerAll` are not clutter; they are the only documentation of a genuine
dependency. They stop mattering *only because* the bus resolves late. Anyone who
"simplifies" the bus to resolve eagerly reintroduces the constraint silently.

**`Deferred` is the honest version of a hard problem.** It names the binding and
throws with that name. Whatever replaces it must keep the named error; a bare
thunk would be a regression.

**`this.cached()` is a policy, centralised.** Six pipelines get identical
Redis-cached-fold semantics and one key-prefix convention from one three-line
method. Scattering `new RedisCachedFoldStore(...)` across six files would lose
that. Hence a `foldCache` port in `Deps` rather than inlining the wrapper — the
policy stays in one place, the *decision to apply it* moves to the pipeline that
owns the fold.

**`automationDispatch.wiring.ts` already solved the layering problem.** A
pipeline-owned wiring module that takes raw clients and produces ports is the
shape to copy. It was not recognised as a pattern; it is one.

## Consequences

- `pipeline.ts` becomes the file you read. `trace-processing/pipeline.ts` goes
  from 309 lines of holes to roughly 450 lines of statements.
- **`Deps` interfaces get wider, not narrower.** Trace-processing trades fifteen
  behaviour members for the repositories, clients and ports those fifteen
  handlers actually need, and the member count may well go up. The win is not
  fewer dependencies; it is that every remaining dependency is inert — you can
  read the file and know what happens, and a test can satisfy it with an
  in-memory store instead of a `vi.fn()`.
- Tests get simpler at exactly the point they are worst today.
  `subscriberWiring.test.ts`'s seven `reactorStub()` calls become the real
  handlers over fake stores, so the test starts asserting against what runs in
  production rather than against placeholder objects with the right shape.
- **Cost: there stops being one file that shows the whole wiring graph.** Today
  you can read `pipelineRegistry.ts` and see what talks to what. After this you
  cannot, and that is a genuine loss for exactly the question people most often
  ask. The mitigation is to extend the introspection functions to include
  cross-pipeline command refs, so the ops explorer answers it from the live
  runtime — better than a source read did, but only if that work actually ships
  with the migration rather than after it.
- **Cost: the command bus defers existence checking to first call**, unless the
  boot assertion described above ships with it. It should ship with the first
  step, not the last.
- **Cost: pipeline files gain imports from `~/server/app-layer/**`.** The
  type-only rule bounds the cycle risk but does not eliminate the coupling; the
  `wiring.ts` escape hatch exists precisely for the cases where it would.
- Registration order stops being load-bearing, which removes a whole class of
  boot-order bug that currently has no test guarding it.
- One late-binding mechanism instead of three.
- This is a refactor with no behavioural change and therefore no spec of its own
  beyond a corrected `specs/event-sourcing/pipeline-model.feature`, whose three
  scenarios are currently **untagged and therefore enforce nothing**. Rule 1 is
  mechanically checkable and should become a lint rule or a bound scenario —
  otherwise the next ADR-075-style conversion re-adds an injected projection and
  nothing notices, which is exactly how the current state was reached.

## References

- [`specs/event-sourcing/pipeline-model.feature`](../../../specs/event-sourcing/pipeline-model.feature)
  — untagged today; Rule 1 is the scenario it is missing
- [`specs/event-sourcing/post-event-work.feature`](../../../specs/event-sourcing/post-event-work.feature)
- `src/server/event-sourcing/README.md` — "Step 1: Define the Pipeline (static,
  no runtime deps)", the claim this ADR makes true
- `src/server/event-sourcing/pipelines/automations/pipeline.ts` and
  `topic-clustering-processing/pipeline.ts` — the two pipelines that already
  declare their whole topology inline; "only the executor dependencies are
  injected" is their own docblock
- `src/server/event-sourcing/pipelines/automations/automationDispatch.wiring.ts`
  — the pipeline-owned wiring module, generalised here
- `src/server/event-sourcing/pipelines/billing-reporting/pipeline.ts` and
  `registerBillingReportingPipeline` in `pipelineRegistry.ts` —
  `getPipeline()` self-dispatch, the command bus in its untyped form
- `src/server/event-sourcing/deferred.ts` — the mechanism this replaces, and the
  error message the replacement must keep
- ADR-052 (automations on the process-manager substrate) — where "only the
  executor dependencies are injected" was first written down, for one pipeline
- ADR-074 (package topology) — the same boundary question one level up
- ADR-075 (post-event work is subscribers and process managers) — its
  conversions land as injected projections and subscribers under today's shape,
  which is what makes this decision urgent rather than cosmetic
