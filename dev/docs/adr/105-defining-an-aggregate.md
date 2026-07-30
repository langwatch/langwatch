# ADR-105: An aggregate is one declaration — events, commands and types are derived from it

**Date:** 2026-07-30

**Status:** Accepted — the rule is in force for every new aggregate; the 13
existing pipelines convert in the order named below, and none of them is
rewritten by this decision.

**Builds on:** ADR-098 (the projection kinds, and the delivery-identity
sequence — a monotonic per-group sequence assigned at staging, not an
ordering guarantee — that keeps a redelivered job from being applied twice),
ADR-099 (`defineTable` and the fold store's generation ladder, which is what a
derived state version stamps).

**Related:** ADR-100 (the group-key scope a declaration may override), ADR-101
(replay, the only reader that must parse an event type string this ADR derives),
ADR-102 (where the declaration lives once the core moves to
`packages/event-sourcing`).

## Context

Declaring an aggregate costs more lines than implementing it. There are 13
pipelines under `langwatch/src/server/event-sourcing/pipelines/` — 238 non-test
TypeScript files, 37,267 lines. Of that, 11 `schemas/` directories hold 3,838
lines (4,006 with `langwatch/ee/event-sourcing/pipelines/ingestion-pull-processing/schemas`),
and almost none of it is logic: 1,794 lines of `events.ts` across 11 files, 805
lines of `constants.ts` across 11, and 259 lines of `typeGuards.ts` across 4
that are pure `event.type === CONSTANT` narrowing.

### One event is declared in four places that can disagree

Take `lw.experiment_run.started`. Its type string is written at
`experiment-run-processing/schemas/constants.ts:10`; its version at `:20`; its
membership in the array the router filters on at `:27`; and its payload,
envelope and exported type at `schemas/events.ts:22-28`, `:30-35` and `:37-39`.
A fourth site is platform-wide: each pipeline's array is spread into
`EVENT_TYPE_IDENTIFIERS` at `schemas/typeIdentifiers.ts:74-90`, and the
aggregate type it belongs to is hand-listed again at `:122-138`.

The ratio inside `events.ts` is the measurement that matters. That event's
payload is 7 lines. The envelope wrapping it is 6, and the `z.infer` type export
is 3 — 9 lines of ceremony for 7 lines of content, before `constants.ts`
contributes 3 more and the union at `:139-143` a fourth. Repeated 72 times:
that is the count of `EventSchema.extend` call sites across
`langwatch/src` and `langwatch/ee`.

Some of these files hold nothing else. `coding-agent-processing/schemas/commands.ts`
is 22 lines that alias three contribution schemas under three new names and
export three `z.infer` types. `contributeSpanFactsCommand.ts` extracts the same
aggregate id twice — `aggregateId: data.sessionId` at `:34`, and
`static getAggregateId` returning `payload.sessionId` at `:50`.

### The derivation already exists, pointing the wrong way

`projections/eventTypeTransforms.ts:33-36` derives `"suite_run.item_started"` →
`"SuiteRunItemStarted"` at the type level, and `:79-81` does it at runtime;
`abstractFoldProjection.ts:52-64` turns a tuple of event schemas into the exact
set of `handle*` methods a fold must implement, so missing one is a compile
error. The machinery to derive names from strings is built and load-bearing. It
runs in the wrong direction: the authored artefact is the string, and the
readable name is computed from it, when the readable name is the thing a
developer actually wants to write.

### A projection version is a hand-typed date, and the hand slips

All 13 fold projections declare a `readonly version`, across 10 declaration
sites and two incompatible conventions — `*_PROJECTION_VERSIONS` objects
(`simulation-processing/schemas/constants.ts:114`,
`experiment-run-processing/schemas/constants.ts:54`,
`evaluation-processing/schemas/constants.ts:122`,
`topic-clustering-processing/schemas/constants.ts:60`, the ee pipeline's at
`:38`, and `LANGY_CONVERSATION_PROJECTION_VERSIONS` from `@langwatch/langy`) and
bare `*_VERSION_LATEST` constants
(`codingAgentSession.foldProjection.ts:80`,
`evaluationAnalytics.foldProjection.ts:95`,
`traceAnalytics.foldProjection.ts:167`,
`trace-processing/schemas/constants.ts:186`). Nothing connects any of those
strings to the state shape they stamp. The version moves when a human remembers
to move it.

The cost of forgetting is recorded in the code, in the fold's own docblock.
`codingAgentSession.foldProjection.ts:83-90`: "Neither migration bumped the
projection version, so this stamp spans BOTH sides of the read-back
columns… The version alone therefore cannot decide whether a row is decodable."
That fold now carries three version constants — the current stamp at `:80`, the
ambiguous one at `:104`, and a withdrawn generation at `:122` — and
`traceAnalytics` needs a decodable-version set at `traceAnalytics.store.ts:22`
checked at `:194`.

ADR-099's generation ladder absorbed the read side of this, and its own docblock
names the source. `foldCodec.ts:27-34` introduces `provenBy` for the case where
"a shape change shipped without renaming the shape, so one stamp spans two row
shapes and the stamp alone cannot separate them", and then says the quiet part:
"A store that owns its own stamp cannot create this situation." The escape hatch
exists because the stamp is authored by a person. Nothing downstream can remove
that; only the declaration can.

## Decision

### 1. An aggregate is one declaration, shaped like `createSlice`

One call — a name, an id extractor, a state schema, an `events` map and a
`commands` map:

```ts
export const codingAgentSession = defineAggregate({
  name: "coding_agent_session",
  prefix: "lw.obs",
  aggregateId: (data: { sessionId: string }) => data.sessionId,
  state: codingAgentSessionStateSchema,
  events: {
    spanFactsContributed: (state, data: SpanFacts) => ({ ...state, ... }),
    logFactsContributed: (state, data: LogFacts) => ({ ...state, ... }),
  },
  commands: {
    contributeSpanFacts: (data: SpanFacts) => [
      { spanFactsContributed: data, idempotencyKey: ... },
    ],
  },
});
```

Redux Toolkit is the reference deliberately: it is the API a TypeScript
developer already knows for "one object declares the state, the transitions, and
the typed creators", and it is already the shape of the fold — a reducer over a
state and an event.

### 2. Everything nameable is derived

From the declaration: the event type string (`prefix` + `name` + snake_cased
map key), the event payload type (from the handler's second parameter, so the
payload type is written once, where it is used), the event union, the
`eventTypes` array the router filters on, typed event creators, the fold's
`apply` dispatcher, and the command names and input types. `schemas/constants.ts`,
the `z.infer` re-exports, `typeGuards.ts` and the hand-maintained
`EVENT_TYPE_IDENTIFIERS` / `AGGREGATE_TYPE_IDENTIFIERS` lists are all outputs of
this, not inputs to it.

### 3. Derived type strings are ratcheted, because events are persisted forever

This is the one place copying `createSlice` unmodified would be a data-loss bug.
A Redux action is ephemeral, so renaming a reducer key costs a re-render; an
event type string is written into `event_log` and read back for the whole
retention window, so renaming a map key orphans every row carrying the old
string. Nothing in the type system notices, because the union changed
consistently with itself.

So the derived strings are snapshotted into a committed file, and a test fails
when one *disappears*. Additions are free; a removal or a rename is a diff a
reviewer reads. This is not a new mechanism — it is the discipline
`assertGenerationRatchet` already applies to what a fold's decoder reads
(`generationRatchet.ts:20-42`, recorded at
`foldStore/__tests__/generationRatchet.unit.test.ts:24-33`), extended one layer
up to the declaration.

### 4. The projection version is a hash of the state schema

The version a fold stamps on its rows is derived from a normalised hash of the
state schema — keys sorted, types only, descriptions and comments excluded. It
is therefore impossible to change a fold's shape and not move its stamp, which
is the failure mode that lets a stale row decode into wrong state and the one
`provenBy` was invented to survive. The stamp is legal as a hash because ADR-099
never orders version strings: `FoldGeneration.stamp` is compared for equality
and positioned by its index in an append-only `generations` list
(`foldCodec.ts:12-22`), so nothing depends on the value looking like a date.

An explicit pin (`stateVersion: "3"`) overrides the *number* and does not
disable the check: the snapshot records the pin **and** the computed hash, so a
shape change underneath an unchanged pin fails. Every existing fold pins its
current stamp at cutover, without exception. Skipping that is not a cosmetic
miss — the day derived versions ship, every live row fails its version gate at
once, because no stored date can match a freshly computed hash.

### 5. Folds return new state — no Immer, no proxies

`createSlice`'s mutative-looking reducers are not copied. The convenience is
syntactic, and the cost is not: fold states here are large (`traceAnalytics`
and `codingAgentSession` are the working state of a whole trace or session), and
they sit on the hot delivery path where every event pays the proxy. Immutable
returns also keep the fold trivially testable as a pure function of
`(state, event)`, which is what ADR-098's order-invariance and fold-equivalence
tests assert against.

### 6. Composition is the declaration, not a factory

A projection mounts as `withFold(name, { store })` or `withMap(name, { store })`,
with the store built from its table definition (ADR-099). The store side of this
already landed — `coding-agent-processing/pipeline.ts:74-77` mounts
`codingAgentSessionFoldStore.cached({ repository, cache })` and nothing
assembles a read-back gate by hand. What remains is the ceremony around it: 14
per-pipeline `Deps` interfaces, 14 `*.store.ts` / `stores.ts` files, and a class
per projection restating a name and version the declaration already knows.

A repository still crosses the composition root as an injected dependency. That
is a genuine boundary and it survives. What goes is the per-pipeline interface
declaring it, the adapter class wrapping it, and the third mount point:
`withProjection` (`staticBuilder.ts:212-236`, 6 live call sites) is abolished
per ADR-098 — it is a `fold` with a `replace` store.

### 7. The declaration is curried, because one object literal cannot infer itself

The shape is `createSlice`'s, but it is built in steps rather than passed as a
single literal:

```ts
defineAggregate("coding_agent_session")
  .state(sessionState)
  .events({ … })
  .commands({ … })
  .build();
```

A single literal does not work, and the reason is inference ordering rather
than taste. `TState` is inferred from the `state` schema, and the `events`
handlers must be checked against it — in one call those are mutually
dependent, so the handler parameters resolve to `unknown` and every fold body
loses its types. Redux Toolkit met the same wall and moved its reducers behind
a builder callback for the same reason. Currying fixes it by ordering the
inference: each step is a separate call, so it already knows everything the
previous step established, and `.commands()` sees both the state type and the
generated event creators.

Three type constructs carry the derivation, and the constraint on all of them
is that they stay shallow:

- **`z.infer`** turns one payload schema into both the runtime validator and
  the payload type, so neither can drift from the other.
- **A template literal type** (`` `${Name}/${Key}` ``) makes the derived event
  type strings *types*, not merely runtime values, so `event.type` narrows and
  completes.
- **A mapped type indexed by its own keys** collapses the event map into a
  discriminated union. Building an object type keyed the same way and then
  indexing it by `keyof` is what produces a union rather than an intersection.

The fold's `apply` needs no narrowing at all, because each handler is declared
next to the payload schema it consumes. That, rather than the syntax, is why
this shape reads well: there is no switch, so there is no discriminant to
plumb.

Type-level cost is a real constraint here — a full typecheck of the
application is already expensive enough that engineers avoid running it. So
the rule is one mapped type per axis and no recursive conditional types: the
union above is linear in the number of events, whereas anything recursive over
string literals degrades quickly. If a specific aggregate ever does become
slow, the escape is a pinned explicit union, which the ratchet snapshot already
has the information to generate.

The package is consumed source-first — its `exports` resolve `types` and
`default` to `./src/index.ts` — so consumers typecheck the TypeScript itself
and inference behaves exactly as if the code were local. This matters because
deeply inferred generics routinely fail declaration emit with "the inferred
type cannot be named without a reference to…", which would otherwise force
every intermediate type to be exported to satisfy a build nothing consumes.

### 8. Four things stay explicit

Nothing can infer them, so nothing tries: the aggregate name and its type-string
prefix (two taxonomies are already in the log — `lw.experiment_run.started` and
`lw.obs.coding_agent_session.span_facts_contributed` — and neither is
derivable from the other), the id extractor, the store/table binding, and a
group-key scope that is not the default `aggregate` (ADR-100).

## Rationale / Trade-offs

**Why derive the string from the key, rather than keep authoring the string?**
Because the authored artefact should be the one a developer reads, and the
derivation already runs the other way (`eventTypeTransforms.ts:79-81`). Inverting
it removes three of the four declaration sites per event and makes disagreement
between them unrepresentable, rather than merely tested for.

**Why hash the state schema rather than require a bump and lint for it?** A lint
for "you changed the state and did not change the version" needs to know what
counts as a change to the state, which is the hash. Given the hash, the version
is free and the lint is redundant. The alternative that looks cheaper — keep the
hand-typed date and add a reviewer checklist — is what produced the three
version constants and 60 lines of archaeology on
`codingAgentSession.foldProjection.ts`.

**Why a committed snapshot rather than generating the strings into a file?**
A generated file drifts silently when generation is skipped, and reviewing it is
reviewing an output. The snapshot's whole job is to be small, greppable, and
diffed by a human at exactly the moment a persisted identifier would change.

**Why not derive the aggregate name from the directory?** It would make renaming
a folder a data migration. The name is a persisted identifier — it appears in
`event_log`, in group keys (ADR-100), and in every stored aggregate type — so it
is authored, once, in the declaration that owns it.

## Consequences

- Three of the four per-event declaration sites disappear, along with
  `typeGuards.ts` (259 lines, entirely derivable) and the `z.infer` alias files.
  Most of the 3,838 lines of `schemas/` is output, not source.
- A whole class of silent corruption is closed by construction: a fold's stamp
  cannot fail to move when its state shape moves, so `provenBy`
  (`foldCodec.ts:27-34`) can never again be needed for a fold declared this way.
  It stays for the rows that already exist.
- **Inference costs legibility, and this is the real loss.** A reader can no
  longer grep `"lw.obs.coding_agent_session.span_facts_contributed"` and land on
  its declaration. Two things mitigate it and neither restores it fully: the
  committed snapshot from item 3 is a plain greppable file containing every
  derived string, and the ratchet test names each string in its failure message.
  A developer looking for where an event is *defined* must know to look for the
  aggregate and the camelCase key.
- Type errors get worse before they get better. A mistake inside a declaration
  this dense surfaces as a failure in an inferred union rather than at the line
  that caused it — the same trade `createSlice` makes, and the reason item 5
  keeps the fold handlers ordinary functions with explicit parameter types.
- The cutover is version-gated and unforgiving in one direction: item 4's pins
  are load-bearing on the first deploy, not tidy-up afterwards.
- Two aggregate-type registries stop being hand-maintained
  (`typeIdentifiers.ts:74-90` and `:122-138`), so a new aggregate can no longer
  be mounted and then rejected at registration for missing its own identifier.

## In force now

Every aggregate added from this decision onwards:

- is declared in one `defineAggregate` call; no `schemas/constants.ts`, no
  `typeGuards.ts`, no `z.infer` alias file, no per-pipeline `Deps` interface.
- takes its derived event type strings into the committed snapshot in the same
  commit that adds them.
- takes its state version from the schema hash, or pins it with a recorded hash
  alongside.
- mounts as `withFold` / `withMap` only. `withProjection` accepts no new
  registrations.

## Known debt this does not fix yet

The 13 existing pipelines are not rewritten here. What remains: 11 `schemas/`
directories in the old shape (12 with the ee pipeline), 10 version-constant
declaration sites in two conventions, 14 `Deps` interfaces, 14 store-adapter
files, and 6 `withProjection` mounts.

Convert in this order, and for these reasons:

1. **The 6 `withProjection` mounts** (langy-conversation, topic-clustering, the
   ee ingestion-pull pipeline). They are the only remaining consumers of a mount
   point ADR-098 abolishes, so nothing else can be simplified while a third
   contract exists. Smallest blast radius, unblocks the most.
2. **The 4 folds carrying bespoke version bookkeeping** —
   `codingAgentSession`, `traceAnalytics`, `traceSummary`,
   `evaluationAnalytics`. They hold the multi-constant ladders and the decodable
   sets, which is the debt that is actively costing correctness rather than
   lines. Each converts to a pin plus a recorded hash.
3. **The 11 `schemas/` directories**, largest first (trace-processing at 1,134
   lines, then simulation at 649, evaluation at 430). Mechanical once 1 and 2
   are done, and the line count recovered is concentrated here.
4. **The 14 `Deps` interfaces and store-adapter files**, last. They are the
   least harmful — ceremony, not risk — and converting them earlier would mean
   touching every pipeline file twice.

Ordering rationale in one line: retire the extra mount point first because it
blocks everything, then the folds where forgetting a version already caused
damage, then the bulk, then the cosmetics.

## References

- `langwatch/src/server/event-sourcing/pipelines/experiment-run-processing/schemas/constants.ts:10`,
  `:20`, `:27` and `schemas/events.ts:22-39` — the four declaration sites and
  the 9-to-7 ceremony ratio for one event.
- `langwatch/src/server/event-sourcing/schemas/typeIdentifiers.ts:74-90`,
  `:122-138` — the hand-maintained platform-wide event and aggregate registries.
- `langwatch/src/server/event-sourcing/projections/eventTypeTransforms.ts:33-36`,
  `:79-81` and `projections/abstractFoldProjection.ts:52-64` — the derivation
  that exists today, running from string to name.
- `langwatch/src/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSession.foldProjection.ts:80`,
  `:83-90`, `:104`, `:122` — a shape change that shipped without a version bump,
  and the three constants it cost.
- `langwatch/src/server/event-sourcing/projections/foldStore/foldCodec.ts:12-50`
  — the generation ladder, and `provenBy`'s admission that a store owning its own
  stamp cannot reach this state.
- `langwatch/src/server/event-sourcing/projections/foldStore/generationRatchet.ts:20-42`
  and `foldStore/__tests__/generationRatchet.unit.test.ts:24-33` — the ratchet
  precedent item 3 extends.
- `langwatch/src/server/event-sourcing/pipeline/staticBuilder.ts:212-236` — the
  `withProjection` mount point this ADR stops accepting registrations for.
- `langwatch/src/server/event-sourcing/pipelines/coding-agent-processing/pipeline.ts:64-98`
  — the composition shape items 6 and 7 reduce, and the `defineFoldStore` mount
  that already reached its target form.
- `specs/event-sourcing/pipeline-model.feature`,
  `specs/event-sourcing/fold-projection.feature`,
  `specs/event-sourcing/fold-store-library.feature` — the behaviour a converted
  declaration must continue to satisfy, except the scenarios ADR-098 and
  ADR-101 supersede (marked `@unimplemented` in those two files: FIFO
  ordering and inline rebuild-from-history in `fold-projection.feature`;
  rebuild-on-refusal in `fold-store-library.feature`). For those, a converted
  declaration must satisfy ADR-098 and ADR-101 instead.
