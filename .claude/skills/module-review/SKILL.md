---
name: module-review
description: "Audit a LangWatch module (modules/<name>), a directory, a diff or a branch against the annotation shape and its guards, and for over-abstraction, and report with file:line evidence: what the module still carries from the older shape (the feature-shape inventory), folder grammar and filenames, the app's public surface versus its API, repository interfaces with both backends, prisma containment and the typed seam, projectId and TenantId scoping, private runtime exports, transport rules, web layer direction and closed entries, spec parity and @scenario binding, boot-time provision versus refusing stubs, the frontend boundary, and identity functions, pass-through layers, ports with one implementation, optional dependencies production always supplies, and comment blocks that are really incident reports. Runs the mechanical detectors (architecture-lint, oxlint, ast-grep, check-feature-parity, package tests and typecheck) first, then reads what they cannot see. Use whenever someone says 'audit', 'review this module', 'review the changed files', 'is this module clean', 'does <package> follow the layout', 'why does lint fail here', 'what is left to convert in <module>', 'this is overengineered', 'too many tiny files', 'simplify this', or before opening a PR that touches a module."
user-invocable: true
argument-hint: "<module name, package path, diff target, or directory>"
---

# Audit a module

Read `.claude/skills/architecture-guide/SKILL.md` and `references/testing.md`. The
audit is evidence first: every finding names a file and line and the rule or scenario
it breaks. No finding without a path. Never edit code, never run `pnpm lint --fix`, never
run the root `pnpm typecheck`. The reference the module is measured against is
`modules/annotation`.

Auditing a change rather than a whole package? Diff against `origin/main`, or the PR base
if on a PR branch, and apply the mechanical and reading passes to the touched files only.
Auditing broad ownership before a split, rather than one existing module? Search the
whole repository by domain nouns, route names, database models, event names and public
DTO fields first (not only the obvious folder), and map current production files,
API routes and permissions, UI pages, worker/subscriber/process entry points, and
cross-module dependencies before concluding where something belongs. Existing URL
prefixes and database tables do not define module ownership.

## 1. Mechanical pass, always first

```bash
F=<module>; P=modules/$F
find $P -maxdepth 4 -type d | grep -v node_modules | grep -v __tests__
grep -n "\"$F\"" packages/architecture-lint/src/feature-shape-baseline.json      # what it still carries
pnpm --filter @langwatch/architecture-lint lint 2>&1 | grep -E "$P|apps/(api|worker|ui)/src/features/$F" > /tmp/audit-lint.txt; wc -l < /tmp/audit-lint.txt
pnpm exec oxlint --config .oxlintrc.architecture.json $P
pnpm --filter @langwatch/architecture-lint check:feature-parity 2>&1 | grep -A6 "$P/specs"
for pkg in contract server web; do pnpm --filter @langwatch/$F-$pkg typecheck; done
for pkg in contract server web; do pnpm --filter @langwatch/$F-$pkg test 2>&1 | grep -E "Tests |Test Files"; done
pnpm --filter @langwatch/architecture-lint test:unit tests/frontend-boundary.unit.test.ts 2>&1 | grep -E "Tests |$P"

# over-abstraction detectors: identity functions, same-name delegation, with file:line
uvx --from ast-grep-cli==0.42.3 ast-grep scan -c dev/lint/ast-grep/sgconfig.yml \
  --filter 'no-identity-function-ts|no-same-name-delegation-ts' --json=compact
```

Group the lint lines by rule name and count. A hard violation is an entry followed by an
`  allowed:` line. Note which are in a `*-baseline.json` (pre-existing, tolerated) and
which are new. The `feature-shape` entries are the conversion debt: list each kind and
what replaces it (the table in `.claude/skills/module/references/convert.md` maps every
kind to its annotation counterpart; converting is that reference's job, the audit only
names the gaps). Read the parity banner (`✗ THIS RUN FAILS: …`), not a per-file `✓`.

Then the shape survey, which no rule covers:

```bash
T=modules/<name>/server/src
for d in $(find $T -type d -not -path "*__tests__*"|sort); do \
  n=$(find "$d" -maxdepth 1 -name "*.ts" -not -name "*.test.ts"|wc -l); \
  [ "$n" -gt 0 ] && printf "%4s  %s\n" "$n" "$d"; done       # layer inventory
find $T -name "*.ts" -not -path "*__tests__*" | while read f; do \
  c=$(grep -cE '^\s*(//|/\*|\*)' "$f"); k=$(grep -cvE '^\s*(//|/\*|\*|$)' "$f"); \
  [ "$k" -gt 0 ] && [ "$c" -ge "$k" ] && echo "$c cmt / $k code  $f"; done   # comment-heavy files
for f in $T/services/*.ts; do b=$(basename "$f" .ts); \
  n=$(grep -rl "/$b\"" --include="*.ts" $T | grep -v __tests__ | grep -v "$f" | wc -l); \
  echo "$n  $b"; done | sort -n | head       # single-consumer modules
```

Use `grep -rn`, not ripgrep: `rg` returns incomplete results in this repo.

## 2. Shape, grammar, naming and data scoping (server)

Walk `server/src` against `.claude/skills/architecture-guide/references/server.md`:

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
- **`projectId` in every Prisma where clause** on a project-scoped model (`findMany`,
  `findFirst`, `findUnique`, `update`, `delete`. The tenancy guard is
  `platformScopeActions`, not a model allow-list: check what the guard actually covers
  before excusing a query.
- **`TenantId` as the first predicate of every ClickHouse query**, plus the partition
  key column in the WHERE when a date range exists, and no `LIMIT 1 BY` on heavy columns.
- **Transports**: tRPC declared once in the contract's `<f>.trpc.ts` (`defineTrpcContract`)
  and bound in `transport/<f>.trpc.ts` with `defineTrpcRouter(<F>Api, <f>Trpc)`; REST in
  `transport/<f>.rest.ts` via `defineRestRouter`; input and output schemas on every
  procedure and route; a permission or a declared alternative on every one; handlers
  calling exactly one app operation; no `TContext`/`TRoot`/mount type in the module.
  Importing a repository, constructing a service, reading `process.env` or a header,
  returning a `Response`, domain logic in a mapping helper. A mount file (`apps/api/src/features/<f>/`)
  still naming `createServiceApp`, `createServiceVersionedApp`, `createTrpcService`,
  `createProjectVersionedApp` or `mountProjectTransport` is a finding; all five are
  deleted; the current shape is `createRestRuntime`/`.mount()` and
  `TrpcRuntime`/`.mount()` (`.claude/skills/module/references/extend.md` sections 6.3 and
  7.4 show the replacement).
- Legacy pieces (`contract/src/<f>.service.ts`, `adapters/postgres.*`, `fixtures/`,
  `testing.ts`, `transport/<surface>/`, `ports/` used for a peer module, a missing
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
- **Reject on sight, wherever found**: callback/capability bags, service locators,
  `Pick`/`Omit` or inferred `Parameters`/`ReturnType` contracts standing in for a real
  interface, casts and suppressions, global `App`/`getApp`/`tryGetApp`/global Prisma,
  request-time construction of a service, package-level `process.env` access.

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
  collaborator nobody passes (inert leg). **What does the composition root actually pass?**
  Find every `X.create` call in `apps/api/src/app/*.composition.ts`,
  `apps/api/src/features/*/*.composition.ts`, `apps/worker/src/app/*.composition.ts` and
  `apps/tasks/src/platform/*.composition.ts`: an optional dependency that is always
  supplied is not optional, and the `if (!this.x) throw` it forces is unreachable code
  wearing a type. Say which arguments are genuinely absent in production and which are not.
- Config read via `process.env` inside the module; a post-parse `assert*Config` instead
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
- A change that adds or edits a skill under `.claude/skills/` / `skills/` or an MCP tool
  under `mcp/typescript/src/tools/` with no matching scenario in
  `specs/skills/skills-testing.feature`.
- Re-exports added for backwards compatibility anywhere: never allowed, update the
  importers.
- **Auditing a diff that converts or migrates a module**: compare old and new observable
  behaviour field by field: response DTOs, auth, error/status mapping, sorting,
  pagination/cursors, money/time units, query tables, retries, idempotency, side effects.
  A green package-test count is not proof of behaviour parity. Compare deleted tests
  against the coverage they carried; list every lost scenario as a finding until it is
  restored or the loss is named DELIBERATE with a reason.

## 7. Over-abstraction: what the detectors cannot see

Four questions, in this order, each needing a `path:line` answer. Read
`dev/docs/best_practices/overengineering.md` and
`dev/docs/best_practices/feature-cleanup-review.md` (rules R1-R8, the reference for what
"simple enough" looks like) before applying them.

- **Where does a database client stop?** (R1) A service takes a repository, never a
  `PrismaClient`, `Prisma.TransactionClient` or ClickHouse client. If a service opens a
  transaction or writes raw SQL, that belongs behind the repository, and a transactional
  callback receives a transactional _repository_, not a client.
- **What does the composition root actually pass?** (R5) See section 5 above; this is the
  same question, answered once per audit.
- **How many implementations does each port have?** (R4)
  `grep -rn "implements XPort\|extends XPort"`. Two or more, or one in a different
  package, and it stays. One, in the same package, and it is a seam to nowhere. Never
  propose collapsing a port with real polymorphism.
- **Do the errors carry their own status?** (R6) A `Record<string, {status}>` keyed on
  `error.name`, or an `instanceof` ladder in a router, means the errors are plain
  `Error`s and every transport re-derives the mapping. Check whether the class the
  transport tests is the class the runtime throws: where a contract and a server
  package both declare the name, `instanceof` is silently always false.

Do not invent work. A rule firing is a question, not a verdict: check each hit against
the source and drop the idioms (`(x) => x` as a no-op default, `.filter((x) => x)` as a
truthiness filter, a routed repository delegating by verb). List what stays and why in a
Keep list: a port with two or more implementations, an open set with one file per member
where a new member touches nothing else, `app/<f>.app.ts` (the one facade both transports
call, which the layout requires), a hot path already inside its quality ceiling where the
only complaint is method length, and anything the mechanical half already accepts
(`packages/architecture-lint/src/overengineering-policy.mjs`,
`packages/architecture-lint/src/oxlint-baseline.json`), and defer to their output rather than
re-litigating it.

## 8. Classify and report

For each finding: **file:line**, the rule or scenario, a one-line target shape.
Classify every gap as one of:

- **LEGACY**: a piece of the older shape the `feature-shape` baseline already lists;
  name its replacement (the conversion is `references/convert.md`'s job, not this
  audit's).
- **STALE**: a named absence or comment whose claim the code contradicts; delete it.
- **DELIBERATE**: an absence the root names on purpose; leave it, cite the log line.
- **REAL GAP**: behaviour missing or a rule broken outside the inventory; say which
  `module` reference fixes it (`extend.md`, `wire.md`, `move.md`, `web-surface.md`).

Report structure, always:

```
# <module> audit
## Mechanical: lint <n> (new <n>, baselined <n>) · feature-shape <kinds left> · parity <bound>/<total> · tsc <errors> · tests <pass>/<total>
## Findings (most severe first)
- file:line · rule · what · target shape
## Over-abstraction: findings, then Keep list with reasons
## Absences: LEGACY / STALE / DELIBERATE / REAL GAP
## Recommended order of fixes
```

Do not fix anything unless asked; the audit is the deliverable. Never run the root
`pnpm typecheck` or `pnpm lint --fix`.
