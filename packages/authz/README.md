# @langwatch/authz

The unified authorization engine ([ADR-092](../../dev/docs/adr/092-unified-authorization-engine.md)).
This package is the **pure core** of the design: the permission registry, the
built-in roles, the `AuthzEngine` (the `decide()` walk), and the witness and
bitset primitives. It reads nothing and writes nothing - no Prisma, no env, no
server imports - so the client (`useCan`), the server runtime, and any future
service can all depend on it and get the same answer.

The design is three layers, app-layer service/repository idiom throughout:

- **`@langwatch/authz`** (this package) - the vocabulary and the pure
  `AuthzEngine`. Browser-safe.
- **`@langwatch/authz-server`** - the server runtime: `AuthzCollectorService`,
  `AuthzService` (with the epoch cache inside), `GrantsService` - all written
  against two repository INTERFACES (`AuthzReadRepository`,
  `AuthzGrantsRepository`). No storage engine.
- **the app** (`platform/app/src/server/app-layer/authz/`) - the Prisma repository
  implementations (`repositories/*.prisma.repository.ts`), the redis epoch
  store, the tRPC middleware, and `runtime.ts`: the composition root that
  builds ONE of each service and exports `authz`, `authzCollector` and
  `grantsService()`. Only server-only modules may import it: its graph reaches
  Prisma, redis and the audit writer at module scope, and `rbac.ts` is
  imported by client code, so a runtime import from there would put Prisma in
  the browser bundle. `src/server/__tests__/frontend-boundary.unit.test.ts`
  walks that graph and fails the build if it happens.

```text
 PERMISSION   "traces:view"             a verb on a resource, from ONE registry
 ROLE         viewer ⊂ member ⊂ admin   a named set of permissions
 ROLE BINDING (WHO, ROLE, WHERE)        the only grant primitive

 WHO    user | group | api key                     WHERE   organization
 walk   COLLECT → FILTER (scope chain) → EXPAND            └─ team
        → UNION → DECIDE → RECORD                              └─ project
                                                                  └─ resource (trace, thread)
 Grants are an additive union. Narrowing = granting less, never overriding.
```

```text
 app (platform/app)              @langwatch/authz-server        @langwatch/authz
 ─────────────────────           ───────────────────────        ─────────────────
 Prisma*Repository ─ implements ─► AuthzReadRepository          AuthzEngine
 (repositories/)                   AuthzGrantsRepository        │ decide()
 epoch.ts (redis) ─ epochReader ─► AuthzService ── decides via ►│ explain()
 runtime.ts       ─ composes ────► AuthzCollectorService        registry · roles
 trpc-middleware (.permission())   GrantsService                witness · bitset
 useCan / RequireCan (client) ◄─── effectivePermissions()       matchers · scope
```

Nothing in that picture is a passport. The stateless-surface line in the stage
ladder below is design, not code: there is no `passport.ts`, no
`PassportService` and no `./passport` export.

## Using it

Which door you walk through depends on what you are writing:

| You are writing... | Use |
|---|---|
| a tRPC procedure | `protectedProcedure.permission("...")` |
| a service, worker, or anything server-side | `authz.authorize()` (throws, returns a witness) or `authz.can()` |
| a Hono route | nothing inline - the service it calls does `authz.authorize()` |
| React UI | `useCan()` / `<RequireCan>` |
| an admin surface that changes who can do what | `grantsService()` verbs |
| a share page (anonymous viewer with a link) | `authzCollector.resolveResourceScopeRef` + `authz.check()` |

The composed instances live in the app's composition root,
`~/server/app-layer/authz/runtime.ts` - import them from there; nothing else
constructs a service or a repository.

### Protecting a tRPC procedure

`.permission()` replaces the whole `.use(checkUserPermissionForProject(...))`
family. The middleware resolves the scope from the input's most specific id
(`projectId`, then `teamId`, then `organizationId`), collects once, decides,
and throws the legacy-compatible error shape on denial. An input with none of
the three ids fails loudly - that is a wiring bug, not a denial.

```ts
export const tracesRouter = createTRPCRouter({
  getById: protectedProcedure
    .permission("traces:view")
    .input(z.object({ projectId: z.string(), traceId: z.string() }))
    .query(({ ctx, input }) => { ... }),
});
```

### Checking in server code

Build the scope with a resolver - never by hand. The resolvers exist so that
lineage facts (a project's team and organization) come from storage; a
hand-built literal is the one way to lie to the engine.

```ts
import { authz, authzCollector } from "~/server/app-layer/authz/runtime";

const scope = await authzCollector.resolveScopeRef({ projectId });
if (!scope) throw new NotFoundError(...);          // unknown id: deny, don't leak

// Boolean - for branching:
if (await authz.can({ principal: { type: "user", id: userId }, permission: "datasets:manage", scope })) { ... }

// Throw-on-denial - for guarding. The returned witness is the proof object
// repositories following the witness convention accept instead of a raw id,
// which makes "forgot the permission check" fail to compile:
const authorized = await authz.authorize({
  principal: { type: "user", id: userId },
  permission: "datasets:manage",
  scope,
});
await datasetsRepository.deleteAll(authorized);
```

`authz.check()` is `can()` with the full decision (via, denialReason,
audience) when you need to explain or log; `authz.effectivePermissions()` is
the whole set at a scope, and is what the `authz.effectivePermissions` router
serves the client.

### Checking in the browser

The client never re-derives decisions from role names. It asks the server for
the effective set once per scope and tests against it with the same hierarchy
helper the engine uses - a typo'd permission string fails `pnpm typecheck`.

```tsx
const { can, isLoading } = useCan();
if (can("prompts:update")) { ... }        // false while loading - fail closed

<RequireCan permission="prompts:update" fallback={null}>
  <EditButton />
</RequireCan>
```

### Sharing and anonymous callers

A share link viewer has no session. The share page resolves the resource
scope with the tokens the request presented; the collector reads only live,
presented links, and `decide()` answers through the resource tier - the ONLY
path an anonymous principal can take.

```ts
const scope = await authzCollector.resolveResourceScopeRef({
  projectId: trace.projectId,      // off the FETCHED trace row, never the URL
  kind: "trace",
  id: trace.id,
  parentThreadId: trace.threadId,  // same: the stored row's own thread
  shareTokens: [presentedToken],
});
const decision = await authz.check({ principal: { type: "anonymous" }, permission: "traces:view", scope });
// decision.audience === "public" → serializers apply the public redactions
```

### Changing who can do what

`GrantsService` is the one write surface. Every mutation validates tenancy,
names its failures (`grant_validation_failed`, never a raw database error),
writes an audit event, and bumps the org's epoch so caches die on the next
request.

```ts
import { grantsService } from "~/server/app-layer/authz/runtime";

const grants = grantsService();
await grants.attach({ actor, who: { type: "user", id }, role: { builtin: "MEMBER" }, where: teamScope });
await grants.update({ actor, bindingId, organizationId, role: { customRoleId } });
await grants.revoke({ actor, bindingId, organizationId });

// The REDUCE verb - narrowing is one atomic swap, never two bindings fighting:
await grants.replace({ actor, who, from: orgScope, to: teamScope, role: { builtin: "MEMBER" } });

// Offboarding proves the result inside the transaction and reports what
// still needs a human decision (owned API keys, personal workspaces):
const report = await grants.offboard({ actor, userId, organizationId });
```

Resource scopes are rejected here by design: resource-tier access is granted
by *sharing* the resource, not by a role binding.

### Adding to the vocabulary

1. Append the action or resource **at the end** in `registry.ts` - never
   reorder, never insert. Bitset indices are derived from declaration order,
   and the stage-F passport design would ship those indices over the wire.
   The order has to be frozen before the first one is minted, not after.
2. If built-in roles should grant it, add it to the role *differences* in
   `roles.ts` (member = viewer + additions, admin = member + additions).
3. Update the pinned count and append to the full-order list in the app-side
   `registry.unit.test.ts` - the test failing is the reminder, not the enemy.
4. Write the behaviour as a scenario in
   `specs/rbac/unified-authorization-engine.feature`, tag it, and bind it
   with a `@scenario` annotation on the covering test.

### Naming a failure

A new `HandledError` code is not done until the customer can read it: add the
code to `platform/app/src/features/errors/logic/codes.ts` (sorted) and write
its copy in `presentation.ts` in the same change - `codes.unit.test.ts` fails
otherwise, and an unregistered code reaches customers as "unknown error".

### What not to do

| Mistake | Instead |
|---|---|
| Hand-building an `AuthzScopeRef` literal in a route or service | Resolve it (`authzCollector.resolveScopeRef` / `resolveResourceScopeRef`) - lineage comes from storage, resource anchors from the fetched row |
| Comparing role names (`role === "ADMIN"`) to gate behaviour | Ask for a permission - roles are grant bundles, not checks |
| Inserting a permission mid-registry because it "belongs with" its siblings | Append only; the order test exists to stop exactly this |
| Putting a `node:crypto` or `Buffer` dependency on the package barrel | The barrel stays browser-safe - `useCan` imports it. A server-only primitive gets its own subpath export, the way `@langwatch/authz/witness` does. This is the rule the unbuilt passport work will land under; there is no `PassportService` to re-export today |
| Toasting `error.message` from a denied mutation | The code-keyed presentation registry renders the copy (`permission_denied`) |
| Constructing your own `AuthzService` / repository instead of importing from `runtime.ts` | The composition root builds one of each; a second instance means a second cache and a second config |
| Calling `engine.decide()` with a hand-assembled `CollectedGrants` in production code | `AuthzService` collects through the repository; hand-assembly is for tests |
| A new error code without `codes.ts` + `presentation.ts` entries | Both, in the same change - the guard test enforces it |

## Bible of terms

Use these words exactly; every synonym that predates ADR-092 maps onto one of
them, and the migration deletes the synonyms.

| Term | Meaning |
|---|---|
| **Permission** | A `resource:action` string, e.g. `traces:view`. Comes from the one registry; nothing else may invent one. The registry order is **append-only** because bitset indices are derived from it. **Never call these "scopes"** - see the note under this table. |
| **Resource** | A noun the registry declares: its supported actions, the scopes it can be granted at, and what `manage` implies for it. `traces:rotate` is a type error, not a runtime surprise. |
| **Action** | The verb half of a permission. `manage` satisfies the resource's other actions through the hierarchy rule (`permissionSatisfiedBy`). |
| **Registry** | `AUTHZ_RESOURCES` in `registry.ts` - the single authoritative vocabulary. Everything else (types, validators, bitset indices, pickers) is derived from it. |
| **Role** | A named set of permissions. Built-ins are declared as differences: viewer is the base, member = viewer + additions, admin = member + additions. Custom roles are permission lists stored per organization. |
| **Role binding** | `(WHO, ROLE, WHERE)` - the **only** grant primitive. Every "member of", "collaborator on", "key scoped to" is a binding. |
| **Principal (WHO)** | Who holds the binding: a user, a group, or an API key. At decide time there is also `anonymous` - a caller with no session, resolvable only through the resource tier. |
| **Scope (WHERE)** | Where a grant applies: organization → team → project → resource. A scope ref carries its lineage (a project knows its team and organization) - derived from the database, never from the request. |
| **Scope chain** | The binding scopes that can grant at a given scope, most specific first. A project check consults PROJECT, TEAM, then ORGANIZATION bindings. |
| **Additive union** | Grant semantics: bindings only ever ADD permissions. There is no override and no precedence; giving someone less means granting less. |
| **CollectedGrants** | The snapshot the collector produces for one (principal, organization): org membership, bindings (group-expanded), legacy team rows, custom-role permission lists. Everything `decide()` knows. |
| **The walk / `decide()`** | The six ordered steps: COLLECT → FILTER (scope chain) → EXPAND (roles → permissions) → UNION → DECIDE → RECORD. The order is the contract; the code reads top to bottom in `engine.ts`. |
| **Decision** | `AuthzDecision`: `allowed`, the permission and scope asked about, `via` (which step granted), `denialReason` (which gate denied), and `audience`. |
| **`via`** | The step that granted: `binding`, `org-role-floor`, `demo-project`, `legacy-team-fallback`, or `resource-grant`. |
| **Denial reason** | `no-membership`, `no-binding`, `lite-member-restricted`, or `owner-ceiling`. Stable vocabulary - the UI and error mappers key on it, never on message prose. |
| **Audience (decision)** | `member` or `public`. Serializers redact on `public` - a share-link viewer never sees member-only fields. |
| **Resource grant** | A grant at the resource tier: `(kind, id, projectId, permission, audience)`. One grant on a trace covers its spans, logs and metrics through the chain walk - children never get rows. |
| **Grant audience** | Who a resource grant is for: a user, group, or API key; members of a project, team, or organization; or `anyone` (the public share expressed as a row). |
| **Possession** | A share link authorizes only when its secret token is **presented**. Row existence never grants - that is what keeps trace-id guessing closed (ADR-057). |
| **Owner ceiling** | `effective(key) = grants(key) ∩ grants(owner)`, evaluated live. A key never outgrows or outlives its owner's access. Service keys (no owner) have no ceiling. |
| **Lite member** | Today: the `EXTERNAL` organization role, which caps team/project bindings at the lite-member bag. Stage C makes it a plain role with its own grants instead of a cross-cutting cap. |
| **Org-role floor** | Every organization member holds the org-member bag on organization-scope checks, bindings or not. A tagged legacy quirk. |
| **LEGACY-QUIRK(stage)** | A deliberately reproduced legacy behaviour, tagged with the migration stage that deletes it. Stage-A parity means matching legacy warts and all. |
| **Witness** | `Authorized<Scope>` - a branded, unforgeable proof that `authz.authorize()` allowed a permission at a scope. Repositories that accept a witness instead of a raw id make "forgot the check" fail to compile. |
| **Repository port** | The storage interfaces the runtime services are written against: `AuthzReadRepository` (everything COLLECT reads) and `AuthzGrantsRepository` (everything the write surface touches, transactions included). The app implements them as `Prisma*Repository` classes. |
| **Composition root** | `platform/app/src/server/app-layer/authz/runtime.ts` - the one place repositories, redis, the audit writer and the KSUID minter meet the services. Everything else imports the composed instances. |
| **Passport** | **Designed, not built** (stage F). A signed, short-TTL (≤60s), epoch-bound token carrying per-scope permission bitsets, so that stateless surfaces (Go gateway, collectors) could verify with an HMAC check and an epoch compare - zero database. No code mints or checks one today; the word appears here so the constraints it imposes on the registry are not lost. |
| **Bitset** | An effective permission set as bits indexed by registry order (`encodePermissionBitset` / `bitsetHasPermission`, both real and both on the barrel). The reason the registry is append-only: an index must never change meaning once anything ships one, and the cheapest moment to promise that is before the first passport exists. |
| **Epoch** | A per-organization counter in redis. Every grant write bumps it; a cached grants reading is valid only for the epoch it was built under, so a revocation lands on the caller's next request. The passport design leans on the same counter. |
| **Shadow mode** | **Removed.** For stage A the engine ran beside the legacy resolvers on real traffic and logged mismatches with both verdicts, behind `AUTHZ_V2_SHADOW`. The engine decides alone now, so the comparison, the flag and `AuthzShadowService` are all gone. |
| **Divergence family** | A classified, *expected* shadow mismatch: `external-cap` (the legacy API-key path applied no lite-member cap) and `ceiling-legacy-fallback` (the legacy key ceiling consulted TeamUser rows un-gated). Historical - the vocabulary went with shadow mode. |

### "Permission" or "scope"? Permission - everywhere (2026-08-17)

`traces:view` looks like an OAuth scope, and on an API key it even behaves
like one: a key's access is *reductive*, intersected with its owner's
(`effective(key) = grants(key) ∩ grants(owner)`). That is a real property,
and it already has a name here - the **owner ceiling**. It is not a reason
to call the string a scope.

**Scope is taken, and it is taken in the customer's vocabulary, not just
ours.** The product already teaches "scope = where": `ScopeChipPicker` is a
hard rule for every scoped-resource surface
(`dev/docs/best_practices/scope-selector-and-badges.md`), and the scopes it
offers are organization / team / project. A customer who met "scopes" on
their API key would be meeting a second, unrelated sense of the word in the
same settings area.

So one vocabulary, no translation layer, no internal-versus-external split:

```
 PERMISSION  what you may do     traces:view          registry string
 SCOPE       where it applies    project p_abc123     org → team → project → resource
```

This holds in code, API documentation and UI copy alike. On a user binding a
permission is additive (the union); on a key it is bounded by the owner
ceiling. Same string, same word, two behaviours the model already names -
reach for `additive union` and `owner ceiling` when you need to say which.

## Migration, in one screen

Full detail: [ADR-092 §13](../../dev/docs/adr/092-unified-authorization-engine.md)
and the [delivery plan](../../dev/docs/adr/110-grant-aggregates-are-grants.md)
(stages, gates, rollbacks, and the data runbook). The shape:

```text
 A  EXTRACT    this package + adapters, parity suites, SHADOW mode     [shipped]
 B  BACKFILL   TeamUser → role bindings, then delete the fallback      [shipped *]
 C  UNIFY      lite member becomes a role; ShareLink → resource grants [C5 only *]
 D  ADOPT      .permission() everywhere; writes through GrantsService  [shipped]
 E  ENFORCE    every endpoint declares access or opts out, build-gated [shipped]
 F  SCALE      epoch cache on, passports for stateless surfaces        [cache on *]

 * B  the backfill shipped and every organization reads bindings. The
      `legacy-team-fallback` step is still in the walk and the collector
      still reads the legacy rows, so the deletion half is outstanding.
 * C  C5 shipped: ShareLink IS resource-grant storage, no parallel table.
      The lite member is still the cross-cutting cap it always was, not a
      role - `lite-member-restricted` is a denial reason in the engine.
 * F  the epoch cache is on by default; `AUTHZ_EPOCH_CACHE=0` turns it off.
      Passports are not built - see the note under the diagram at the top.
```

Data that actually moves (runbook M1-M7 in the delivery plan): the TeamUser
backfill with a per-user parity sweep (M1-M2), legacy API-key re-keying behind
`AUTHZ_LEGACY_KEY_ENFORCE` (M3-M4), extending ShareLink into full resource-grant
storage - no parallel table, no backfill (M5), deriving then deleting the
legacy vocabulary in `rbac.ts` (M6), and the epoch discipline: every grant
write path must bump the epoch **before** `AUTHZ_EPOCH_CACHE` ever ships on
(M7 - met: `GrantsService` bumps on every write, which is what let the cache
default on). Every step is expand → dual-run → verify → cut over → delete,
one flag per cutover.

## Flags (resolved by the app's composition root, passed in as options)

No package here reads the environment: the app's `runtime.ts` resolves each
flag and passes it to the service that needs it, so a test sets an option
instead of an env var.

```text
 AUTHZ_EPOCH_CACHE      unset | 0 | 1     L1 grants cache. ON unless the value is
                                          0, false, off or no - trimmed and read
                                          case-insensitively, so a kill switch
                                          cannot no-op on casing. Anything else
                                          leaves it on
 AUTHZ_PASSPORT_SECRET  hex               RESERVED for the unbuilt stage-F passport
                                          work. Nothing reads it today; there is no
                                          PassportService to hand it to
 AUTHZ_V2_SHADOW        —                 REMOVED with shadow mode, when the engine
                                          became the only decider
```

The one flag that is live is resolved in the app's composition root
(`runtime.ts`) through `epoch-cache-flag.ts`, per check rather than at module
load, so turning the cache off is a restart-free lever. It fails toward ON: a
value we do not recognise costs database reads, where a kill switch that
silently did nothing would cost an incident.

When the passport work lands it goes behind its own subpath export, not the
barrel: it needs `node:crypto` and `Buffer`, and the barrel stays browser-safe
for `useCan`. The base64url bitset codecs would live there with it; the pure
bit operations (`encodePermissionBitset` / `bitsetHasPermission`) are on the
barrel today. `mintWitness` already follows that shape for blast radius rather
than bundle size - the server runtime imports `@langwatch/authz/witness`, and
the `Authorized` type stays on the barrel because types are erased.
