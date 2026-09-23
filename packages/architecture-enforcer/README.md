# @langwatch/architecture-enforcer

Executable package-boundary policies for the LangWatch monorepo. `pnpm lint:architecture`
(or `pnpm --filter @langwatch/architecture-enforcer lint`) checks the workspace; the
report is described in `specs/lint-report.feature`. It is not part of `pnpm lint` while
the tree still carries findings; CI runs it over the policies already at zero
(`--policies`, the list in `.github/workflows/langwatch-app-ci.yml`), and a policy joins
that list when its findings reach zero.

## The policy registry

Every policy is one `definePolicy({ id, spec, run(snapshot) })` entry in
`src/policies/index.ts`. `lintSnapshot` and the CLI fold that registry and nothing
else, so a library caller of `lintWorkspace()`/`lintSnapshot()` and the CLI run the
same set of policies. `--list-policies` prints the registry: each id and the spec its
scenarios live in. `--policies a,b` runs only the named ids, and an unknown id is a
usage error.

Every finding is reported: there are no baselines. A policy that reads a fixed file
of the workspace (the Prisma schema, the ClickHouse migrations, the generated server
module list, the declaration solution, the process entrypoints) throws a
`MissingAnchorError` naming itself and the file when it is gone, and the CLI exits 2,
so a missing input never reads as a clean tree.

Source lives under `src/policies/`, one file per policy or per small family
sharing one concept (`frontend/browser-packages.ts`), still one registered
entry per function. Shared tree-reading lives in `src/workspace/` (the snapshot,
the module graph, the repository layout, the anchors); the two tools that are
not policies (`check-feature-parity.ts`, `sync-tsconfig-references.mjs`) live in
`src/tools/`.

`--no-declarations` (library: `declarations: false`) drops the `declarations`
entry before running: it reads the `.d.ts` files `tsc -b` wrote, so it needs a
build and is skipped rather than computed and discarded.

## The dead-code guards

Two policies read the whole tree at once to find code that has quietly
stopped being read. Each answers a question no per-file rule can:

| policy                 | fires on                                                                                                       | why a per-file rule cannot see it                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `unused-module-export` | a name a module's `process` package exports that no file in the repository imports, the package index included | the answer is the whole import graph; the declaring file looks perfectly well formed |
| `memory-twin-drift`    | a repository whose Prisma implementation and memory twin declare different method sets, in either direction    | the two classes are in different folders and only their difference is the defect     |

`unused-module-export` is the guard that would have caught the nine adapter
files a codemod orphaned in one week: it moved each file, left the old copy
behind, and every check the repository owns stayed green. It is deliberately
NOT `composed-exports`, which asks whether a name the package PUBLISHES is
constructed by a process; a name that never reached the index is invisible to
that one, and a name that did belongs to it rather than here. Barrels, test
files, testing entries and a configuration module's default export are out of
scope; a namespace import, a `export * from` and a dynamic `import()` each name
the module without naming a member, so each marks the whole target read.

`memory-twin-drift` is the sharper half of `feature-shape`'s
`postgres-without-memory`, which only asserts a twin exists. It pairs the two
classes by subject - the class name with the word `Prisma` or `Memory` taken
out, whichever end it sits at, plus every interface the class implements - and
reports each method one side declares and the other does not against the side
that is short.
