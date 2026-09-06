---
name: feature-audit
description: "Audit one LangWatch feature package (or a directory, a diff or a branch) against the strict layout and its guards and report with file:line evidence: folder grammar and filenames, prisma containment and the typed seam, projectId and TenantId scoping, private runtime exports, port versus adapter shape, transport rules, web layer direction and closed public entry, spec parity and @scenario binding, named absences versus stubs, and the frontend boundary. Runs the mechanical detectors (architecture-lint, oxlint, check-feature-parity, package tests and typecheck) first, then reads what they cannot see. Use whenever someone says 'audit', 'review this feature', 'review the changed files', 'is this feature clean', 'does <package> follow the layout', 'why does lint fail here', 'what is left to fix in <feature>', or before opening a PR that touches a feature package."
user-invocable: true
argument-hint: "<feature name, package path, or diff target>"
---

# Audit a feature

Read `.claude/skills/architecture-guide/SKILL.md` and `references/testing.md`. The
audit is evidence first: every finding names a file and line and the rule or scenario
it breaks. No finding without a path.

Auditing a change rather than a package? Diff against `origin/main`, or the PR base if on
a PR branch, and apply sections 2 to 6 to the touched files only.

## 1. Mechanical pass

```bash
F=<feature>; P=packages/features/$F
find $P -maxdepth 4 -type d | grep -v node_modules | grep -v __tests__
pnpm --filter @langwatch/architecture-lint lint 2>&1 | grep -E "$P" > /tmp/audit-lint.txt; wc -l < /tmp/audit-lint.txt
pnpm exec oxlint --config .oxlintrc.architecture.json $P
pnpm --filter @langwatch/architecture-lint check:feature-parity 2>&1 | grep -A6 "$P/specs"
for pkg in contract server web; do pnpm --filter @langwatch/$F-$pkg typecheck; done
for pkg in contract server web; do pnpm --filter @langwatch/$F-$pkg test 2>&1 | grep -E "Tests |Test Files"; done
pnpm --filter @langwatch/architecture-lint test run tests/frontend-boundary.unit.test.ts 2>&1 | grep -E "Tests |$P"
```

Group the lint lines by rule name and count. A hard violation is an entry followed by an
`  allowed:` line. Note which are in a `*-baseline.json` (pre-existing, tolerated) and
which are new. Read the parity banner (`✗ THIS RUN FAILS: …`), not a per-file `✓`.

## 2. Grammar, naming and data scoping (server)

Walk `server/src` against the closed list in `references/server.md`:

- Folders outside `app, services, rules, ports, repositories, stores, projections,
subscribers, processes, intents, adapters, transport, migrations, tasks, fixtures`.
  `utils`, `lib`, `helpers`, `domain`, `composition`, `types` are findings; say where each
  file belongs.
- Filenames: dot between qualifier and subject, hyphen inside names; a `.service.ts`
  exporting no class of that name; a runtime class without `static create`.
- `services/` empty or missing. A `rules/` module that reads a clock or an I/O boundary.
- `index.ts` exporting anything from `repositories`, `stores`, `projections`.
- `PrismaClient` named outside `repositories/prisma/**` and `adapters/postgres.*`; any
  `as PrismaClient`; `database: object`.
- **`projectId` in every Prisma where clause** on a project-scoped model — `findMany`,
  `findFirst`, `findUnique`, `update`, `delete`. The tenancy guard is
  `platformScopeActions`, not a model allow-list: check what the guard actually covers
  before excusing a query.
- **`TenantId` as the first predicate of every ClickHouse query**, plus the partition
  key column in the WHERE when a date range exists, and no `LIMIT 1 BY` on heavy columns.
- No `uuid`, `nanoid` or `crypto.randomUUID`: identifiers are `@langwatch/ksuid`.
- SQL migrations: no foreign keys, no schema prefixes (`"langwatch_db".`), no down
  migration in a ClickHouse file.
- A `ports/*.port.ts` that is a type alias, or a port with exactly one implementation
  that every composition root supplies (over-abstraction: recommend the concrete dep).
- Transports importing repositories, constructing services, reading `process.env` or
  reaching a service locator; a REST handler returning `c.json({ error })`.
- Repository methods named `list`/`get`; service methods returning `{ ok, error }`
  result objects instead of throwing; any `require*`.
- New HTTP added to `transport/api-rest/` that is not keeping an existing URL alive; it
  belongs in `transport/public-rest/` (ADR-128).

## 3. Contract

- Server artifacts in contract source; a bare `service.ts`; framework imports.
- Zod schemas duplicated as hand-written types; `.strict()` on a schema fed by producers
  outside the package; `unknown` fields that drop or widen data.
- Error classes: stable code present in `packages/handled-error/src/app-codes.ts` and
  `packages/handled-error/src/presentation.ts`; message naming an env var, host or
  internal service; 5xx without an explicit `fault`.

## 4. Web

- Files outside `model, behavior, ui/{elements,blocks,sections}, screens, surfaces`.
- Layer direction: an element or block importing behavior; behavior importing ui.
- `package.json` exports beyond `./screens/<id>` and `./surfaces/<id>`.
- An api-map naming `AppRouter` (ADR-130), or a slot typed `any`.
- A screen reading session, project or router directly instead of a `*HostPort`.
- Hooks returning JSX; `form.watch()` in a child; a drawer mounted with `useState`; a
  toast of `error.message`; abbreviations or internals in copy.
- Component tests named `.unit.test` while rendering.
- Single responsibility: one primary export per file, no HTTP mixed with business logic
  or fetching mixed with rendering. Flag functions over ~100 lines.

## 5. Composition and wiring

```bash
grep -rn "@langwatch/$F-server" apps/api/src apps/worker/src apps/tasks/src | grep -v __tests__
grep -rn "$F" apps/api/src/app-rest/app-rest.packaged-families.ts apps/api/src/app-trpc/app-trpc.features.ts apps/ui/src/features/installed-ui-features.ts apps/ui/src/features/catalogue.json
```

- A service constructed with an optional collaborator nobody passes (inert leg).
- A stub that answers instead of a named absence; a REST family mounted over a missing
  service.
- Config read via `process.env` inside the feature.
- The API appending events or running process managers (must be producer-only).

## 6. Specs and tests

- Scenarios untagged, or tagged but unbound; annotations naming a scenario that no
  longer exists; `.feature` files added to `LEGACY_INERT` or `LEGACY_UNBOUND`.
- Tests that assert a constant back at itself, tests with no assertion, `should` in
  names, describes without `given`/`when`, message-prose assertions.
- A regression test that checks a string instead of executing the path.
- A change that adds or edits a skill under `skills/` or an MCP tool under
  `mcp/typescript/src/tools/` with no matching scenario in
  `specs/skills/skills-testing.feature` — a new tool handler needs at least one
  `@integration` scenario over its happy path.
- Re-exports added for backwards compatibility anywhere: never allowed, update the
  importers.

## 7. Classify and report

For each finding: **file:line**, the rule or scenario, a one-line target shape.
Classify every gap as one of:

- **STALE**: a named absence or comment whose claim the code contradicts; delete it.
- **DELIBERATE**: an absence the root names on purpose; leave it, cite the log line.
- **REAL GAP**: behaviour missing; say which skill fixes it (`feature-extend`,
  `feature-wire`, `feature-move`, `api-rest-route`, `api-trpc-procedure`, `spec-bind`).

Report structure, always:

```
# <feature> audit
## Mechanical: lint <n> (new <n>, baselined <n>) · parity <bound>/<total> · tsc <errors> · tests <pass>/<total>
## Findings (most severe first)
- file:line · rule · what · target shape
## Absences: STALE / DELIBERATE / REAL GAP
## Recommended order of fixes
```

Do not fix anything unless asked; the audit is the deliverable. Never run the root
`pnpm typecheck` or `pnpm lint --fix`.
