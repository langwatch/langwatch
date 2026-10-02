---
name: repo-tree
description: "Where a thing lives in the LangWatch tree and what each top-level folder is for. Use when someone says 'where does this go', 'which package', 'new package', 'is this a module or a package', 'apps vs modules vs packages vs services vs tools', 'what is a generated module list', 'catalogue.json', 'generate:modules', 'which app runs this', or opens a folder and cannot tell what it owns. Teaches the map and the placement test; the record is dev/docs/ARCHITECTURE.md sections 1 to 3."
user-invocable: true
---

# The repository tree

One pnpm workspace (TypeScript), Go services and Python services beside it.
The rule that names every package: **where the code runs, or what it declares**
(ARCHITECTURE.md §2). The tree is the contract; when this skill and the linter
disagree, the linter wins (§17).

## The map

| Folder | Holds | Rule |
| --- | --- | --- |
| `apps/` | `api`, `worker`, `tasks`, `ui`, `server` (npx CLI), `scenario-child`, plus the `*-web` internal consoles | An app is `src/main.ts` and `src/config.ts`. No product code (§1). |
| `modules/<name>/` | One feature: `contract/ process/ browser/ client/`, plus `specs/` and `adrs/` | A module is an isolated microservice (§3). |
| `enterprise/modules/<name>/` | The same shape, licence-gated at runtime | Always installed; refuses per organisation (§3, §11). |
| `packages/` | Framework only | A package earns its place by being framework, not feature (§2). |
| `services/` | Go (`aigateway`, `nlpgo`, `langyagent`, the `*sim`s), Python (`langevals`) | Not in the Node module system. |
| `tools/` | Dev tooling: `thuishaven` (haven), `dev-runtime`, `apidiff`, `visualdiff` | Not shipped. |
| `specs/` | Cross-cutting Gherkin feature files | Module specs live in `modules/<name>/specs/`. |
| `sdks/`, `mcp/`, `docs/` | Published SDKs, the MCP server, the public docs site | Not the product. |
| `dev/` | Architecture record, ADRs, best practices, dev scripts | `dev/docs/ARCHITECTURE.md` is the one record. |

## Rules that matter

1. **Apps hold no product code.** `apps/api/src/main.ts` boots a server and
   serves the installed modules. If you are writing behaviour in an app, it
   belongs in a module.
2. **Feature code in `packages/` is a defect.** If the code names a product
   subject (trace, monitor, invite), it is a module.
3. **One subject, one owning module.** `modules/catalogue.json` maps every
   subject to exactly one module. Another module reaches the subject through the
   owner's `*Api` and contract only (§3).
4. **The prefix tells you the graph.** Nothing `browser-*` in a server graph;
   no `process*` package in a web graph (§2). A contract imports no framework
   beyond `@langwatch/module`.
5. **Generated lists are never edited.** The module list each app carries
   (process halves in `apps/{api,worker,tasks}/src/process-modules.generated.ts`; browser halves in `apps/ui/src/browser-modules.generated.ts`) is written by
   `pnpm generate:modules` from the catalogue. Add a module by editing
   `modules/catalogue.json`, then run the generator.
6. **Shared browser code has three homes, no kits.** Component: the design
   system. Pure domain logic: the owner's contract. Data: the owner's
   `<name>-client` (§3.4). A `*-browser-kit` package is a deleted spelling.
7. **A package named by a module has four suffixes:** `@langwatch/<f>-contract`,
   `-process`, `-browser`, `-client`. Enterprise ones carry `enterprise-` in the
   name (`@langwatch/enterprise-billing-process`).
8. **A portable library both halves import** sits inside the owning module
   (`modules/analytics/filters` exists; the record also names
   `modules/trace/query-language`, not in the tree yet), never in
   `packages/` (§2).

## Placement test

Ask in order. Stop at the first yes.

| Question | Goes to |
| --- | --- |
| Does it name a product subject? | The module the catalogue gives that subject. |
| Does a screen render it? | `modules/<f>/browser/` (layers in the `browser-module` skill). |
| Is it a component several modules share? | `packages/design-system` (§2). |
| Is it data several browsers read? | The owner's `modules/<f>/client/`. |
| Is it a schema, error or `*Api` another module calls? | The owner's `contract/`. |
| Does it start a process, parse config or open stores? | A framework package (`process`, `process-stores`, `config`). |
| Is it a one-shot migration or backfill? | The module's `process/src/migrations/` or `tasks/`, run by `apps/tasks`. |
| Is it Go or Python? | `services/<name>`. |
| Is it dev-only tooling? | `tools/<name>`. |

If no row fits, that is a design question. Do not invent a folder: ask.

## Worked example: `modules/monitor`

The smallest full module. Read it before inventing a layout.

```
modules/monitor/
├── adrs/  specs/
├── contract/src/    monitor.api.ts  monitor.errors.ts  monitor.trpc.ts  index.ts
├── process/src/     monitor.module.ts  index.ts  app/  services/  repositories/
│                    rules/  transport/
└── browser/src/     monitor.web.ts  model/  behavior/  ui/{elements,blocks,sections}
```

Its catalogue entry is one line of data: `id: "monitor"`, `root: "modules/monitor"`,
`classification: "core"`, `subjects: ["monitor"]`. `modules/organization` owns
seven subjects (`group`, `invite`, `membership`, `organization`, `team`, ...), so
one module may own several subjects. `modules/automation` adds `eventing/`,
`channels/` and `migrations/` to `process/src/`; add a folder only when the
module has that kind of thing.

## Traps

- **Reading `dist/` or `*.generated.ts` as source.** Both are outputs. Fix the
  catalogue or the source, regenerate.
- **A new folder under a module root.** The root holds the four halves, `specs/`
  and `adrs/` only. The folder grammar is
  `packages/oxlint-rules/grammar/feature-layout-policy.mjs`; the linter refuses
  a stray folder (see the `linting` skill).
- **A folder that keeps growing.** Past the `source-folder-shape` budget it is
  grouped into `features/<concern>/`, one level only (§3.4). The number is the
  policy's (`FOLDER_BUDGET` in its source), not this skill's.
- **A second `config.ts` or a dev-only branch in an app.** The same `main.ts`
  runs on a laptop, in CI and in production; only the parsed environment differs.
- **Putting a table or a query in a module that does not own the subject.**
  Owning a table means owning every query against it.
- **A `utils/`, `lib/`, `helpers/`, `domain/` folder.** Deleted spellings.
  Pure decisions go in `rules/`; behaviour in `services/`.
- **Naming a package `*-web`.** Today that means an internal console under
  `apps/*-web`; module browser halves are `*-browser`.

## Links

- `dev/docs/ARCHITECTURE.md` §1 (the product), §2 (package family), §3 (a module),
  §3.4 (browser half, no kits), §16 (names in flight), §18 (Nx runs the tasks).
- The module skills: `module` for anatomy, `module-client` for clients,
  `browser-module` for the browser half.
- Process composition and what a module may demand (peers, config, stores,
  entitlements): the future `module-dependencies` and `process-composition`
  skills. Not taught here.
