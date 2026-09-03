# secret — cleanup review

Audited against [`feature-cleanup-review.md`](../../best_practices/feature-cleanup-review.md);
shape follows [`dataset.md`](./dataset.md).

**Verdict: structurally clean, behaviourally broken.** The layering is already
what the dataset review is aiming at — no Prisma above the repository, one app
facade, four `HandledError`s, one port and it is a real inversion. There is
almost nothing to delete. What the read turned up instead is four live defects
and one dead branch, all of which the layering makes easy to fix in place.

## 1. What is there now

**876 lines, 14 non-test files** — 639 lines / 9 files in `server`, 237 lines /
5 files in `contract`. No `web` package. **6 operations**, declared 4 times
(contract, service, app, repository). 581 lines of test in 5 files.

```
  platform: internal-api/secrets.router.ts        apps/api: api.application.ts
  platform: runtime/app/features/secret.ts        apps/api: api-secret-rest.feature.ts
        │                                               │
  server/src
    transport/api-trpc/secret.api.ts   SecretTrpcApi        4 procedures (no `get`)
    api/public-rest/secret.api.ts      SecretPublicRestApi  5 routes
        │
    app/secret.app.ts                  SecretApp            5 methods ← 3 one-line
                                                                        pass-throughs
        │
  @langwatch/secret-contract
    secret.service.ts                  abstract SecretService  6 signatures
        │
  server/src
    services/secret.service.ts         SecretService        6 public + 1 private
        │
    ports/secret.port.ts               SecretEncryptionPort 2 signatures
    repositories/secret.repository.ts  abstract SecretRepository  7 signatures
        │
    repositories/prisma/
      prisma.secret.repository.ts      PrismaSecretRepository     7 methods
```

Wiring beside it: `adapters/postgres.secret.adapter.ts` (36 lines, 1 method) and,
outside the package, `AppSecretRuntime` (`platform/app/src/runtime/app/features/secret.ts:72-82`).

A third door exists outside the package: the deprecated `/api/secrets` family at
`apps/api/src/features/secret/secret-legacy-rest.ts` (225 lines), mounted in
production through `apps/api/src/app-rest/app-rest.features.ts:411`.

**Four layers between a transport and Prisma, and all four hold something.**
That is the finding. Compare dataset: seven, of which five held nothing.

## 2. Problems

### P1 — The platform REST composition passes the wrong object (breaks R3's premise; a live 500)

`api/public-rest/secret.api.ts:22` demands an app that **is** a `SecretApp`:

```ts
install<TApplication extends SecretApp>(api: SecretPublicRestService<TApplication>, …)
```

and its handlers call it directly — `context.app.list(…)` at `:41`,
`context.app.get(…)` at `:56`, `context.app.create(input, context.actor())` at
`:73`, `:87`, `:101`.

`apps/api` composes it correctly: `createRestService<SecretApp>({ … app: () =>
options.application })` at `apps/api/src/api-secret-rest.feature.ts:66,74`,
over the `SecretApp` built at `:15`.

`platform/app` does not. `platform/app/src/runtime/app/features/secret.ts:26,38`
installs it on `createProjectRestApiService(…)`, and that service's app resolver is
`app: appFromContext` (`platform/app/src/server/api/project-service.ts:69`) —
the whole `App`. `App` is declared at `platform/app/src/server/app-layer/app.ts:119`
and holds `readonly secrets: SecretApp` at `:140`; it has no instance `list`,
`get`, `create`, `update` or `delete` of its own.

So every request to `/api/v1/secret`, `/api/v1/secrets` and `/api/secret` in the
platform process reaches `undefined(…)`. `SecretApp`'s private field
(`app/secret.app.ts:44`) also makes `App extends SecretApp` fail nominally, so
the call site should not compile either.

The platform test agrees with `apps/api`, not with the package: it mocks
`{ secrets: { create, delete, get, getValues, list, update } }` at
`platform/app/src/app/api/v1/secret/__tests__/secret-public-rest-api.unit.test.ts:53-62`
and asserts `create` — i.e. `langwatchApp.secrets.create` — was called (`:207`,
`:381`). Nothing the handler does can satisfy that.

One of the two is wrong and they cannot both be right. The fix is one line in the
platform composition; `apps/api` is the reference.

### P2 — Four `HandledError`s, zero customer copy (breaks R6)

`contract/src/secret.errors.ts` is exactly right on the error side: four classes,
all `HandledError`, correct `httpStatus`, explicit `fault: "customer"`, `meta`
carrying `name` and `limit` (`:8`, `:20`, `:33`, `:47`).

None of the four codes is in `APP_ERROR_CODES` or `presentation.ts`. They are
parked in the guard's escape hatch instead —
`platform/app/src/features/errors/logic/__tests__/codes.unit.test.ts:260`
opens `UNCOPIED_CODES_BACKLOG`, and `:298-301` are `secret_already_exists`,
`secret_limit_reached`, `secret_name_reserved`, `secret_not_found`.

The consequence is concrete. `platform/app/src/pages/settings/secrets.tsx:70,84,100`
call `showErrorToast({ error, fallbackTitle: … })`; for an unregistered code
`explainHandledError` returns `description: ""`
(`platform/app/src/features/errors/logic/presentation.ts:3584-3608`). A duplicate
name shows "Couldn't create the secret" and nothing else — the sentence
`SecretDuplicateError` already wrote (`secret.errors.ts:48`) never reaches anyone.

### P3 — The reserved-name create guard cannot fire (breaks R7: the comment and the spec are both false)

`services/secret.service.ts:73-75`:

```ts
if (this.reservedNames.has(parsed.name)) throw new SecretReservedNameError(parsed.name);
```

`parsed.name` has already passed `secretNameSchema`, whose regex is
`/^[A-Z][A-Z0-9_]*$/` (`contract/src/secret.ts:6,13-19`). The only reserved name
production supplies is lower case: `RESERVED_PROJECT_SECRET_NAMES = [LANGY_VK_SECRET_NAME]`
= `["langy_vk_secret"]` (`platform/app/src/server/projects/reserved-secret-names.ts:17,24`),
passed at `platform/app/src/runtime/app/features/secret.ts:79`. No input that
reaches line 73 can be in that set.

The test passes because it supplies its own uppercase name —
`reservedNames: ["PRODUCT_KEY"]` at
`server/src/ports/__tests__/secret.service.unit.test.ts:140`.

`specs/secret.feature:47` promises "When a caller lists, reads, updates, deletes,
or **creates** that name". The create half is vacuous. The other three halves are
fine: they compare against the **stored** name (`:46`, `:106`), which is the
lower-case one.

### P4 — `getValues` is the one read path with no reserved-name filter (breaks R8)

The reserved-name rule is written three times in one class and forgotten a fourth:

| Line | Path | Reserved names |
|---|---|---|
| `services/secret.service.ts:46` | `list` | filtered out |
| `services/secret.service.ts:73` | `create` | refused (dead — see P3) |
| `services/secret.service.ts:106` | `get`/`update`/`delete` | 404 |
| `services/secret.service.ts:49-64` | `getValues` | **returned** |

`getValues` is the only method that returns plaintext. Its one caller splices the
result straight into a scenario target's execution environment:
`packages/features/scenario/server/src/services/scenario-target-prefetch.service.ts:71-74`.

So `langy_vk_secret` — the project's Langy virtual-key plaintext, which
`reserved-secret-names.ts:11-16` describes as product-owned and load-bearing —
is handed to every scenario target. The service unit test pins the current
behaviour rather than catching it
(`ports/__tests__/secret.service.unit.test.ts:113-124` asserts `LANGY_KEY` is
returned).

### P5 — `PostgresSecretAdapter` memoises a value that is fetched once (breaks R3)

`adapters/postgres.secret.adapter.ts:15,26`:

```ts
private service: SecretServiceContract | null = null;
build(): SecretServiceContract { if (this.service) return this.service; … }
```

Every construction of this adapter calls `build()` exactly once, in the same
expression: `platform/app/src/runtime/app/features/secret.ts:76-80`. The
`if` is unreachable, and the field and the mutable state exist for it. The only
thing that exercises the memo is a test written for it:
`server/src/ports/__tests__/secret.adapter.unit.test.ts:23`
(`expect(adapter.build()).toBe(adapter.build())`).

Also `database: object` at `:7`, cast at
`repositories/prisma/prisma.secret.repository.ts:25-26` with
`new PrismaSecretRepository(database as PrismaClient)`. The package already
depends on `@langwatch/prisma-client` and imports `PrismaClient` two files away
(`prisma.secret.repository.ts:7`), so the widening buys nothing and removes the
only check. (Sibling packages that use `database: object` at least pair it with a
type guard — `packages/features/github/server/src/repositories/prisma/github-installations.repository.ts:65`.)

### P6 — Two `ctx.actor()` calls whose result is thrown away (breaks R7)

`transport/api-trpc/secret.api.ts:130` (`list`) and `:148` (`delete`):

```ts
ctx.actor();
return ctx.app.secrets.list(input);
```

They read as an authentication guard and are not one. Both hosts have already
authenticated before the handler runs: `apps/api/src/api.application.ts:247`
calls `ctx.actor()` inside the protected procedure, and platform's
`authProtectedProcedure` runs `identity.authenticate`, which throws
`UNAUTHORIZED` without a session
(`platform/app/src/server/api/trpc.runtime-policy.ts:37-44`).

### P7 — Two input vocabularies for `update` and `delete` (breaks R8)

`transport/api-trpc/secret.api.ts:106-111` declares `legacyUpdateInputSchema` and
`legacyDeleteInputSchema` — the contract's operations with `id` renamed to
`secretId`. They are called "legacy" but they are the only shapes the browser
speaks, and `update`/`delete` then return `{ success: true }` (`:143`, `:150`)
instead of the `Secret` and `void` the contract declares
(`contract/src/secret.service.ts:15-16`).

The whole consumer is one file:
`platform/app/src/pages/settings/secrets.tsx:79,94` pass `secretId`. Renaming two
properties there deletes both schemas.

### P8 — 36 % and 42 % of two files are commentary that belongs in the ADR (breaks R7)

`transport/api-trpc/secret.api.ts`: 56 of 155 lines. `app/secret.app.ts`: 32 of 77.

The package already has `adrs/001-secret-service-and-rest.md` (140 lines) holding
exactly this material. What is in the source is superseded-design narrative —
`app/secret.app.ts:4-8` ("Before it, each door declared its own
`Readonly<{ secrets: SecretService }>` …"), and `transport/api-trpc/secret.api.ts:29-38`
("closing that gap means a middleware that narrows the context per router").

One of them is also false. `app/secret.app.ts:10-11` says "Most operations are the
service's own, reached through {@link secrets}". There is no `secrets` member —
the field is `private readonly dependencies` (`:44`), the class delegates all five
operations explicitly, and it deliberately exposes no service at all. The link
resolves to nothing.

### P9 — Both barrels are `export *`; a third of what they publish has no reader (breaks R8)

`server/src/index.ts:1-6` — 6 `export *` lines, ~13 symbols. Used outside the
package: `SecretApp`, `SecretTrpcApi`, `SecretTrpcContext`, `SecretPublicRestApi`,
`PostgresSecretAdapter`, `SecretEncryptionPort`. Zero external readers:
`SecretCaller`, `SecretAppDependencies`, `SecretTrpcPolicy`, `SecretServiceOptions`,
`PostgresSecretAdapterOptions`, `SECRET_PUBLIC_API_VERSION`.

`contract/src/index.ts:1-4` — 4 `export *` lines, ~30 symbols, 10 with external
readers. Zero: `SECRET_FEATURE_ID`, `SECRET_NAME_PATTERN`, `MAX_SECRETS_PER_PROJECT`,
`MAX_SECRET_VALUE_LENGTH`, `secretIdSchema`, `secretProjectIdSchema`,
`secretActorIdSchema`, `secretActorSchema`, `storedSecretNameSchema`,
`secretNameSchema`, `secretValueSchema`, `secretSchema`, and every
`*InputSchema` except `secretPublicCreateInputSchema` / `secretPublicUpdateInputSchema`.

The barrel also republishes a **name collision**: `server/src/index.ts:6` exports
the concrete `SecretService`, while `@langwatch/secret-contract` exports an
abstract class of the same name. The server file has to alias its own import to
say so — `SecretService as SecretServiceContract` at `services/secret.service.ts:10`.
Nothing outside the package imports the concrete one.

### P10 — The transport lives in two directory conventions at once (observation, not a claim about CI)

`transport/api-trpc/secret.api.ts` matches the layout grammar
(`packages/architecture-lint/src/feature-layout.ts:88-89`,
`^transport/${NAME}/${NAME}\.api\.ts$`). `api/public-rest/secret.api.ts` matches
none of `SERVER_PATTERNS` (`feature-layout.ts:65-92`), and the package is
`layoutVersion: 0` (`packages/features/secret/feature.json`), so `lintServer`
applies to it (`feature-layout.ts:432-436`).

Being honest about the disagreement rather than the verdict: a **different**
architecture rule already treats both as transport roots —
`packages/architecture-lint/src/api-transport-boundaries.ts:68` names
`src/transport` and `src/api` together — and `langy` and `stored-object` carry
the same `api/public/` + `transport/api-trpc/` shape. So either the grammar wants
an `api/<surface>/` entry or three packages want a move; this review does not
decide which, and neither is a cleanup of `secret`.

## 3. What it should look like

```
contract/src/
  index.ts                    ~14   named exports, the 10 symbols anyone imports
  secret.ts                    71   unchanged
  secret.service.ts            17   unchanged
  secret.errors.ts             53   unchanged
  secret.queries.ts            92   unchanged

server/src/
  index.ts                    ~12   named exports, the 6 symbols anyone imports
  app/secret.app.ts           ~45   docblock down to 4 lines; the false @link gone
  services/secret.service.ts ~115   reserved names normalised once, applied in all four paths
  ports/secret.port.ts          4   unchanged
  adapters/postgres.secret.adapter.ts  ~14   a static factory; no instance, no memo
  repositories/secret.repository.ts     23   unchanged
  repositories/prisma/prisma.secret.repository.ts  ~118   `PrismaClient`, no cast
  transport/api-trpc/secret.api.ts      ~95   contract schemas; no dead actor() calls
  api/public-rest/secret.api.ts        ~100   unchanged behaviour

platform/app/src/features/errors/logic/{codes,presentation}.ts   +4 codes, +4 entries
platform/app/src/runtime/app/features/secret.ts                  the P1 one-liner
platform/app/src/pages/settings/secrets.tsx                      `secretId` → `id`
```

**~14 files, ~526 server lines (from 639).** Four layers stay four layers. This
feature does not need re-architecting; it needs its four defects closed.

### The composition (P1)

`apps/api` already has it right. Platform has to narrow the app the same way,
either by resolving the feature slice:

```ts
const rest = createRestService<SecretApp>({
  name: "secret",
  basePath: options.basePath ?? "/api/v1/secret",
  // …the same middleware, auth, permission and versioning seams as
  // createProjectRestApiService, but the app the handler sees is the feature's.
  app: (context) => appFromContext(context).secrets,
});
```

or, if `createProjectRestApiService` must stay the single seam for auth and route
registration, by giving it an optional `select: (app: App) => TFeatureApp` and
passing `(app) => app.secrets` here. Either way the invariant to restore is the
one the installer's signature already states: **what a REST handler holds is a
`SecretApp`, not the process's whole `App`.**

### The reserved-name policy (P3 + P4), stated once

```ts
export class SecretService extends SecretServiceContract {
  /** Compared case-insensitively: a reserved row may be stored lower case
   *  (`langy_vk_secret`) while `secretNameSchema` only admits upper case, so an
   *  exact match could never refuse a create. */
  private readonly reserved: ReadonlySet<string>;

  private isReserved(name: string): boolean {
    return this.reserved.has(name.toUpperCase());
  }

  async list(input: ListSecretsInput): Promise<Secret[]> {
    const parsed = listSecretsInputSchema.parse(input);
    const rows = await this.options.repository.list(parsed.projectId);
    return rows.filter((secret) => !this.isReserved(secret.name));
  }

  /** Trusted server-side execution. Product-owned secrets are withheld here for
   *  the same reason they are hidden from `list`: the caller is a customer
   *  workload, and `langy_vk_secret` is the product's own gateway credential. */
  async getValues(input: ListSecretsInput): Promise<Record<string, string>> {
    const parsed = listSecretsInputSchema.parse(input);
    const rows = await this.options.repository.listEncryptedValues(parsed.projectId);
    const values: Record<string, string> = {};
    for (const row of rows) {
      if (this.isReserved(row.name)) continue;
      values[row.name] = this.decrypt(row);
    }
    return values;
  }
}
```

Four sites, one predicate. `create` starts refusing reserved names for the first
time, and `getValues` stops handing the Langy virtual key to scenario targets.

Two scenarios in `specs/secret.feature:45-49` need splitting so each binds: the
create half and the trusted-read half are different assertions and today neither
is bound to a test that exercises production's reserved list.

### The adapter (P5)

The class stays — `lintPrivateServerExports`
(`packages/architecture-lint/src/feature-layout.ts:267-269`) forbids a feature
server root from exporting `repositories/**`, so this is the sanctioned seam that
keeps `PrismaSecretRepository` private. What goes is the instance:

```ts
export interface PostgresSecretAdapterOptions {
  database: PrismaClient;
  encryption: SecretEncryptionPort;
  reservedNames: readonly string[];
}

/** Composes the Postgres-backed Secret service. The repository stays private to
 *  the package; this is how a process reaches it. */
export class PostgresSecretAdapter {
  static build(options: PostgresSecretAdapterOptions): SecretServiceContract {
    return SecretService.create({
      repository: PrismaSecretRepository.create(options.database),
      encryption: options.encryption,
      reservedNames: options.reservedNames,
    });
  }
}
```

36 lines → 14. The cast at `prisma.secret.repository.ts:26` goes with it, and so
does `maximumPerProject`, which no composition root passes — grep finds it only in
`secret.service.ts:26,36`, `postgres.secret.adapter.ts:10,32` and one test
(`ports/__tests__/secret.service.unit.test.ts:155`). The test can set the ceiling
by counting instead, or `MAX_SECRETS_PER_PROJECT` can stay the only answer.

## 4. Keep list

Deliberately unchanged, with the reason:

- **`SecretEncryptionPort`** (`ports/secret.port.ts`). One implementation, and it
  lives in `platform/app` (`runtime/app/features/secret.ts:62-70`, over
  `~/utils/encryption`). A genuine inversion — R4 keeps it.
- **`abstract SecretRepository`** (`repositories/secret.repository.ts`). One
  in-package implementation, but this is the R1 seam itself: it is what keeps
  `PrismaClient` out of the service. Dataset's target tree keeps the equivalent.
- **`abstract SecretService`** in the contract. Cross-package, and it has a real
  second consumer that is not a transport: `packages/features/scenario/server/src/services/scenario-target-prefetch.service.ts:8,89`
  depends on the contract without depending on `@langwatch/secret-server`.
- **`SecretApp`** (`app/secret.app.ts`). Required by the layout rule, and it holds
  a real rule rather than a delegation: `create` and `update` stamp `actorId` from
  the caller (`:69-76`), which both doors otherwise did for themselves. It also
  deliberately omits `getValues`, so **no transport can reach plaintext** — that
  omission is the design and should be commented as such, since it is the one
  thing about the class a reader could undo by accident.
- **`policy?` on `SecretTrpcProcedures`** (`transport/api-trpc/secret.api.ts:103`)
  and the `contextAuthorizePolicy` fallback at `:81-89`. Genuinely optional:
  platform injects a policy (`runtime/app/internal-api/secrets.router.ts:29-45`),
  `apps/api` omits it (`api.application.ts:213`) and authorises through
  `ctx.authorize`. Two real callers, two real branches.
- **The four public REST base paths** (`/api/v1/secret`, `/api/v1/secrets`,
  `/api/secret`, plus legacy `/api/secrets`). Deployed URLs; ADR-001 names them
  the compatibility target. The alias list being written twice —
  `apps/api/src/api-secret-rest.feature.ts:19-55` and
  `platform/app/src/runtime/app/features/secret.ts:44-60` — is real duplication,
  but the two processes differ in security composition and one is not yet
  deployed. Leave it until `apps/api` actually serves traffic.
- **`apps/api/src/features/secret/secret-legacy-rest.ts`**. Its `instanceof`
  ladder at `:74-83` looks like the R6 tell, but it is not re-deriving status from
  a name string — it is deliberately publishing the *older* contract (flat
  `{ error }` body, 400 and 412 both flattened to 422). ADR-001 names that the
  compatibility target. It stays until the family is retired.
- **The four-layer stack.** Every layer holds something. There is no pass-through
  layer to collapse here.

## 5. Cost and order

Six commits, smallest risk first, each green on its own.

1. **P2 — copy.** Add the four codes to `codes.ts` (sorted), write their
   `presentation.ts` entries, delete lines 298-301 of `UNCOPIED_CODES_BACKLOG`.
   No behaviour change; the biggest customer-visible win in the feature.
   *Shares files with every other feature's cleanup — batch it.*
2. **P1 — the composition.** One line in
   `platform/app/src/runtime/app/features/secret.ts`, plus whatever seam
   `createProjectRestApiService` needs to narrow the app. Turns a suite that
   cannot pass into one that does, and un-breaks three deployed URLs.
3. **P3 + P4 — the reserved-name predicate.** One private method, applied in four
   places; split the two spec scenarios and bind each to a test that uses
   production's actual lower-case reserved name.
4. **P5 + P6 + P8 — the dead branches and the commentary.** Adapter to a static
   factory, `database: PrismaClient`, drop `maximumPerProject`, delete the two
   `ctx.actor()` statements, move the two narratives into `adrs/001`, fix the
   false `{@link secrets}`. Delete `ports/__tests__/secret.adapter.unit.test.ts`,
   which pins only the memo. (While here: the three server tests sit under
   `ports/__tests__/` and `app/__tests__/` but cover `services/`, `adapters/` and
   `transport/` — move each beside its subject.)
5. **P7 — one vocabulary.** Use `updateSecretInputSchema.omit({ actorId: true })`
   and `deleteSecretInputSchema` in the tRPC door; rename `secretId` → `id` at
   `platform/app/src/pages/settings/secrets.tsx:79,94`.
6. **P9 — the barrels.** Named exports in both `index.ts` files, limited to the 6
   and 10 symbols with readers. Stops the server package publishing a second,
   colliding `SecretService`.

## 6. Blast radius

**14 non-test files outside the feature import it**, plus 11 test files.

| Where | Files | Symbols |
|---|---:|---|
| `apps/api` | 7 | `SecretApp`, `SecretTrpcApi`, `SecretTrpcContext`, `SecretPublicRestApi`, `SecretService`, `Secret`, `SecretNotFoundError`, `SecretDuplicateError`, `SecretReservedNameError`, `SecretLimitReachedError`, `secretPublicRest`, `toSecretPublic`, `secretPublicCreateInputSchema`, `secretPublicUpdateInputSchema` |
| `platform/app` | 5 | `SecretApp`, `SecretTrpcApi`, `SecretPublicRestApi`, `PostgresSecretAdapter`, `SecretEncryptionPort`, `SecretService` |
| `packages/features/scenario` | 2 | `SecretService` (contract only) |

The named files: `apps/api/src/{api-secret-rest.feature,api.application,api.process}.ts`,
`apps/api/src/app-rest/app-rest.features.ts`,
`apps/api/src/app/{api-production,api-standalone}.composition.ts`,
`apps/api/src/features/secret/secret-legacy-rest.ts`;
`platform/app/src/runtime/app/features/secret.ts`,
`platform/app/src/runtime/app/internal-api/secrets.router.ts`,
`platform/app/src/server/app-layer/{app,dependencies,presets}.ts`;
`packages/features/scenario/server/src/services/{scenario-execution-prefetcher,scenario-target-prefetch}.service.ts`.

One thing the blast radius hides and commit 2 depends on: **`apps/api`'s Secret
doors are not composed in production today.** `ApiProductionComposition` is only
reached when a host supplies `products` (`apps/api/src/app/api-standalone.composition.ts:93-101`),
and nothing calls `startStandaloneApi({ products })`
(`apps/api/src/app/api-standalone.executable.ts:39-41`). The live production path
is entirely platform's: `secretsRouter`, `secretPublicRestApp` and
`createSecretLegacyRestApp`. That is why P1 is a real outage and not a latent one.
