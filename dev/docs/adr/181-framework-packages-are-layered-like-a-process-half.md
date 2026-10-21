# ADR-181: Framework packages are layered like a process half

**Date:** 2026-10-19

**Status:** Proposed

## Context

`packages/eventing` (144 source files, 31.6k lines) and `packages/group-queue` (31 files, 11.5k
lines) carry the platform's event log, projections, process managers and job queue. They grew in
plain folders, which the record allowed: "A framework package groups its files into plain folders
behind unchanged `package.json` export subpaths" (record §3.4). The cost is now visible:

- Seven files over 1,000 lines: `groupQueue.ts` (3,394), `scripts.ts` (3,085),
  `projectionRouter.ts` (2,398), `eventSourcing.ts` (1,274), `foldProjectionExecutor.ts` (1,186),
  `queueManager.ts` (1,116) and `replayEngine.ts` (1,094).
- Redis is reached through free functions (`replay/replayMarkers.ts`, `replay/replayDrain.ts`), so
  owned state and unowned messages are not told apart.
- Eventing holds the folder names a module may not have (`utils/`, `domain/`, `server/adapters/`).
- The lint is blind to both. `classify.mjs` gives them the `framework` role with no strict source,
  so the layout, layer, class-shape and store-containment rules and the `service-ceilings` policy
  skip them; `group-queue/src` sits at exactly the 30-file folder budget.

Modules already have the shape that fixes this (record §3.2, §3.4): concern folders of small
services over repository and channel interfaces, pure rules, and tier folders with memory twins.

## Decision

1. **A framework package nests like a process half.** Its `src/` holds `features/<concern>/`
   folders (one level, at most 30 source files each) of `services/`, `repositories/`, `channels/`,
   `rules/`, `eventing/` and `vocabulary/`. What every concern shares stays at the top in
   `vocabulary/`, `rules/`, `repositories/`, `channels/` and `telemetry/`. Its public runtime
   classes live in `app/<name>.app.ts`, and `tasks/<name>.task.ts` is unchanged. Unlike a module,
   a concern may nest its own channels.
2. **What each layer means in a framework.**
   - _Repository_: state the package owns. Group-queue owns its whole Redis keyspace, blob leases
     and blob bytes included; eventing owns `event_log`, the projection checkpoints, the
     process-manager tables, the fold cache and the replay markers. One repository method is one
     `CachedLuaScript.run` or one pipeline; a service never sequences what used to be one script.
   - _Channel_: messages to what the package does not own (eventing's group-queue transport, its
     reads of group-queue activity keys, the read-hint broadcast).
   - _Rules_: pure functions and constants; no clock, no I/O, no classes.
   - _Vocabulary_: the framework's own contract and the leaf layer: public types, `define*`
     factories and builders, abstract bases, zod schemas and error classes. It takes vocabulary,
     rules and telemetry; every layer may take it.
   - _Telemetry_: OTel instruments, module-level singletons in `telemetry/<name>.metrics.ts`,
     importable from every layer, as a logger is. They are observability, not a channel
     (`modules/automation/process/src/features/runaway/services/automation-runaway-metrics-otel.service.ts`).
   - _App_: the composition roots, the only files that construct tier implementations.
3. **The public surface is frozen.** The `exports` keys, the entry file paths, public names and
   signatures do not change. Entry files hold `export ... from` lines only. No symbol is renamed and
   no stub stays at an old path: re-exports for backwards compatibility are deleted (§15), and
   `no-alias-reexport` refuses `export { X as Y }`. Internal code never imports its own entry.
4. **Construction.** An internal class is built through `static create({ ... })` behind a private
   constructor, its collaborators `private readonly` and handed as interfaces
   (`modules/automation/process/src/repositories/redis/redis.automation-email-cap.repository.ts`).
   A class an entry publishes keeps its constructor exactly. Today's positional public
   constructors (`new GroupQueueProcessor(def, redis, opts)`, `new GroupStagingScripts(...)`)
   deviate from §3.2's one-options-object rule; changing them is an API change and out of scope.
5. **Memory twins.** The existing twins stay (`EventRepositoryMemory`, `InMemoryProcessStore`,
   `EventStoreMemory`, `MemoryQueueDrainAudit`, `EventSourcedQueueProcessorMemory`) and a new simple
   repository gets one. The Lua keyspace repositories are exempt from §13's twin rule: a twin would
   re-implement about 3k lines of Lua semantics and then be what the tests test. The Redis
   integration suites are their proof (Alex, 2026-10-19).
6. **Lua stays plain strings composed with `+`**, in `repositories/redis/redis.<name>.script.ts`
   beside the repository that runs it. Every script stays byte-identical, pinned by a fingerprint
   test; ops composes the exported helpers into its own scripts, so they are a wire.
7. **The opt-in is per package**, `"langwatch": { "layout": "features" }` in the package's own
   `package.json`, beside the `group` key it already carries. A package opts in in the change that
   moves it, so no shared list is edited and a half-moved package is never linted as finished.
8. **The root and server tiers stay apart.** The root entry's import graph never reaches
   `repositories/{prisma,clickhouse}/**`; the `./server` subpath is what keeps Prisma and ClickHouse
   out of it, and a boundary test walks the graph from `index.ts`.
9. **The characterization harness stays pinned.** group-queue's
   `processClaimedJob.characterization.unit.test.ts` spies on `GroupStagingScripts.prototype`,
   which §13 forbids for new tests. It is the strongest behaviour net for the move, so it stays
   unchanged until the processor carve-up ends, then retires (Alex, 2026-10-19).
10. **ADR-070 is amended on Prisma.** It says eventing has no Prisma imports, but
    `src/server/adapters/postgres/*` already imports it. The rule it means is decision 8.

## Rationale / Trade-offs

The module grammar is already enforced, taught and reviewed; giving frameworks the same grammar
costs a role in the classifier and a few patterns, not a second vocabulary. Splitting the two
packages into more packages was rejected: it adds manifests and edges and changes the public API
that about 1,100 importing files depend on. Keeping plain folders was rejected because the lint
cannot hold a shape it cannot see, and the oversized files grew under exactly that blindness.

The frozen surface is the price of moving 400-odd files without touching their importers. It keeps
some names that read oddly in their new folders (`GroupStagingScripts`, `TieredBlobStore`) and the
positional constructors, and it means `GroupStagingScripts` stays one class: splitting it would be
an API change or a pass-through facade. Both are accepted as the cheaper error.

The Lua exemption trades the twin rule's speed for fidelity: a hand-written Redis twin would pass
tests the real scripts fail. The integration suites run against Redis in CI.

## Consequences

- The lint covers opted-in frameworks: `packages/oxlint-rules/src/classify.mjs` gives their files a
  strict source and a layer, the grammar's `FRAMEWORK_PATTERNS` are their homes, the layer tables
  gain `vocabulary` and `telemetry` rows, and `service-ceilings` (500 lines a file, 80 a method)
  measures their services. No package opts in with the grammar, so it changes no finding.
- Each rule that gates on the `process` role takes the framework role in its own change:
  `feature-source-layout`, `module-layers`, `namespace-class`, `module-classes`,
  `store-containment` and `service-does-not-open-a-channel`. `feature-source-filename` already
  reads any strict source.
- About 400 file moves and about 265 test files moving with their code. The move commits go in a
  new `.git-blame-ignore-revs`; doc and skill paths follow.
- ADR-130's procedure-graph ceiling is protected separately: the ops contract stops pulling eventing
  into the router type's graph.

## References

- Record: `dev/docs/ARCHITECTURE.md` §3.2 (layers, banned folders), §3.4 (nesting), §13 (twins,
  spies), §15 (compatibility re-exports), §17 (the framework role).
- Related ADRs: [ADR-070](070-modular-package-architecture.md) (amended),
  [ADR-130](130-the-api-router-type-is-declared.md) (router type ceiling).
- Ruling: Alex, 2026-10-19 (adopt the layering with the per-package opt-in; the Lua twin exemption;
  the pinned harness; the `vocabulary/` and `telemetry/` folder names).
