# Flattening the contract dependency graph

**Status:** started 2026-09-17. Three edges done, 49 remain. Chain depth **16 -> 13**, average 6.7 -> 6.2.

## The finding

`pnpm build:types` and `pnpm typecheck` both walk the same project-reference
graph, and that graph is a **chain, not a fan**. The 45 module contracts had a
maximum dependency depth of **16** (average 6.7). `tsc -b` cannot start a
project until its references have emitted declarations, so those levels are
strictly sequential no matter how many cores are available.

That is why `--builders` barely moved the needle: 4 builders took 18.9s cold,
32 builders 14.5s. Adding builders cannot shorten a chain. The build is already
at its floor for the current graph — roughly 17 sequential compiles at ~0.25s
each. **The only remaining lever is the graph itself.**

## The rule we are working toward

A contract may not import another feature's contract. `package-boundaries`
already enforces transport-neutrality, cross-feature server/web bans and
composition-roots-only imports; this is one more message on that rule. It
cannot ship at `error` until the count is zero, and there are no baselines.

## Treatment, by kind

Not every edge gets the same fix.

- **Small shared types and enums — duplicate.** Two contracts naming the same
  four strings are two bounded contexts that agree, not a DRY violation.
  `ContentCategory` was done this way: four literals, declared locally in
  `trace/contract`.
- **Genuinely universal vocabulary — `@langwatch/kernel`.** All 45 contracts
  already depend on it and it depends only on `zod`, so it adds no depth: a fan
  at depth 0, not another link in the chain. `KSUID_RESOURCES` moved there.
- **Cross-aggregate references — reference by id.** A contract embedding another
  aggregate's whole schema (`traceSchema`) should hold `traceId` instead. Agreed
  direction for `annotation -> trace`; copying the shape is the interim step.
- **Logic — move it out of the contract entirely.** `mapReasoningToProvider` is
  a function living in `prompt/contract`. Vocabulary packages hold vocabulary.

## The trap

Removing the import does **not** shorten the chain. The tsconfig `references`
are generated from **package.json dependencies** (`pnpm sync:references`), so
the dependency entry must go too. Deleting an import and leaving the dependency
looks like progress and changes nothing.

Also: `import type` still creates a build dependency. Declarations are needed to
type-check even though the import is erased at runtime. Of the 116 original
import sites, 45 were type-only and they serialised the build exactly as much
as the value ones.

## Critical path

The longest chain ran experiment -> scenario -> workflow -> prompt -> dataset ->
annotation -> trace -> data-privacy, then into `packages/{eventing,prisma-client,api,handled-error,config,plans}`.
Eight contract levels held together by **nine import sites**.

Done: `trace -> data-privacy` (ContentCategory duplicated, dependency dropped),
`KSUID_RESOURCES` moved to kernel, `workflow -> prompt` (reasoning mapper moved to
kernel with its tests, dependency dropped). Depth **16 -> 13**, average 6.7 -> 6.2.
Remaining on the path: `experiment -> scenario` (`ScenarioParameterDefinition`),
`scenario -> workflow` (`ComponentType`, `Field`), `workflow -> prompt`
(`mapReasoningToProvider`), `prompt -> dataset` (`datasetColumnTypeSchema`),
`dataset -> annotation` (`annotationSuggestedOutput` and a function),
`annotation -> trace` (`traceSchema`).

## All remaining edges

| contract | edges | depends on |
| --- | --- | --- |
| `scenario` | 8 | `agent`, `automation`, `evaluator`, `feature-flag`, `model-provider`, `trace`, `user`, `workflow` |
| `experiment` | 6 | `authz`, `dataset`, `evaluator`, `model-provider`, `scenario`, `workflow` |
| `workflow` | 5 | `agent`, `authz`, `dataset`, `evaluator`, `prompt` |
| `suite` | 3 | `evaluator`, `model-provider`, `scenario` |
| `annotation` | 2 | `trace`, `user` |
| `api-key` | 2 | `authz`, `project` |
| `dashboard` | 2 | `analytics`, `automation` |
| `dataset` | 2 | `annotation`, `trace` |
| `evaluation` | 2 | `evaluator`, `experiment` |
| `monitor` | 2 | `evaluation`, `evaluator` |
| `ops` | 2 | `feature-flag`, `project` |
| `organization` | 2 | `authz`, `project` |
| `trace` | 2 | `analytics`, `evaluation` |
| `auth` | 1 | `identity` |
| `automation` | 1 | `monitor` |
| `coding-agent` | 1 | `trace` |
| `evaluator` | 1 | `analytics` |
| `langy` | 1 | `authz` |
| `prompt` | 1 | `dataset` |
| `role` | 1 | `authz` |
| `share` | 1 | `data-retention` |
| `stored-object` | 1 | `authz` |
| `user` | 1 | `organization` |

## Measuring

```bash
pnpm sync:references                      # regenerate references from package.json
pnpm run build:types                      # one tsc -b over the contract solution
```

Depth is computed by walking `tsconfig.build.json`'s references transitively;
the critical path is the longest such chain.

## Done when

Every contract -> contract edge is gone, the ban ships on `package-boundaries`
at `error` with zero findings, and the contract layer is one level deep.
