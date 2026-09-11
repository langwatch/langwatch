# Review checklist: the mechanical pass, server, contract and web

Owned by the `module-review` skill (`.claude/skills/module-review/SKILL.md`), which sets the order and routes here; this file carries sections 1 to 4 of the audit.

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

- **The installer**: `<f>.server.ts` is `defineModule("<f>")` with `.withRepositories`
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
- **Channels**: messages to or from something the module does not own, in either
  direction, with no owned state - the event bus, Redis pub/sub, HTTP to a vendor, a
  queue, email, Slack, a browser over SSE. An interface at `channels/<x>.channel.ts`,
  implementations at `channels/<tier>/<tier>.<x>.channel.ts` (`eventing`, `redis`, `http`,
  `sqs`, `ses`, `slack`), a memory twin, and `defineChannels({ live, memory })` in
  `channels/<f>-channels.registry.ts`. A file under `services/` importing
  `@langwatch/eventing`, `ioredis` pub/sub, `undici`/`fetch`/`axios`/`got`, `@aws-sdk/*`,
  `resend`, `@slack/*` or `nodemailer` is a finding
  (`service-does-not-open-a-channel`); a live channel with no twin or no registry entry is
  `feature-shape: unregistered-channels`. `go run ./tools/shapemod channels modules/<f>`
  lists the candidates with the signal that fired.
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

- `<f>.api.ts` with one interface of callable operations and its `moduleApi` token,
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
