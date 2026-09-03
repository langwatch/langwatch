---
name: feature-audit
description: "Audit one LangWatch feature package (or a directory) against the strict layout and its guards and report with file:line evidence: folder grammar and filenames, prisma containment and the typed seam, private runtime exports, port versus adapter shape, transport rules, web layer direction and closed public entry, spec parity and @scenario binding, named absences versus stubs, and the frontend boundary. Runs the mechanical detectors (architecture-lint, check-feature-parity, package tests and typecheck) first, then reads what they cannot see. Use this whenever someone says 'audit', 'review this feature', 'is this feature clean', 'does <package> follow the layout', 'why does lint fail here', 'what is left to fix in <feature>', or before opening a PR that touches a feature package."
user-invocable: true
argument-hint: "<feature name or package path>"
---

# Audit a feature

Read `.claude/skills/architecture-guide/SKILL.md` and `references/testing.md`. The
audit is evidence first: every finding names a file and line and the rule or scenario
it breaks. No finding without a path.

## 1. Mechanical pass

```bash
F=<feature>; P=packages/features/$F
find $P -maxdepth 4 -type d | grep -v node_modules | grep -v __tests__
pnpm --filter @langwatch/architecture-lint lint 2>&1 | grep -E "$P" > /tmp/audit-lint.txt; wc -l < /tmp/audit-lint.txt
pnpm --filter @langwatch/architecture-lint exec tsx src/check-feature-parity.ts 2>&1 | grep -A6 "$P/specs"
for pkg in contract server web; do pnpm --filter @langwatch/$F-$pkg exec tsc --noEmit -p tsconfig.json; done
for pkg in contract server web; do pnpm --filter @langwatch/$F-$pkg test 2>&1 | grep -E "Tests |Test Files"; done
pnpm --filter @langwatch/architecture-lint test run tests/frontend-boundary.unit.test.ts 2>&1 | grep -E "Tests |$P"
```

Group the lint lines by rule name and count. Note which are in a `*-baseline.json`
(pre-existing, tolerated) and which are new.

## 2. Grammar and naming (server)

Walk `server/src` against the closed list in `references/server.md`:

- Folders outside `app, services, ports, repositories, stores, projections, subscribers,
processes, intents, adapters, transport, migrations, fixtures`. `utils`, `lib`,
  `helpers`, `domain`, `composition`, `types` are findings; say where each file belongs.
- Filenames: dot between qualifier and subject, hyphen inside names; a `.service.ts`
  exporting no class of that name; a runtime class without `static create`.
- `services/` empty or missing.
- `index.ts` exporting anything from `repositories`, `stores`, `projections`.
- `PrismaClient` named outside `repositories/prisma/**` and `adapters/postgres.*`; any
  `as PrismaClient`; `database: object`.
- A `ports/*.port.ts` that is a type alias, or a port with exactly one implementation
  that every composition root supplies (over-abstraction: recommend the concrete dep).
- Transports importing repositories, constructing services, or reaching a service
  locator; a REST handler returning `c.json({ error })`.
- Repository methods named `list`/`get`; service methods returning `{ ok, error }`
  result objects instead of throwing; any `require*`.
- ClickHouse queries: `TenantId` first predicate, partition column in the WHERE when a
  range exists, no `LIMIT 1 BY` on heavy columns.

## 3. Contract

- Server artifacts in contract source; a bare `service.ts`; framework imports.
- Zod schemas duplicated as hand-written types; `.strict()` on a schema fed by producers
  outside the package; `unknown` fields that drop or widen data.
- Error classes: stable code present in `packages/handled-error/src/app-codes.ts` and
  `presentation.ts`; message naming an env var, host or internal service; 5xx without an
  explicit `fault`.

## 4. Web

- Files outside `model, behavior, ui/{elements,blocks,sections}, screens, surfaces`.
- Layer direction: an element or block importing behavior; behavior importing ui.
- `package.json` exports beyond `./screens/*`, `./surfaces/*`, `./drawers`.
- A screen reading session, project or router directly instead of a `*HostPort`.
- Hooks returning JSX; `form.watch()` in a child; a drawer mounted with `useState`; a
  toast of `error.message`; abbreviations or internals in copy.
- Component tests named `.unit.test` while rendering.

## 5. Composition and wiring

```bash
grep -rn "@langwatch/$F-server" apps/api/src apps/worker/src | grep -v __tests__
grep -rn "$F" apps/api/src/app-rest/app-rest.packaged-families.ts apps/ui/src/features/installed-ui-features.ts apps/ui/src/features/installed-ui-drawers.ts apps/ui/src/features/catalogue.json
```

- A service constructed with an optional collaborator nobody passes (inert leg).
- A stub that answers instead of a named absence; a REST family mounted over a missing
  service.
- Config read via `process.env` inside the feature.
- The API appending events or running process managers (must be producer-only).

## 6. Specs and tests

- Scenarios untagged, or tagged but unbound; annotations naming a scenario that no
  longer exists; `.feature` files in `LEGACY_INERT`.
- Tests that assert a constant back at itself, tests with no assertion, `should` in
  names, describes without `given`/`when`, message-prose assertions.
- A regression test that checks a string instead of executing the path.

## 7. Classify and report

For each finding: **file:line**, the rule or scenario, a one-line target shape.
Classify every gap as one of:

- **STALE**: a named absence or comment whose claim the code contradicts; delete it.
- **DELIBERATE**: an absence the root names on purpose; leave it, cite the log line.
- **REAL GAP**: behaviour missing; say which skill fixes it (`feature-extend`,
  `feature-wire`, `feature-move`).

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
