---
name: feature-audit
description: "Audit one LangWatch feature package (or a directory, a diff or a branch) against the annotation shape and its guards and report with file:line evidence: what the feature still carries from the older shape (the feature-shape inventory), folder grammar and filenames, the app's public surface versus its API, repository interfaces with both backends, prisma containment and the typed seam, projectId and TenantId scoping, private runtime exports, transport rules, web layer direction and closed entries, spec parity and @scenario binding, boot-time provision versus refusing stubs, and the frontend boundary. Runs the mechanical detectors (architecture-lint, oxlint, check-feature-parity, package tests and typecheck) first, then reads what they cannot see. Use whenever someone says 'audit', 'review this feature', 'review the changed files', 'is this feature clean', 'does <package> follow the layout', 'why does lint fail here', 'what is left to convert in <feature>', or before opening a PR that touches a feature package."
user-invocable: true
argument-hint: "<feature name, package path, or diff target>"
---

# Audit a feature

Read `.claude/skills/architecture-guide/SKILL.md` and `references/testing.md`. The
audit is evidence first: every finding names a file and line and the rule or scenario
it breaks. No finding without a path. The reference the feature is measured against is
`packages/features/annotation`.

Auditing a change rather than a package? Diff against `origin/main`, or the PR base if on
a PR branch, and apply sections 2 to 6 to the touched files only.

## 1. Mechanical pass

```bash
F=<feature>; P=packages/features/$F
find $P -maxdepth 4 -type d | grep -v node_modules | grep -v __tests__
grep -n "\"$F\"" packages/architecture-lint/src/feature-shape-baseline.json      # what it still carries
pnpm --filter @langwatch/architecture-lint lint 2>&1 | grep -E "$P|apps/(api|worker|ui)/src/features/$F" > /tmp/audit-lint.txt; wc -l < /tmp/audit-lint.txt
pnpm exec oxlint --config .oxlintrc.architecture.json $P
pnpm --filter @langwatch/architecture-lint check:feature-parity 2>&1 | grep -A6 "$P/specs"
for pkg in contract server web; do pnpm --filter @langwatch/$F-$pkg typecheck; done
for pkg in contract server web; do pnpm --filter @langwatch/$F-$pkg test 2>&1 | grep -E "Tests |Test Files"; done
pnpm --filter @langwatch/architecture-lint test:unit tests/frontend-boundary.unit.test.ts 2>&1 | grep -E "Tests |$P"
```

Group the lint lines by rule name and count. A hard violation is an entry followed by an
`  allowed:` line. Note which are in a `*-baseline.json` (pre-existing, tolerated) and
which are new. The `feature-shape` entries are the conversion debt: list each kind and
what replaces it (the table in `.claude/skills/feature-convert/SKILL.md` maps every kind
to its annotation counterpart; converting is that skill's job, the audit only names the
gaps). Read the parity banner (`✗ THIS RUN FAILS: …`), not a per-file `✓`.

## 2. Shape, grammar, naming and data scoping (server)

Walk `server/src` against `references/server.md`:

- **The installer**: `<f>.server.ts` is `defineFeature("<f>")` with `.withRepositories`
  (when it persists), `.withApp`, `.withTransports`. `index.ts` exports it and the transport
  declarations only; a service, app, repository, store or projection export is a finding.
- **The app**: `app/<f>.app.ts` implements `<F>Api`, has `static contract`,
  `static dependencies`, a private constructor and `static create(setup: FeatureSetup<…>)`;
  every public member is an API operation; services and peers are `#private`. A public
  field, a getter, a second construction path (`fromService`, a dependency bag), an
  imported foreign service or repository is a finding. Peer enrichment and authorization
  that sit in a service or a transport instead belong here.
- **Services**: one class per entity over its repository interface; `static create({ repository })`;
  input parsed with the contract schema. A service taking a peer API, another service or
  a Prisma client is a finding.
- **Repositories**: an interface per entity; a `<f>.repositories.ts` bundle; a registry
  `defineRepositories({ postgres, memory })`; every Prisma repository with a memory twin of
  the same behaviour. `PrismaClient` named outside `repositories/prisma/**`, any
  `as PrismaClient`, `database: object`, a repository exported from `index.ts`.
- **`projectId` in every Prisma where clause** on a project-scoped model — `findMany`,
  `findFirst`, `findUnique`, `update`, `delete`. The tenancy guard is
  `platformScopeActions`, not a model allow-list: check what the guard actually covers
  before excusing a query.
- **`TenantId` as the first predicate of every ClickHouse query**, plus the partition
  key column in the WHERE when a date range exists, and no `LIMIT 1 BY` on heavy columns.
- **Transports**: tRPC declared once in the contract's `<f>.trpc.ts` (`defineTrpcContract`)
  and bound in `transport/<f>.trpc.ts` with `defineTrpcRouter(<F>Api, <f>Trpc)`; REST in
  `transport/<f>.rest.ts` via `defineRestRouter`; input and output schemas on every
  procedure and route; a permission or a declared alternative on every one; handlers
  calling exactly one app operation; no `TContext`/`TRoot`/mount type in the feature. Importing a repository,
  constructing a service, reading `process.env` or a header, returning a `Response`,
  domain logic in a mapping helper.
- Legacy pieces (`contract/src/<f>.service.ts`, `adapters/postgres.*`, `fixtures/`,
  `testing.ts`, `transport/<surface>/`, `ports/` used for a peer feature, a missing
  `<f>.server.ts` or `app/<f>.app.ts`, an installer no process boots, a `refusing*`
  twin in `apps/api/src/features/<f>/`, web `screens/`/`surfaces/` folders): each is a
  finding with its replacement, cross-checked against the `feature-shape` baseline.
- Folders outside the grammar (`utils`, `lib`, `helpers`, `domain`, `composition`,
  `types`): say where each file belongs. Filenames: dot between qualifier and subject,
  hyphen inside names; a `.service.ts` exporting no class of that name; a runtime class
  without `static create`; a `rules/` module that reads a clock or an I/O boundary.
- No `uuid`, `nanoid` or `crypto.randomUUID` for identifiers: `@langwatch/ksuid`.
- SQL migrations: no foreign keys, no schema prefixes (`"langwatch_db".`), no down
  migration in a ClickHouse file.
- Methods named `try*`/`require*`, result objects `{ ok, error }` instead of throwing,
  repository methods named `list`/`get`.

## 3. Contract

- `<f>.api.ts` with one interface of callable operations and its `featureApi` token,
  exported from the root; a service-valued member, getter or lookup method on it.
- Server artifacts in contract source; an abstract service; framework imports;
  `@langwatch/runtime-composition` imported from anywhere but `/contract`.
- Zod schemas duplicated as hand-written types; `.strict()` on a schema fed by producers
  outside the package; `unknown` fields that drop or widen data; `z.date()` replaced by
  strings inside a contract.
- Error classes: stable code present in `packages/handled-error/src/app-codes.ts` and
  `packages/handled-error/src/presentation.ts`; message naming an env var, host or
  internal service; missing explicit `fault`; a peer's error wrapped instead of propagated.

## 4. Web

- Files outside `model, behavior, ui/{elements,blocks,sections}` and the flat entry files.
- Layer direction: an element or block importing behavior; behavior importing ui.
- `package.json` exports not declared in `apps/ui/src/features/catalogue.json`; an entry
  whose closure reaches outside the package.
- An api-map naming `AppRouter` (ADR-130), or a slot typed `any`; a namespace spelled
  differently from `app-trpc.features.ts`.
- A screen reading session, project or router directly instead of a `*HostPort`; a
  `pathname` on the host port instead of a view prop.
- Hooks returning JSX; `form.watch()` in a child; a drawer mounted with `useState`; a
  toast of `error.message`; abbreviations or internals in copy.
- Component tests named `.unit.test` while rendering.
- Single responsibility: one primary export per file, no HTTP mixed with business logic
  or fetching mixed with rendering. Flag functions over ~100 lines.

## 5. Composition and wiring

```bash
grep -rn "@langwatch/$F-server" apps/api/src apps/worker/src apps/tasks/src | grep -v __tests__
grep -rn "$F" apps/api/src/app-trpc/app-trpc.features.ts apps/ui/src/features/installed-ui-features.ts apps/ui/src/features/catalogue.json
```

- The installer booted through `createApp(...).withFeature(<f>Server)` with every declared
  token provided; an app constructed by hand, a service passed around instead of the token.
- A `refusing*` / `Unavailable*` / `Logged*Absence` added for new work, or an optional
  collaborator nobody passes (inert leg).
- Config read via `process.env` inside the feature; a post-parse `assert*Config` instead
  of `Config.group`.
- The API appending events or running process managers (must be producer-only).
- UI: a `WebInstallation` (or `uiFeature`) in `apps/ui/src/features/<root>/index.ts`,
  routes wrapped by `uiPage` (host, guard, screen), page keys pinned in the install test,
  `feature-map.json` current.

## 6. Specs and tests

- Scenarios untagged, or tagged but unbound; annotations naming a scenario that no
  longer exists; `.feature` files added to `LEGACY_INERT` or `LEGACY_UNBOUND`.
- Tests that assert a constant back at itself, tests with no assertion, `should` in
  names, describes without `given`/`when`, message-prose assertions.
- The app tested over memory repositories with `createApiFixture` peers; an installation
  test booting every role the installer serves; both backends covered by the same
  behaviours.
- A regression test that checks a string instead of executing the path.
- A change that adds or edits a skill under `skills/` or an MCP tool under
  `mcp/typescript/src/tools/` with no matching scenario in
  `specs/skills/skills-testing.feature`.
- Re-exports added for backwards compatibility anywhere: never allowed, update the
  importers.

## 7. Classify and report

For each finding: **file:line**, the rule or scenario, a one-line target shape.
Classify every gap as one of:

- **LEGACY**: a piece of the older shape the `feature-shape` baseline already lists;
  name its replacement (the conversion is its own job).
- **STALE**: a named absence or comment whose claim the code contradicts; delete it.
- **DELIBERATE**: an absence the root names on purpose; leave it, cite the log line.
- **REAL GAP**: behaviour missing or a rule broken outside the inventory; say which skill
  fixes it (`feature-extend`, `feature-wire`, `feature-move`, `api-rest-route`,
  `api-trpc-procedure`, `spec-bind`).

Report structure, always:

```
# <feature> audit
## Mechanical: lint <n> (new <n>, baselined <n>) · feature-shape <kinds left> · parity <bound>/<total> · tsc <errors> · tests <pass>/<total>
## Findings (most severe first)
- file:line · rule · what · target shape
## Absences: LEGACY / STALE / DELIBERATE / REAL GAP
## Recommended order of fixes
```

Do not fix anything unless asked; the audit is the deliverable. Never run the root
`pnpm typecheck` or `pnpm lint --fix`.
