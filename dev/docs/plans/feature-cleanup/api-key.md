# api-key — cleanup review

Audited against [`feature-cleanup-review.md`](../../best_practices/feature-cleanup-review.md),
shaped after [`dataset.md`](./dataset.md).

## 1. What is there now

**5,066 lines across 32 non-test source files** (server 24 / 4,102; contract 8 / 964),
plus 2,887 lines of tests. No `web` sub-package — the feature's UI and two server
modules still sit in `platform/app`, baselined as legacy fragments
(`packages/architecture-lint/src/legacy-feature-fragment-baseline.json:18-31`).

**36 real operations, declared 98 times** across the contract, the facade, the app
and the sub-services.

```
  transport/api-trpc/api-key.api.ts   ApiKeyTrpcApi         9 procedures
        │
  app/api-key.app.ts                  ApiKeyApp             9 methods + 1 getter   ← holds real rules
        │
        │        transport/api-rest/api-key.api.ts   5 routes ──┐  DOES NOT enter ApiKeyApp
        ▼                                                       │
  @langwatch/api-key-contract                                   │
    api-key.service.ts   abstract ApiKeyService   31 signatures ◄┘
        │
  services/api-key.service.ts   ApiKeyService     31 methods   ← 30 one-line pass-throughs
        │
        ├─ api-key-lifecycle.service.ts          3 public  (+2 private)   265 lines
        ├─ api-key-catalog.service.ts           12 public  (+2 private)   228
        ├─ api-key-grant-policy.service.ts       9 public  (+2 private)   317
        ├─ api-key-token-resolution.service.ts   4 public  (+3 private)   186
        ├─ api-key-cli.service.ts                5 public  (+1 private)   264
        ├─ api-key-enrichment.service.ts         2 public                 139
        └─ api-key-visibility.service.ts         1 public                 100
        │
  ports/  ApiKeyTokenPort (5) · ApiKeyBindingIdPort (1) · ApiKeyDiagnosticsPort (1)
  repositories/api-key.repository.ts   ApiKeyRepository   16 signatures
        │
  repositories/prisma/prisma.api-key.repository.ts   16 methods
```

Wrapped outside by two pure-wiring classes: `adapters/postgres.api-key.adapter.ts`
(52 lines, one `build()`) and `platform/app/src/runtime/app/features/api-key.ts`
→ `AppApiKeyRuntime` (41 of 69 lines, one `build()` whose only contribution is
`bindingIds`).

**Five layers between a tRPC procedure and a Prisma call; one of them
(`services/api-key.service.ts`) adds nothing at all, and the REST door skips two
of them.**

The good news first: **R1 is clean.** No `PrismaClient`, `Prisma.TransactionClient`
or raw SQL exists above `repositories/prisma/` — grep over `server/src` outside
`repositories/prisma` and `adapters/postgres` returns nothing. All ten error codes
are `HandledError` subclasses and all ten are present in both
`platform/app/src/features/errors/logic/codes.ts` and `presentation.ts`. And
**R5 is clean**: both compositions (`presets.ts:1267-1277` and `presets.ts:3164-3173`)
pass every dependency; there is not one optional collaborator or one
"not configured" throw in the feature.

## 2. Problems

### P1 — `services/api-key.service.ts` is a 264-line facade with no rules of its own (breaks R3)

31 methods; 30 of them are one-line delegations to one of the seven sub-services
the constructor builds at `api-key.service.ts:70-76`. The 31st, `markUsed`
(`api-key.service.ts:115-117`), delegates to the repository. Zero decisions live
in this class.

```ts
// api-key.service.ts:158-160, and 29 more exactly like it
async tryGetById(input: { id: string }): Promise<ApiKey | null> {
  return this.catalog.tryGetById(input);
}
```

R3 allows exactly one facade, `app/api-key.app.ts`. This is a second one
underneath it, and it exists only because the contract declares all 31 operations
on a single abstract class (`contract/src/api-key.service.ts:51-125`).

The cost is paid twice more:

- Every method re-writes its input shape inline even though the contract already
  names it. `api-key.service.ts:162-167` spells out `{ id; organizationId;
  callerUserId; callerCanReadAnyKey }`, which is `ApiKeyCallerReadInput`
  (`contract/src/api-key.service.ts:43-48`). Nine of the named input types in
  the contract have zero users.
- A test that exercises four methods must stub thirty-one:
  `transport/api-rest/__tests__/support/test-api-key-service.ts:7-39`, one
  `unsupported<…>()` line per operation.

### P2 — The REST family goes around `ApiKeyApp`, and the two doors disagree (breaks R3, R8)

`app/api-key.app.ts:1-29` says the app is "the one typed thing a transport is
given". The tRPC transport obeys (`transport/api-trpc/api-key.api.ts:51`,
`app: Readonly<{ apiKeys: ApiKeyApp }>`). The REST transport does not: it takes
`apiKeys: () => ApiKeyService` (`transport/api-rest/api-key.api.ts:330`) and calls
the service directly at lines 380-381, 422, 463, 511, 544 and 572.

So the mint rules exist twice and are not the same rules:

| | `ApiKeyApp.createKey` | REST `POST /` |
|---|---|---|
| membership proof | `ensureMember` first, `api-key.app.ts:253` | none |
| owner resolution | `api-key.app.ts:264` | `resolveKeyOwner`, `api-key.api.ts:217-225` |
| admin refusal | `ApiKeyAdminRequiredError`, `api-key.app.ts:258` | `c.json({error:"Forbidden"},403)`, `api-key.api.ts:307-313` |
| refusal cases | 2 (`create-service-key`, `assign-to-another-user`) | 3 — adds "keys that no member owns", `api-key.api.ts:266` |

`refuseNonAdminPrivilegedMint` (`api-key.api.ts:282-314`), `privilegedMintRefusal`
(254-267), `resolveKeyOwner` (217-225) and `requestedBindings` (233-252) are
120 lines of application rule sitting in a transport, and the third refusal case
has no counterpart on the tRPC side at all. That is exactly the divergence the
one-facade rule exists to prevent.

### P3 — The Prisma repository keeps a second, stale copy of `HIDDEN_SYSTEM_KEY_NAMES` (breaks R8) — security-relevant

`repositories/prisma/prisma.api-key.repository.ts:9`:

```ts
const HIDDEN_SYSTEM_KEY_NAMES = ["Langy session"] as const;
```

The contract's list (`contract/src/api-key.names.ts:26-29`) has **two** entries:
`"Langy session"` and `"Agent sandbox run"`. The local copy is missing the second
one, and it is what both customer listings filter on
(`prisma.api-key.repository.ts:71` and `:83`).

The contract states in the same file what that list means
(`api-key.names.ts:11-25`): *"System-managed keys are hidden from customer
listings… THIS IS ALSO A TENANT-ISOLATION BOUNDARY, not merely a UI filter."*
`platform/app/src/utils/dbOrganizationIdProtection.ts:90` imports the contract
list to decide which rows may be swept without an `organizationId`.

Consequence, traced end to end:

- `platform/app/src/server/api-key/agent-sandbox-key.ts:50,57,63` mints the key
  with `name: AGENT_SANDBOX_API_KEY_NAME`, `userId: null`, no `ingestSourceType`.
- `listForUser` (`prisma.api-key.repository.ts:72`) matches on
  `OR: [{ userId }, { userId: null, ingestSourceType: null }]`, and its `notIn`
  does not exclude that name.
- So an unexpired sandbox key appears in **every organization member's** API-key
  list, and in the admin/org-wide list via `listForOrganization`.
- The service layer, which does use the contract list
  (`services/api-key-catalog.service.ts:16`, `services/api-key-lifecycle.service.ts:23`),
  then refuses to let anyone read, rename or revoke it
  (`api-key-catalog.service.ts:55`, `api-key-lifecycle.service.ts:186`): the row
  is visible and undeletable.

No secret leaks — the listings return no token and `ApiKeyApp.listKeys` truncates
the lookup id to five characters (`api-key.app.ts:203`) — but this is precisely
the drift the contract comment warns against, and the fix is one import.

### P4 — `ApiKeyScopeViolationError`: thirteen distinct causes, one code, no `meta` (breaks R6)

`contract/src/api-key.errors.ts:87-97` takes a free-form `message` and no `meta`.
It is thrown thirteen times for thirteen different reasons:

| Site | Cause |
|---|---|
| `api-key-grant-policy.service.ts:34` | not a member of the organization |
| `:91`, `:96`, `:101` | the three restricted-mode rules |
| `:109` | permission string is not `resource:action` |
| `:132` | personal-workspace scope granted to a non-owner |
| `:145` | organization scope does not match the key's organization |
| `:158` | team not found in this organization |
| `:166` | project not found or archived |
| `:199` | permission beyond the owner's ceiling |
| `:244` | CUSTOM role without a `customRoleId` |
| `:256` | custom role missing or malformed |
| `api-key-lifecycle.service.ts:79` | a personal key with no binding |

Since #5984 the wire message for a handled error is the code slug, so all thirteen
reach the customer as the single registry line
(`platform/app/src/features/errors/logic/presentation.ts:684-687`):

> **This API key can't do that** — It doesn't include the required scope.

That sentence is wrong for at least nine of the thirteen. None of them carries
`meta`, so the client cannot even name the offending permission, team or project.
Compare `ApiKeyPermissionDeniedError` (`api-key.errors.ts:99-118`), which does it
properly: `meta`, `tips`, `docsUrl`.

### P5 — Two hand-rolled `c.json({ error: "Forbidden" }, 403)` in a Hono route (breaks R6)

`transport/api-rest/api-key.api.ts:307-313` and `:368-375`. Both are knowable,
actionable refusals — "you are not an organization admin" — expressed as a raw
JSON body that bypasses the handled-error contract the family's own `onError`
installs three lines earlier (`api-key.api.ts:340-346`). The first duplicates
`ApiKeyAdminRequiredError` (`contract/src/api-key.errors.ts:25-42`), which already
exists and is already in the presentation registry.

### P6 — The default CLI permission set is derived twice, differently (breaks R8)

The contract owns it (`contract/src/api-key.permissions.ts:280-289`):

```ts
export const CLI_KEY_DEFAULT_EXCLUDED_PERMISSIONS = ["organization:manage", "organization:delete", "team:manage"];
export function defaultCliKeyPermissions(): AuthzPermission[] {
  const excluded = new Set(CLI_KEY_DEFAULT_EXCLUDED_PERMISSIONS);
  return categorizablePermissions().filter((p) => !excluded.has(p));   // platform tier already stripped
}
```

`services/api-key-cli.service.ts:87-92` re-derives it from `ALL_PERMISSIONS` with
the three names written out as a literal, and writes the same literal again at
`:65-67`:

```ts
const defaults = ALL_PERMISSIONS.filter(
  (permission) => !["organization:manage", "organization:delete", "team:manage"].includes(permission),
) as AuthzPermission[];
```

The two lists are not equal. `categorizablePermissions()`
(`api-key.permissions.ts:273-278`) drops every resource whose registry `scopes`
include `"platform"`; `ALL_PERMISSIONS` does not. The `ops` resource is exactly
that (`packages/features/authz/contract/src/registry.ts:99-104`,
`scopes: ["platform"]`), so the server's org-admin default carries `ops:view`
and `ops:manage`, which `ORG_ADMIN` does not hold
(`packages/features/authz/contract/src/roles.ts:139-169`) and which
`assertCeiling` (`api-key-grant-policy.service.ts:191-203`) therefore has to
refuse. Everything else in the repo uses the contract helper: the CLI approval
screen (`platform/app/src/pages/cli/auth.tsx:440`) and the pinned integration
expectation (`platform/app/src/server/routes/__tests__/auth-cli-login-key.integration.test.ts:419`).

I did not run the suite, so I am not claiming which side wins at runtime today —
only that the server derives its own list, that the two differ by the platform
tier, and that the fix is to call `defaultCliKeyPermissions()`.

A smaller instance of the same rule: `validatePermissionSelection`
(`api-key-grant-policy.service.ts:85-105`) restates the three restricted-mode
rules that `refineRestrictedPermissions` (`contract/src/api-key.permissions.ts:13-43`)
already enforces for both transports — with different wording ("CUSTOM bindings
require at least one permission" vs "restricted mode requires at least one
permission").

### P7 — Three copies of `publicApiKey`, two of `SYSTEM_NAMES`, two of `getInOrganization` (breaks R2, R8)

- `publicApiKey` — `api-key-catalog.service.ts:18`, `api-key-lifecycle.service.ts:25`,
  `api-key-token-resolution.service.ts:17`. Byte-identical. It strips
  `hashedSecret` before a row leaves the service layer, which makes it the single
  most security-relevant three-line function in the feature and the worst
  candidate for three copies.
- `SYSTEM_NAMES` — `api-key-catalog.service.ts:16`, `api-key-lifecycle.service.ts:23`.
- `getInOrganization` — `api-key-catalog.service.ts:185-197` and
  `api-key-lifecycle.service.ts:222-234`, identical private methods.
- Used once each, so they should be private methods rather than module functions:
  `isApiKeyVisibleToMember` (`api-key-catalog.service.ts:23`) and `actor`
  (`api-key-lifecycle.service.ts:30`).

### P8 — `ApiKeyTokenPort` has one implementation beside it, and that implementation is written twice (breaks R4, R2)

`ports/api-key-token.port.ts` (14 lines, 5 signatures) has exactly one
implementation, `adapters/api-key-token.api-key-token.adapter.ts:12`, in the same
package. Nothing else in the repo extends it. That is a seam to nowhere.

Inside the adapter the same five operations exist twice — as instance methods
(lines 21-39) that each delegate one line to a static (lines 41-79):

```ts
hash(secret: string): string {
  return ApiKeyTokenAdapter.hashApiKeySecret(secret, this.pepper);
}
```

The statics exist because `platform/app/prisma/seed.ts:306,316,365,373` calls
`ApiKeyTokenAdapter.hashApiKeySecret` without an instance. One `create(pepper)`
in the seed would remove the doubling. And `trySplit` (`:37-39`) delegates
straight to the contract's `splitApiKeyToken`, so the port makes the service ask
the adapter for a function the service could import.

Deleting the port weakens nothing: the HMAC-with-pepper hash, the
`timingSafeEqual` comparison and the legacy-SHA256 fallback
(`api-key-token.api-key-token.adapter.ts:48-65`) all stay exactly as they are.

### P9 — `index.ts` publishes nine symbols nobody imports; the contract publishes one schema twice (breaks R8)

`server/src/index.ts` exports 17 symbols. External consumers use eight:
`createApiKeysRestApp`, `ApiKeyTrpcApi`, `ApiKeyTrpcContext`, `ApiKeyApp`,
`PostgresApiKeyAdapter`, `EventingAgentSandboxMaintenanceAdapter`,
`ApiKeyTokenAdapter`, `ApiKeyDiagnosticsPort`, `ApiKeyBindingIdPort`,
`AuthzBindingIdDeriver`. Zero external users each:
`AGENT_SANDBOX_KEY_REAP_INTERVAL_MS`, `AGENT_SANDBOX_KEY_REAP_PROCESS_NAME`
(`index.ts:8-10`), `AgentSandboxKeyReapDeps` (`:6`),
`AgentSandboxMaintenancePipelineDeps` (`:3`), `ApiKeyCaller`,
`NamedApiKeyBinding`, `CreateApiKeyRequest`, `UpdateApiKeyRequest`,
`ApiKeyAppDependencies` (`:17-21`).

`contract/src/index.ts:1` already star-exports `apiKeyPermissionSchema`; line 8
publishes the same value a second time as `apiKeyPermissionFormatSchema`. Both
names are live — the alias in three transports and `apps/api`, the original in
`api-key-grant-policy.service.ts:3`.

### P10 — Two pure-wiring layers wrap the composition (breaks R3)

`adapters/postgres.api-key.adapter.ts` is 52 lines whose whole body is one
`build()` calling `ApiKeyService.create` (`:35-51`). `AppApiKeyRuntime`
(`platform/app/src/runtime/app/features/api-key.ts:17-41`) wraps that with a
second `build()` whose only contribution is `bindingIds:
AppApiKeyBindingIdPort.create()` (`:38`). The one real composition seam,
`presets.ts:1267-1277`, already passes eight of the nine dependencies by hand.

### P11 — Small items (breaks R7, plus repo conventions)

- `contract/src/api-key.tokens.ts:117-118` — the file's two `import` statements
  are at the **bottom**, after 116 lines that use them.
- `services/api-key-token-resolution.service.ts:38` — an inline
  `import("@langwatch/api-key-contract").ApiKeyVerification` in a return type.
  `CLAUDE.md` bans inline `import()` outside the SDK CLI boot path.
- `adapters/api-key-token.api-key-token.adapter.ts:82` — re-exports four contract
  symbols. `CLAUDE.md`: never re-export; point consumers at the contract.
- `app/api-key.app.ts:5` — a comment about what `api-key.api.ts` "declared
  before". R7: delete comments that name a file and describe superseded designs.
- `services/api-key-token-resolution.service.ts:127-129` — `trySplitToken` is a
  private one-line pass-through to `this.options.tokens.trySplit`.

### P12 — The spec enforces nothing (no R1-R8 rule; flagged for honesty)

`packages/features/api-key/specs/api-key.feature` has 0 occurrences of `@unit`,
`@integration`, `@e2e` or `@regression`. Per `CLAUDE.md`, `check-feature-parity.ts`
reads an untagged file as `0/0 scenarios bound` / `✓ all bound`. Every scenario in
it — including "A system-managed key is not customer-addressable", the one P3
violates — is currently vacuous. Tagging it would have caught P3.

## 3. What it should look like

```
contract/src/
  api-key.ts                       142   unchanged
  api-key.names.ts                  29   unchanged — the one home for the reserved names
  api-key.visibility.ts             15   unchanged
  api-key.permissions.ts           359   unchanged — the category table is the UI contract
  api-key.tokens.ts                118   imports at the top
  api-key.errors.ts               ~230   the scope-violation family becomes named codes with meta
  api-key.service.ts              ~140   THREE abstract classes instead of one 31-method class:
                                           ApiKeyTokenService  (5)  — every authenticated request
                                           ApiKeyService      (21)  — management, policy, enrichment
                                           ApiKeyCliService    (5)  — device-login lifecycle
  index.ts                           7   one published name per symbol

server/src/
  app/api-key.app.ts              ~420   BOTH transports enter here; absorbs the REST mint rules
  services/
    api-key-lifecycle.service.ts  ~265
    api-key-catalog.service.ts    ~215   extends the contract's read half
    api-key-grant-policy.service.ts ~300 drops the restricted-mode restatement
    api-key-token.service.ts      ~195   extends ApiKeyTokenService; owns markUsed
    api-key-cli.service.ts        ~250   extends ApiKeyCliService; uses defaultCliKeyPermissions()
    api-key-enrichment.service.ts  ~139
    api-key-visibility.service.ts  ~100
    legacy-api-key-grant.service.ts ~176
  utils/api-key-projection.ts       ~25   publicApiKey + SYSTEM_NAMES, one home
  repositories/                           unchanged, minus the stale local name list
  ports/
    api-key-binding-id.port.ts         4  kept — implemented in platform/app
    api-key-diagnostics.port.ts        3  kept — implemented in platform/app
  adapters/
    api-key-token.api-key-token.adapter.ts  ~65  instance methods only, no re-export block
    eventing.agent-sandbox-maintenance.adapter.ts  71
  transport/                              REST loses ~120 lines of application rule
  index.ts                          ~14
```

**Deleted:** `services/api-key.service.ts` (264), `ports/api-key-token.port.ts` (14),
`adapters/postgres.api-key.adapter.ts` (52), `AppApiKeyRuntime`
(41 of `platform/app/src/runtime/app/features/api-key.ts`), and ~120 lines of
`transport/api-rest/api-key.api.ts`.

**≈29 files, ≈4,500 lines. Three layers instead of five, and one door instead of two.**

### The contract split, and the facade going away

The 31-signature class is what forces the pass-through. Split it along the seam
the sub-services already draw, and each one implements its own segment:

```ts
// contract/src/api-key.service.ts

/** Resolving an inbound credential. Runs before anyone is authenticated. */
export abstract class ApiKeyTokenService {
  abstract tryVerify(input: ApiKeyVerifyInput): Promise<ApiKeyVerification | null>;
  abstract tryResolveToken(input: ApiKeyTokenResolutionInput): Promise<ResolvedApiKeyToken | null>;
  abstract resolveOrganizationToken(input: OrganizationApiKeyResolutionInput): Promise<OrganizationApiKeyResolution>;
  abstract regenerateLegacyProjectKey(input: { projectId: string }): Promise<string>;
  abstract markUsed(input: ApiKeyIdInput): void;
}

/** Managing credentials as a signed-in member of an organization. */
export abstract class ApiKeyService {
  abstract create(input: CreateApiKeyInput): Promise<{ token: string; apiKey: ApiKey }>;
  abstract update(input: UpdateApiKeyInput): Promise<ApiKey>;
  abstract revoke(input: RevokeApiKeyInput): Promise<ApiKey>;
  abstract getByIdForCaller(input: ApiKeyCallerReadInput): Promise<ApiKeyDetail>;
  // …17 more, every input the named contract type rather than an inline shape
}

/** The CLI device-login lifecycle, which runs against a device grant. */
export abstract class ApiKeyCliService { /* 5 */ }
```

`services/api-key.service.ts` then has nothing left to say and is deleted;
`ApiKeyDependencies` moves beside the sub-services it configures. The split is
what the call data already asks for: outside the feature, `markUsed` (15 calls)
and `tryResolveToken` (13) dominate — that is the auth path, and it has no reason
to hold a type that also declares `enrichApiKeyList`.

### The REST family entering through `ApiKeyApp`

```ts
export function createApiKeysRestApp(options: {
  security: AppRestSecurity;
  apiKeys: () => ApiKeyApp;          // was: () => ApiKeyService
  permissions: () => AuthzService;
  audit: AppRestManagementAuditPort;
}): SecuredApp<{ Variables: AppRestOrganizationVariables }>;

// POST /
const { token, apiKey } = await apiKeys().createKey(
  {
    organizationId: organization.id,
    name: body.name,
    description: body.description,
    expiresAt: body.expiresAt,
    permissionMode: body.permissionMode,
    keyType: body.keyType,
    assignedToUserId: body.assignedToUserId,
    permissions: body.permissions,
    bindings: requestedBindings(body),   // the projectIds shorthand stays: it is wire shape
  },
  caller,
);
```

`refuseNonAdminPrivilegedMint`, `privilegedMintRefusal`, `resolveKeyOwner` and
both `c.json({error:"Forbidden"},403)` responses go. `ApiKeyApp.createKey` gains
the one rule REST has that tRPC lacks — an ownerless personal key needs org admin
— so the two doors answer the same way by construction, and the refusal arrives
as `ApiKeyAdminRequiredError` with a third `action` value on both.

`ApiKeyApp` needs a `caller` that can be a key rather than a person, which is a
one-field widening of `ApiKeyCaller` (`app/api-key.app.ts:44-46`) to carry
`{ id: string | null; apiKeyId: string }`.

### The scope-violation family

```ts
export class ApiKeyCeilingExceededError extends HandledError {
  declare readonly code: "api_key_ceiling_exceeded";
  constructor(input: { permission: string; scopeType: ApiKeyScopeType; scopeId: string }) {
    super("api_key_ceiling_exceeded",
      `An API key cannot be granted ${input.permission}, because you do not hold it here`, {
        meta: input,
        httpStatus: 403,
        fault: "customer",
        tips: ["Ask an organization admin to raise your role, or narrow the key's permissions"],
      });
    this.name = "ApiKeyCeilingExceededError";
  }
}
```

Roughly six codes cover the thirteen sites: `api_key_ceiling_exceeded`,
`api_key_scope_not_found` (team/project/custom-role, `:158`/`:166`/`:256`),
`api_key_scope_foreign` (`:145`), `api_key_personal_scope_not_owned` (`:132`),
`api_key_restricted_mode_invalid` (`:91`/`:96`/`:101`/`:109`/`:244`) and
`api_key_binding_required` (`lifecycle:79`). `:34` is not a scope violation at
all — it is "not a member", which already has a home in the membership check.
Each gets a `codes.ts` entry and a `presentation.ts` entry in the same commit.

## 4. Keep list

- **`app/api-key.app.ts`.** Required by the layout rule, and it earns it: 6 of its
  9 methods hold real cross-service rules (`listCallerBindings` drops archived
  scopes, `:132`; `listKeys` branches on adminness and folds three enrichments,
  `:168-238`; `createKey` decides ownership, `:249-278`;
  `listOrganizationMembers` returns empty rather than refusing, `:344`). Even the
  thin three are `ensureMember` + one call, not bare delegation.
- **The seven sub-services.** `lifecycle` / `catalog` / `grant-policy` /
  `token-resolution` / `cli` / `visibility` / `enrichment` is a good decomposition
  of 1,500 lines along real seams. The facade above them is the problem, not
  the split.
- **`ApiKeyBindingIdPort` and `ApiKeyDiagnosticsPort`.** One implementation each,
  but both live in `platform/app`
  (`platform/app/src/runtime/app/features/api-key.ts:43` and `:57`) — genuine
  inversions under R4, and `apps/api/src/app/api-standalone.composition.ts:60`
  names them as adapters a second host must supply.
- **`ApiKeyRepository`'s 16 methods.** Every one is a distinct query with a
  distinct index; nothing to merge.
- **`contract/src/api-key.permissions.ts` (359 lines).** The category table is the
  contract between the registry and the API-keys UI, pinned by
  `platform/app/src/server/api-key/__tests__/permission-categories.unit.test.ts`.
  It is an open one-row-per-resource set — new resources arrive without touching
  the others. Leave it alone.
- **The token adapter's crypto.** HMAC-with-pepper, `timingSafeEqual`, and the
  `match_legacy` SHA-256 fallback with its opportunistic re-hash
  (`api-key-token-resolution.service.ts:51-55`) stay byte for byte. Deleting the
  port around them changes no comparison.
- **The `startsDisabled` → `activate` mint order**
  (`api-key-lifecycle.service.ts:99,112`) and the attach-then-revoke replacement
  (`:162-172`). Both are ADR-001 decisions and both are fail-safe as written.
- **`LegacyApiKeyGrantService`'s `now?`** (`legacy-api-key-grant.service.ts:70`).
  A clock seam with a real default, not an R5 optional collaborator.
- **The REST `projectIds` shorthand** (`api-key.api.ts:83-87, 233-252`). Published
  wire shape; it belongs in the transport.
- **Everything under `platform/app/src/pages/settings/api-keys/`** and
  `platform/app/src/server/api-key/auth-middleware.ts`. Out of scope here, and
  already tracked in the legacy-fragment baseline.

## 5. Cost and order

Six commits, smallest risk first, each leaving the suite green.

1. **Delete the stale name list** — `prisma.api-key.repository.ts:9` imports
   `HIDDEN_SYSTEM_KEY_NAMES` from the contract instead. One line, closes P3.
   Tag the `api-key.feature` scenarios (P12) in the same commit so the guard is
   real, and bind "A system-managed key is not customer-addressable" to a test
   that lists with a sandbox key present.
2. **Say the small things once (P6, P7, P9, P11).** `utils/api-key-projection.ts`
   for `publicApiKey` + `SYSTEM_NAMES`; `defaultCliKeyPermissions()` in the CLI
   service; drop the duplicate schema alias, the adapter's re-export block, the
   bottom-of-file imports, the inline `import()`, `trySplitToken`, the stale
   comment, and the nine unused `index.ts` exports. No behaviour change except
   the CLI default, which needs the pinned integration test run.
3. **The error family (P4).** Six codes with `meta`, plus `codes.ts` and
   `presentation.ts` entries. Pure correctness, no structural risk. Tests assert
   on `code`, never on prose.
4. **REST enters through `ApiKeyApp` (P2, P5).** Widen `ApiKeyCaller`, move the
   three mint helpers into `createKey`, delete both hand-rolled 403s. Touches
   `apps/api/src/app-rest/app-rest.features.ts:347-352` and
   `platform/app/src/tasks/generateOpenAPISpec.ts:275`; the OpenAPI document must
   be regenerated and diffed to prove the published surface is unchanged.
5. **Split the contract, delete both second facades (P1, P8).** Three abstract
   classes; each sub-service extends its segment; `services/api-key.service.ts`
   and `ports/api-key-token.port.ts` go. Largest commit — ~28 files outside the
   feature name the `ApiKeyService` type and most will narrow to
   `ApiKeyTokenService`. `test-api-key-service.ts` shrinks from 31 stubs to 5.
6. **Collapse the wiring (P10).** `PostgresApiKeyAdapter` and `AppApiKeyRuntime`
   fold into `presets.ts:1267` and `presets.ts:3164`.

Commits 1-3 are independent and could land in any order. 5 depends on 4 (the REST
door must be on `ApiKeyApp` before the service type splits under it).

## 6. Blast radius

**`@langwatch/api-key-server`** — 9 source files and 1 test outside the feature:

| File | Symbols |
|---|---|
| `apps/api/src/app-rest/app-rest.features.ts:31,347` | `createApiKeysRestApp` |
| `apps/api/src/features/api-key/api-key-trpc.mount.ts:13` | `ApiKeyTrpcApi`, `ApiKeyTrpcContext` |
| `apps/api/src/index.ts:127` | re-exports `createApiKeysRestApp` |
| `platform/app/src/server/app-layer/app.ts:4,125,342` | `ApiKeyApp` |
| `platform/app/src/runtime/app/features/api-key.ts:3-8` | `PostgresApiKeyAdapter`, `ApiKeyDiagnosticsPort`, `ApiKeyBindingIdPort`, `AuthzBindingIdDeriver` |
| `platform/app/src/server/event-sourcing/registration/pipelineRegistry.ts:176` | `EventingAgentSandboxMaintenanceAdapter` |
| `platform/app/prisma/seed.ts:77,306,316,365,373` | `ApiKeyTokenAdapter.hashApiKeySecret` (static) |
| `platform/app/src/tasks/generateOpenAPISpec.ts:7,275` | `createApiKeysRestApp`, via the `apps/api` barrel |
| `apps/api/src/features/api-key/__tests__/api-key-trpc.mount.unit.test.ts` | `ApiKeyApp` |

**`@langwatch/api-key-contract`** — 66 files outside the feature. 28 of them name
the `ApiKeyService` type and are what commit 5 touches, most notably
`platform/app/src/server/api-key/auth-middleware.ts`,
`platform/app/src/server/routes/auth-cli.ts`,
`platform/app/src/server/app-layer/dependencies.ts`,
`packages/features/langy/server/src/services/langy-session-key.service.ts`,
`packages/features/project/server/src/app/project.app.ts`,
`packages/enterprise/composition/api/src/governance/ingestion-key.adapter.ts` and
`apps/api/src/app/api-key-rest-security.adapter.ts`. The remaining ~38 import only
types, errors and the token/permission helpers, and are unaffected by every commit
except 3 (which adds codes rather than removing any).
