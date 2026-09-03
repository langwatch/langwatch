# model-provider — cleanup review

Audited against [`feature-cleanup-review.md`](../../best_practices/feature-cleanup-review.md)
and [`overengineering.md`](../../best_practices/overengineering.md); shape follows
[`dataset.md`](./dataset.md).

## 1. What is there now

**`packages/features/model-provider/` — 10,610 non-test lines over 62 files, plus a
544 KB model catalogue.**

| Surface | Files | Lines |
|---|---|---|
| `server/src` (non-test) | 33 | 6,595 |
| `server/src/**/__tests__` | 7 | 3,153 |
| `contract/src` (non-test) | 29 | 4,015 |
| `contract/src/catalog/model-catalog{,.overlay}.json` | 2 | 569 KB |

There is **no `web/` package**. `feature.json` is `{"layoutVersion": 0}` and the
feature's eight UI files are still in `platform/app`, recorded as legacy fragments
(`packages/architecture-lint/src/legacy-feature-fragment-baseline.json:320-329`).
Out of scope here.

```
  transport                              25 tRPC procedures · 2 REST apps
  ├── api-trpc/model-provider.api.ts     693 ─┐
  ├── api-trpc/llm-model-cost.api.ts     216  ├─ take ModelProviderApp
  ├── api-trpc/translate.api.ts          120 ─┘
  ├── api-rest/model-provider.api.ts     264 ─┐  take ModelProviderService
  └── api-rest/model-defaults.routes.ts  216 ─┘  ← skips the facade (P3)
        │
  app/model-provider.app.ts              ModelProviderApp     21 members
        │                                   9 stamp the caller · 1 real rule
        │                                   9 bare pass-throughs · 2 getters
        │
  services/model-provider.service.ts     ModelProviderService 28 methods
        │                                   ← 27 are one-line delegations
        │                                   (implements the contract's 28
        │                                    abstract signatures, 1:1)
        │
        ├── query.service            7 ┐
        ├── command.service          4 │
        ├── codex.service            2 │
        ├── costs.service            4 ├─ 27 methods, the real behaviour
        ├── defaults.service         3 │
        ├── defaults-write.service   4 │
        ├── execution.service        1 │
        └── resolution.service       2 ┘
              plus 5 support services: scope 8 · keys 7 · authorization 2
                                       write-authorization 2 · onboarding 1
        │
  ports/model-provider.port.ts       10 abstract classes · 35 abstract signatures
        │                            + 15 CONCRETE methods on ModelProviderCatalog
        │
  repositories/prisma/               3 repositories, 683 lines
        │
  Prisma
```

Wrapped outside by `adapters/postgres.model-provider.adapter.ts` (61 lines,
`create` + `build`) and `platform/app/src/runtime/app/features/model-provider.ts`
→ `AppModelProviderRuntime` (37 lines, `create` + `build`). Getting one service
takes **four constructions**: `AppModelProviderRuntime.create(…).build()` →
`PostgresModelProviderAdapter.create(…).build()` → `ModelProviderService.create(…)`
→ 8 collaborators.

**~30 distinct operations, declared 104 times** (28 contract + 28 service +
21 app + 27 collaborator).

### Detector results

```
no-same-name-delegation-ts   11 hits — all in services/model-provider.service.ts
                                       :168 :172 :176 :183 :190 :198
                                       :210 :214 :218 :224 :246
no-identity-function-ts       0
arrow-property spelling       0  (grepped for `m = (x) => this.y.m(x)`)
comment-block-size            0  over 60 lines; largest block is 33
layer-class                   DOES NOT FIRE — see P1
```

The feature appears in **none** of `overengineering-baseline.json`,
`port-module-baseline.json` or `service-quality-baseline.json`.

## 2. Problems

### P1 — `ModelProviderService` is a layer class the detector cannot see (R3)

`services/model-provider.service.ts:164-315` — **27 of 28 methods are one-line
delegations.** Only `translate` (`:298-315`) holds behaviour.

`layer-class` misses it. The policy counts *same-name* forwards at a 0.6 ratio
(`packages/architecture-lint/src/overengineering.ts:33-34`), and only 12 of the
28 keep their name:

```ts
listForProject(input) { return this.query.listForProject(input); }   // ← counted
getDefaultSnapshot(input) { return this.defaults.getSnapshot(input); }  // ← not
tryGetResolvedDefault(input) { return this.defaults.tryGetResolved(input); } // ← not
```

12/28 = 0.43, under the threshold. The rename is what hides it, and the rename
happened because the repository and the service share method names
(`listForProject` on both `ModelProviderRepository:51` and
`ModelProviderQueryService:32`), which is exactly what the house convention —
repositories `findAll`/`findById`, services `getAll`/`getById` — exists to
prevent.

`isManagedProvider` (`:238-240`) is worse: it reaches past its own collaborators
into `this.options.catalog`, so the class holds a dependency for one forward.

### P2 — Optional `actorId` makes 9 authorization checks skippable, and the two "missing" defaults disagree (R5, security)

`actorId` is `z.string().min(1).optional()` on every write input
(`contract/src/model-provider.ts:119,145,158,170,366,378,386,456,473`). Nine
guards are written `if (actorId)`:

| Site | On missing `actorId` |
|---|---|
| `services/model-provider-command.service.ts:258-260` | write authorization **skipped** |
| `services/model-provider-command.service.ts:116-121` | delete authorization **skipped** |
| `services/model-provider-command.service.ts:158-163` | probe authorization **skipped** |
| `services/model-provider-defaults-write.service.ts:49-53,93-97,119-123,148-152` | default-write authorization **skipped** ×4 |
| `services/model-provider-costs.service.ts:122-124` | cost-scope authorization **skipped** |
| `services/model-provider-defaults.service.ts:156-158` | returns **every** config, unfiltered |
| `services/model-provider-defaults.service.ts:378-380` | returns **no** writable scope |

The last two are in one file, 220 lines apart, and answer the same missing value
in opposite directions — one fails open, one fails closed. Nothing in the types
or the docblocks says which is intended.

This is not theoretical. `transport/api-rest/model-provider.api.ts:177-186` calls
`service.upsert({ projectId, provider, … })` with **no `actorId`**, so the
per-scope check never runs on that route; it is covered today only by the coarse
`requires("project:update")` at `:131` and by the fact that the route never
passes an `id`, so `getExistingProvider` always returns `null`. The guard is one
parameter away from being real, and the type permits omitting it.

### P3 — REST skips the app facade and re-stamps the caller (R3, R7, R8)

`app/model-provider.app.ts:1-25` states the facade's whole reason for existing:

> `modelProvider.*`, `llmModelCost.*` and `translate.*` are all this feature
> answering […] Three descriptions of one composition, agreeing by attention
> rather than by construction

and `:14-17`:

> attributing a write to its caller. Eleven handlers stamped it for themselves
> […] which is exactly the kind of detail a transport should never be trusted to
> get right twice

Both REST apps take the raw service instead:

- `transport/api-rest/model-defaults.api.ts:25` — `modelProviders: () => ModelProviderService`
- `transport/api-rest/model-provider.api.ts` — same, via `apps/api/src/app-rest/app-rest.features.ts:481-489`

and stamp the caller by hand at `transport/api-rest/model-defaults.routes.ts:68,
130,170,203`. So the fifth door does precisely what the facade's docblock says
no door does any more. The comment is not true of the code.

### P4 — One REST handler downgrades every handled error to 400 (R6)

`transport/api-rest/model-provider.api.ts:187-192`:

```ts
} catch (error) {
  if (error instanceof Error) {
    throw new HTTPException(400, { message: error.message });
  }
```

`HandledError` extends `Error` (`packages/handled-error/src/handled-error.ts:60`),
so this catches every typed error the service throws and **discards its status**:
`ModelProviderRoutingHandleTakenError` (409) → 400,
`ModelProviderScopeForbiddenError` (403) → 400, `ModelProviderNotFoundError`
(404) → 400. It also puts `error.message` on the wire, which for a plain `Error`
is internal prose — `Model Provider repository requires a Prisma database
adapter` (`repositories/prisma/prisma.model-provider.repository.ts:54`) reaches
an API client verbatim.

Its sibling gets it right: `transport/api-rest/model-defaults.routes.ts:33-38`
checks `HandledError.isHandled(err)` first, then collapses the rest to 400 — same
`err.message` leak, but the statuses survive. Two REST files in one directory,
two answers.

### P5 — Three of 19 error codes reach the customer as a bare slug (R6)

`contract/src/model-provider.errors.ts` is otherwise exemplary: **19 classes,
19 `HandledError`**. Three of their codes are in neither `codes.ts` nor
`presentation.ts`:

| Code | Declared | Throw sites |
|---|---|---|
| `model_provider_invalid` | `model-provider.errors.ts:143` | **14** |
| `model_default_not_found` | `model-provider.errors.ts:276` | 4 |
| `model_cost_not_found` | `model-provider.errors.ts:336` | 3 |

They sit on the frozen backlog at
`platform/app/src/features/errors/logic/__tests__/codes.unit.test.ts:284-286`,
whose own docblock (`:243-257`) calls the list "debt, not exemptions — each is a
real code a customer can reach today as a bare slug". `model_provider_invalid`
is the most-thrown code in the feature, and it is the one a customer reads as
the literal string `model_provider_invalid`.

### P6 — 12 plain `Error` throws for failures we can name (R6)

```
services/model-provider-execution.service.ts:99   "…cannot run workflows, evaluations or the playground."
adapters/model-provider-execution.adapter.ts:42   "Embeddings provider not set"
adapters/model-provider-execution.adapter.ts:47   "Embeddings model provider … not found"
adapters/model-provider-execution.adapter.ts:50   "Embeddings model provider … is not enabled"
services/model-provider-scope.service.ts:134      "At least one Model Provider scope is required"
services/model-provider-scope.service.ts:145      "Model Provider scopes must belong to one organization"
services/model-provider-keys.service.ts:152       "Unknown model provider: …"
```

Every one names a cause and a caller action, and each is written as customer
prose — `execution.service.ts:99` even interpolates the shared
`CODING_ASSISTANT_SURFACES_ONLY_NEEDLE` copy string. They degrade to "unknown"
plus a trace id, or, through P4, to a 400 carrying that prose raw. The five
remaining (`prisma.*.repository.ts:21,29,54,270` and `translate.api.ts:98`) are
correctly plain — composition and build-time mistakes. `translate.api.ts:94-98`
even explains why, and is right to.

### P7 — `ports/model-provider.port.ts` is ten boundaries in one file, one of them a base class (R4, R8)

306 lines, **10 exported abstract classes, 35 abstract signatures**. Exactly one
is named `*Port` — `ModelTranslationPort:294`. That single name is what carries
the file past `strict-port-module`
(`packages/architecture-lint/src/port-modules.ts:70-89`: the rule requires *at
least one* `Port`-named export and that every `Port`-named export be an abstract
class). The other nine boundaries dodge the convention by not using the word.

`ModelProviderCatalog:142-292` is not a port at all. It has 3 abstract methods and
**15 concrete ones**, imports 15 symbols of contract logic, and throws a domain
error from inside the ports directory:

```ts
// ports/model-provider.port.ts:235
throw new ModelDefaultValidationError(
  `"${value}" ${CODING_ASSISTANT_SURFACES_ONLY_NEEDLE} and cannot be set for "${key}".`,
);
```

Model validation, alias expansion, cost rates, routing-handle normalisation and
config sanitisation are feature rules living in the seam that is supposed to
have none. `AppModelProviderCatalog`
(`platform/app/src/runtime/app/features/model-provider.ts:35-137`) overrides 5
of the 18 members; the other 13 are shared implementation nobody can substitute.

### P8 — `ModelProviderCredentialPolicy` is a seam to nowhere (R4)

Its only implementation is `ModelProviderKeysService`
(`services/model-provider-keys.service.ts:14`) — same package, and a *service*
extending a *port*. `adapters/postgres.model-provider.adapter.ts:50` hardcodes
`ModelProviderKeysService.create()`, so nothing can swap it. The port adds an
8-method restatement of a class that sits two directories away.

The other nine boundaries are fine: six have their only implementation in
`platform/app` (a real inversion), three are repositories.

### P9 — `database: object` plus a runtime throw, and a dependency nobody wires (R5)

Three repositories erase the type and re-derive it at runtime:

```ts
// repositories/prisma/prisma.model-provider.repository.ts:49-58
static create(database: object, credentials: ModelProviderCredentialCodec) {
  if (!isModelProviderDatabase(database)) {
    throw new Error("Model Provider repository requires a Prisma database adapter");
  }
```

Same at `prisma.model-cost.repository.ts:19-21` and
`prisma.model-default.repository.ts:27-29`, and the shape propagates up through
`adapters/postgres.model-provider.adapter.ts:20`. ADR-001 asks for "an opaque
database object", which a structural `Pick<PrismaClient, "modelProvider" |
"gatewayChangeEvent" | "$transaction">` — the type the file *already declares* at
`prisma.model-provider.repository.ts:19-22` — satisfies while staying
compile-checked. Both composition roots pass `PrismaClient`
(`presets.ts:1237`, `presets.ts:3126`).

Separately, `modelClient?: ModelClientConfig`
(`platform/app/src/runtime/app/features/model-provider.ts:250`) is passed by
**neither** composition root, so `AppModelTranslation` always receives
`undefined` and `executionProxyUrl` / `codexGatewayUrl` are permanently unset on
the translate path (`:230-231`).

### P10 — The same helper written twice, and the same lookup three times (R8)

- **Permission mapper.** `services/model-provider-authorization.service.ts:47-57`
  (`writePermission`) and `services/model-provider-write-authorization.service.ts:68-79`
  (`requiredPermission`) are byte-identical bodies with the same return type.
  The classes around them are the same too: `canWrite` (`authorization:23-32`)
  and `canManageScope` (`write-authorization:53-66`) issue the identical
  `authz.getDecision` call. Two classes, one wrapping of `AuthzService`.
- **Onboarding-plan filter.** `ports/model-provider.port.ts:202-209` and
  `services/model-provider-onboarding-defaults.service.ts:27-32` are the same
  four lines over `buildProviderOnboardingDefaultPlan`.
- **Provider-definition lookup.** The contract already exports
  `tryGetModelProviderDefinition` (`contract/src/model-provider-registry.ts:296`).
  `services/model-provider-keys.service.ts:148-156` rewrites it as
  `providerDefinition`, and `adapters/legacy-model-provider.adapter.ts:317-318`
  rewrites it again as a linear `Object.entries(…).find(…)` scan.
- **Candidate merge.** `services/model-provider-query.service.ts:37-44` and
  `:63-70` are the same eight-line saved/system merge.

### P11 — The package reaches into `process.env`, against its own port's docblock (R7, boundary)

`ports/model-provider.port.ts:266-269`:

> Reads a provider execution value from its stored credentials or injected
> process configuration. **The package never reaches into environment state.**

`adapters/legacy-model-provider.adapter.ts:309-315`:

```ts
const getModelOrDefaultEnvKey = (modelProvider, envKey) =>
  (typeof storedValue === "string" ? storedValue : "") || process.env[envKey];
```

`prepareEnvKeys` (`:320-342`) uses it to assemble provider credentials from the
environment, which is the exact job `ModelProviderCatalog.tryGetExecutionValue`
exists to keep outside the package —
`AppModelProviderCatalog.tryGetExecutionValue`
(`platform/app/src/runtime/app/features/model-provider.ts:108-118`) is the
injected version of the same read. One of the two is the bug; the comment is
currently the lie.

### P12 — Parameters declared and dropped (R5)

- `adapters/legacy-model-provider.adapter.ts:351-362` — `prepareLitellmParams`
  takes `_managedProviders: unknown` and a `modelProvider` field it never
  destructures. The docblock (`:344-350`) is honest that the first is dead; the
  second is not mentioned.
- `adapters/model-provider-execution.adapter.ts:55-64` — the other
  `prepareLitellmParams` takes `modelProvider` and drops it.
- `repositories/prisma/prisma.model-provider.repository.ts:150-162` — `delete`
  accepts `organizationId` and `projectId` and **uses neither**; it deletes by
  `id` alone. `ModelProviderRepository.delete` (`ports:55-59`) declares a
  tenancy narrowing the implementation does not apply. It is safe today only
  because `command.service.ts:104-126` does a scoped find first.
- `services/model-provider-query.service.ts:302-304` — `getProjectScopeChain`
  is a private one-line delegation with one caller (`:130`).

### P13 — The layer that needs explaining has none; the layer that has explaining needs less (R7, both ways)

The feature's 10% comment density is an average of two extremes:

```
  0%   services/model-provider-defaults.service.ts        494 lines
  0%   services/model-provider-command.service.ts         470
  0%   repositories/prisma/prisma.model-provider.repository.ts  376
  0%   services/model-provider-query.service.ts           306
  0%   services/model-provider-resolution.service.ts      238
  …
 35%   app/model-provider.app.ts                          296
 39%   transport/api-trpc/model-provider.api.ts           693
 42%   transport/api-trpc/translate.api.ts                120
```

**15 files / 3,074 lines carry exactly zero comment lines**, and they are the
whole service and repository layer. What is undocumented there is not obvious:

- `services/model-provider-query.service.ts:251-300` — `compareProjectProviders`
  and `scopeSpecificity` decide which of several provider rows a project sees,
  by enabled-ness, then scope narrowness (PROJECT 3 / TEAM 2 / ORGANIZATION 1),
  then `fallbackPriorityGlobal`, then `createdAt`. Four tiebreakers, no note.
- `services/model-provider-keys.service.ts:38-60` — `merge` decides which stored
  secrets survive an edit. The `isSecretCredentialField(key) && value !== "" &&
  value != null` branch at `:56` is the rule that stops a partial form submit
  wiping a stored key. Unexplained.
- `services/model-provider-keys.service.ts:120-141` — `mergeHeaders` falls back
  to matching a masked header **by array position** when the key changed. That
  is surprising and load-bearing; nothing says why.
- `services/model-provider-execution.service.ts:153-180` — `addGeminiParameters`
  switches between `storedExecutionValue` and `executionValue` depending on
  whether the API key came from storage, so a stored key is never paired with an
  environment project id. That is a credential-mixing guard with no comment.
- `services/model-provider-defaults.service.ts:156-158` vs `:378-380` — P2's
  opposite defaults.

The transports and the app, by contrast, are genuinely well documented and
should not be trimmed; `comment-block-size` finds nothing over 60 lines here.

### P14 — Two rotted paths (R7)

- `transport/api-rest/model-defaults.api.ts:14-16` — "both call the same service
  layer in `platform/app/src/server/modelProviders/modelDefaults.{read,service}.ts`".
  Neither file exists.
- `adrs/001-model-provider-service-boundary.md` — "`ModelProviderTrpcApi` […]
  live in `server/src/api/app-trpc/`". They live in `server/src/transport/api-trpc/`.

### P15 — Both index files publish more than anyone imports (R8)

`server/src/index.ts` exports 36 symbols. Ten have **zero** consumers outside the
package: `toLegacyExecutionProvider`, `toLegacyProviderSummary`,
`listProjectModelProvidersForFrontend`, `ModelProviderCredentialPolicy`,
`ModelProviderAppDependencies`, `ModelProviderCaller`, `SpanReader`,
`PostgresModelProviderAdapterOptions`, `ModelProviderTrpcContext`,
`LlmModelCostTrpcContext`.

`contract/src/index.ts` is 28 `export *` lines and publishes the whole surface,
including the catalogue internals.

## 3. What it should look like

```
contract/src/
  model-provider.service.ts       split 28 signatures into three:
                                  ModelProviderService (12) ·
                                  ModelDefaultService (9) · ModelCostService (4)
  model-provider.errors.ts        unchanged — 19/19 HandledError
  model-provider-registry.ts      unchanged — 16 providers, one entry each
  catalog/                        unchanged
  index.ts                 ~35    named exports, not 28 × `export *`

server/src/
  app/model-provider.app.ts      ~230   the ONE class every door calls, REST included
  services/
    model-provider.service.ts    ~330   ← was query.service; the reads
    model-provider-command.service.ts     470   unchanged
    model-provider-default.service.ts     ~640  defaults + defaults-write merged
    model-provider-cost.service.ts        145   unchanged
    model-provider-execution.service.ts   306   unchanged
    model-provider-resolution.service.ts  238   unchanged
    model-provider-codex.service.ts        92   unchanged
    model-provider-scope.service.ts       ~215  + getOrganizationIdForScope users
    model-provider-authorization.service.ts ~95 read + write, ONE permission map
    model-provider-credential.service.ts  ~160  was keys.service, no longer a port
  ports/
    model-provider-catalog.port.ts        ~40   3 abstract methods, nothing else
    model-provider-credential-codec.port.ts ~8
    codex-token-refresher.port.ts          ~10
    model-provider-connection-limiter.port.ts ~6
    model-translation.port.ts              ~10
    model-provider-id.port.ts               ~6
  repositories/
    model-provider.repository.ts   model-default.repository.ts
    model-cost.repository.ts       prisma/prisma.*.repository.ts   (unchanged)
  utils/
    model-provider-catalog-rules.ts ~180  what came OUT of ModelProviderCatalog
    resolve-max-tokens-ceiling.ts    22   moved from adapters/
  adapters/legacy-model-provider.adapter.ts  ~340
  transport/                                  unchanged in shape
```

**Deleted:** `services/model-provider.service.ts` (the 28-method layer),
`services/model-provider-write-authorization.service.ts` (merged),
`services/model-provider-defaults-scopes.service.ts` (15 lines, one caller →
private method), `adapters/postgres.model-provider.adapter.ts`,
`platform/app/…/AppModelProviderRuntime`, and
`ModelProviderCredentialPolicy`.

**≈28 server files, ≈5,600 lines. Two hops from a transport to a repository
instead of four.**

### The facade absorbs the layer

`ModelProviderApp` already holds the composition rule the doors need (caller
attribution) and is R3-exempt. It should hold the eight collaborators directly,
which removes the 28-method restatement between it and them:

```ts
export class ModelProviderApp {
  static create(options: {
    database: Pick<PrismaClient, "modelProvider" | "gatewayChangeEvent" | "$transaction">;
    catalog: ModelProviderCatalogPort;
    credentials: ModelProviderCredentialCodecPort;
    codexTokens: CodexTokenRefresherPort;
    connectionLimiter: ModelProviderConnectionLimiterPort;
    translation: ModelTranslationPort;
    ids: ModelProviderIdPort;
    authorization: AuthzService;
    projects: ProjectService;
    organizations: OrganizationService;
    spans: SpanReader;
  }): ModelProviderApp;

  /** Every write takes its caller. There is no unattributed overload. */
  upsert(input: ModelProviderWrite, by: ModelProviderCaller): Promise<ModelProvider>;
  delete(input: ModelProviderDelete, by: ModelProviderCaller): Promise<void>;
  …
}
```

`PostgresModelProviderAdapter` and `AppModelProviderRuntime` become the
`ModelProviderApp.create({…})` call in `presets.ts:1236`. Both REST apps take
`ModelProviderApp` and stop stamping `actorId` themselves, which is what makes
the facade's docblock true.

### `actorId` becomes a required caller

The nine `if (actorId)` guards exist to let internal callers skip authorization.
Say that in the type rather than in an absent value:

```ts
export type ModelProviderActor =
  | { kind: "user"; id: string }
  | { kind: "system"; reason: string };   // seeding, migrations, the gateway

// services/model-provider-command.service.ts
private async authorizeWrite(actor: ModelProviderActor, scopes: ModelDefaultScope[]) {
  if (actor.kind === "system") return;           // ← deliberate, greppable, one place
  await this.writeAuthorization.assertCanWrite(actor.id, scopes);
}
```

Nine implicit skips become one explicit branch with a stated reason, the
fail-open read at `defaults.service.ts:156` has to declare which kind it is
serving, and `model-provider.api.ts:177` cannot compile without answering the
question.

### `ModelProviderCatalog` splits into a port and a rules module

The 15 concrete methods are contract logic, not a seam. They move to
`utils/model-provider-catalog-rules.ts` as free functions — pure, no
dependencies, used by more than one caller, which is what R2 allows — and the
port keeps only what the process must supply:

```ts
export abstract class ModelProviderCatalogPort {
  abstract systemProviders(input: {
    projectId?: string; organizationId?: string; referenceCreatedAt: Date;
  }): Promise<ModelProviderSummary[]>;
  abstract validateApiKey(provider: string, keys: Record<string, unknown>):
    Promise<ModelProviderApiKeyValidation>;
  abstract tryGetExecutionValue(input: {
    customKeys: Record<string, unknown> | null; key: string;
  }): string | null;
  abstract isManagedProvider(organizationId: string, provider: string): boolean;
  abstract prepareExecution(input: { … }): Promise<Record<string, string>>;
}
```

Five abstract methods, one implementation in `platform/app` — a real inversion.
`sanitizeDefaultConfig`, `tryNormalizeDefaultModel`, `metadata`,
`staticCostRates`, `defaultFeatures`, `tryGetProviderDeprecation`,
`tryNormalizeRoutingHandle`, `tryGetRoutingHandleProblem`,
`inferredDefaultsForProvider` and the three execution-definition readers become
importable functions, and the `ModelDefaultValidationError` throw stops coming
out of `ports/`.

### The REST error path stops re-deriving statuses

```ts
// transport/api-rest/model-provider.api.ts — replaces :187-192
// createServiceApp's onError serialises a HandledError with its own status,
// code and customer-safe message. Nothing here re-derives either.
await service.upsert({ … }, actor);
```

Deleting the catch is the fix. `model-defaults.routes.ts:26-38` loses its
`err.message` branch the same way, once P6's seven plain `Error`s are typed.

## 4. Keep list

- **The provider registry is an open set, and it is correct.**
  `contract/src/model-provider-registry.ts:79-294` holds **16 providers** —
  `custom`, `openai_codex`, `openai`, `anthropic`, `gemini`,
  `google_agent_platform`, `elevenlabs`, `azure`, `bedrock`, `vertex_ai`,
  `deepseek`, `xai`, `cerebras`, `groq`, `voyage`, `azure_safety` — as one
  `satisfies Record<string, ModelProviderDefinition>` object. A seventeenth
  provider is one entry: a name, a type, an `apiKey`, a Zod `keysSchema`, an
  `enabledSince`. No other file changes. **Do not collapse it, do not "simplify"
  it into a smaller union, and do not fold `azure_safety` into `azure` because
  it is `type: "safety"`.** This is the shape `overengineering.md` names as
  correct, done as a declarative table rather than sixteen files — which is
  better, because the members are data, not behaviour.
- **The error contract.** 19 classes, **19 `HandledError`**
  (`contract/src/model-provider.errors.ts`). No `Record<name, {status, code}>`
  map, no `instanceof` ladder in any router. Sixteen of the nineteen already
  have copy. This is the shape the dataset review had to argue for; here it is
  already built, and P5 is three missing registry entries, not a redesign.
- **`services/model-provider-query.service.ts`.** 306 lines, one public read
  surface, everything else private, correct masking through
  `credentialPolicy.tryMask` / `maskHeaders` at `:207-208`. It needs comments
  (P13), not surgery.
- **`services/model-provider-execution.service.ts:137-233`** — the per-provider
  parameter builders for Vertex, Gemini, Bedrock and Azure. Each is an early-return
  guard on one provider key. This is the open set again, and the credential
  handling inside `addGeminiParameters` is deliberate. Leave the structure.
- **The transports' documentation.** `api-trpc/model-provider.api.ts:1-32`,
  `api-trpc/translate.api.ts:86-107` and `app/model-provider.app.ts:135-151`
  explain decisions a reader cannot recover from the code — why the policy is
  applied after `.input()`, why `providerService` is an accessor rather than a
  generic wrapper, why a missing feature-registry entry stays a plain `Error`.
  P13 is about the *services*, not these.
- **`toLegacyExecutionProvider` / `toLegacyProviderSummary`**
  (`adapters/legacy-model-provider.adapter.ts:152-164`). Two one-line functions
  with identical bodies, kept apart so a decrypted `ModelProviderExecution` and a
  masked `ModelProviderSummary` cannot be swapped at a call site. The docblock at
  `:10-15` says exactly that. Merging them to remove a duplicate line would
  remove the only thing stopping a decrypted key reaching a browser response.
- **The six ports whose implementation lives in `platform/app`** —
  `ModelProviderCredentialCodec`, `CodexTokenRefresher`,
  `ModelProviderConnectionRateLimiter`, `ModelTranslationPort`,
  `ModelProviderIdService`, and the catalog once P7 narrows it. Cross-package
  inversions; R4 keeps them.
- **`contract/src/catalog/`** — 544 KB of generated model data behind 13 typed
  readers. Not this review's business.
- **R1 is already clean.** No `PrismaClient`, `$transaction` or ClickHouse client
  appears anywhere in `services/`, `app/` or `transport/`. Nothing to do.

## 5. Cost and order

Five commits, smallest risk first, each leaving the suite green.

1. **Register the three error codes.** Add `model_provider_invalid`,
   `model_default_not_found`, `model_cost_not_found` to
   `platform/app/src/features/errors/logic/codes.ts` (sorted) and write their
   `presentation.ts` entries; remove them from `UNCOPIED_CODES_BACKLOG`. Fix the
   REST catch at `model-provider.api.ts:187-192`. Convert the seven plain
   `Error`s from P6. No structural change, and the highest customer-visible
   return in the feature. *(P4, P5, P6)*
2. **Make the caller explicit.** Introduce `ModelProviderActor`, replace the
   nine `if (actorId)` guards with one `kind === "system"` branch, and give
   `defaults.service.ts:156` a stated direction. Point both REST apps at
   `ModelProviderApp` and delete the four hand-stamps in
   `model-defaults.routes.ts`. *(P2, P3)*
3. **Split the port file.** `ModelProviderCatalog`'s 15 concrete methods →
   `utils/model-provider-catalog-rules.ts`; the ten classes → six `*.port.ts`
   files named for what they are; delete `ModelProviderCredentialPolicy` and let
   `ModelProviderCredentialService` stand alone. Add
   `packages/features/model-provider/server/src/ports/*.port.ts` entries as they
   land — the baseline may only shrink, so each new file must already comply.
   *(P7, P8)*
4. **Collapse the layer.** Delete `services/model-provider.service.ts`, move its
   composition into `ModelProviderApp`, delete
   `adapters/postgres.model-provider.adapter.ts` and `AppModelProviderRuntime`,
   and give the repositories their structural `Pick<PrismaClient, …>` type back.
   Drop the unwired `modelClient` option and the dead parameters from P12.
   *(P1, P9, P12)*
5. **De-duplicate and document.** One permission mapper, one onboarding-plan
   filter, one `tryGetModelProviderDefinition`; merge the two authorization
   services; `resolve-max-tokens-ceiling` → `utils/`; fold
   `model-provider-defaults-scopes.service.ts` into its one caller. Write the
   five explanations P13 names, fix the two rotted paths, and trim both
   `index.ts` files to what is imported. *(P10, P11, P13, P14, P15)*

Commit 4 is the only one that moves a public symbol; everything before it is
internal or additive.

## 6. Blast radius

**22 files outside the feature import `@langwatch/model-provider-server`**
(15 source, 7 test). By symbol:

| Symbol | Files |
|---|---|
| `getProjectModelProviders` | 7 |
| `prepareLitellmParams`, `LegacyModelProviderExecution` | 3 each |
| `ModelProviderApp`, `resolveMaxTokensCeiling` | 2 each |
| `PostgresModelProviderAdapter`, `ModelProviderCatalog`, `ModelProviderCredentialCodec`, `ModelProviderConnectionRateLimiter`, `ModelProviderIdService`, `ModelTranslationPort`, `CodexTokenRefresher` | 1 each — all in `platform/app/src/runtime/app/features/model-provider.ts` |
| `createModelProvidersRestApp`, `createModelDefaultsRestApp` | 1 each — `apps/api/src/app-rest/app-rest.features.ts:481-489`, re-exported at `apps/api/src/index.ts:176-177` |
| `ModelProviderTrpcApi`, `LlmModelCostTrpcApi`, `TranslateTrpcApi` + its 2 types | 1 each — `platform/app/src/runtime/app/internal-api/model-provider.router.ts`, `apps/api/src/features/model-provider/translate-trpc.mount.ts` |
| `ModelProviderExecutionAdapter` | 1 — `platform/app/src/runtime/app/features/topic.ts` |
| `ModelProviderKeysService`, `prepareEnvKeys`, `getProjectModelProvidersForFrontend`, `getModelMetadataForFrontend`, `mergeCustomModelMetadata`, `listOrgModelProvidersForFrontend` | 1 each |

Commits 1–3 and 5 touch none of these except the two `index.ts` trims (which
only remove symbols nothing imports). Commit 4 removes
`PostgresModelProviderAdapter` and rewrites one call site,
`platform/app/src/server/app-layer/presets.ts:1236` and `:3125`.

`@langwatch/model-provider-contract` is imported far more widely and this review
proposes no change to it beyond `index.ts` and the optional service split, which
is commit 5 and can be dropped without cost to the rest.
