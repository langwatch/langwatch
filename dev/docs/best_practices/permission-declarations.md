# Permission declarations

Every procedure, endpoint, and imperative check states its access up front —
and one that states nothing does not build. This page shows how to declare on
each surface, what each mistake looks like, and which layer catches it.

The design goal is a thin line: anything misconfigured refuses to compile or
refuses to boot, and anything correctly declared never fights you. If you hit
a compile error on this surface, read it — the reason is written into the
diagnostic.

## The four layers

A mistake is caught at the earliest layer that can see it. Each layer backs
the one above it, so getting past one by force (a cast, a JS-level bypass)
lands you in the next.

```
            what it sees                      what it refuses
          ┌──────────────────────────────────────────────────────────┐
 COMPILE  │ the declaration and its input     │ no declaration        │
          │ (types from @langwatch/authz-contract)     │ wrong scope tier      │
          │                                   │ off-registry perm     │
          │                                   │ undeclared middleware │
          │                                   │ forged witness        │
          ├──────────────────────────────────────────────────────────┤
 BOOT     │ every registered endpoint         │ bare endpoint         │
          │ (build() before mounting)         │ blank opt-out reason  │
          │                                   │ permission w/o        │
          │                                   │   enforcer            │
          │                                   │ policy ≠ enforcement  │
          ├──────────────────────────────────────────────────────────┤
 REQUEST  │ the live chain                    │ handler reached with  │
          │ (enforcePermissionCheck)          │   no check having run │
          ├──────────────────────────────────────────────────────────┤
 CI SWEEP │ the whole composed router and     │ scope ids no check    │
          │ route table                       │   covers; drifted     │
          │                                   │   allowlists          │
          └──────────────────────────────────────────────────────────┘
```

## Which call do I make?

| You are writing                              | Declare with                                                          |
| -------------------------------------------- | --------------------------------------------------------------------- |
| A tRPC procedure                             | `.permission("resource:action")` after `.input(...)`                  |
| A tRPC procedure with no check               | `.noPermission({ reason, allow })`                                    |
| A tRPC procedure with a custom check         | `.use(declareAuthzMiddleware(declaration, middleware))`               |
| A management API endpoint (`@langwatch/api`) | `...guard("resource:action")` in the endpoint config                  |
| A management API endpoint with no check      | `noPermission: { reason: "..." }` in the endpoint config              |
| A Hono route on `SecuredApp`                 | `.access(requires("resource:action"))` before the verb                |
| Service or route code deciding imperatively  | `requireProjectPermission(ctx, id, permission)` — returns the witness |
| Code that genuinely branches on the answer   | `probeProjectPermission(ctx, id, permission)` — returns the boolean   |

Permissions are always the registry union (`AuthzPermission` from
`@langwatch/authz-contract`). The union is generated per resource, so
`"traces:rotate"` is a compile error — traces cannot be rotated, and the type
system knows the registry does not say they can.

## tRPC procedures

`protectedProcedure` and `publicProcedure` return a **pending builder**. It
has no `.query`, `.mutation`, or `.subscription` — you cannot finish a
procedure without declaring. This is the strongest guarantee on any surface:
an undeclared procedure is not a bug report, it is a red underline.

```ts
export const monitorsRouter = createTRPCRouter({
  getById: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .permission("monitors:view")   // scope id derived from input.projectId
    .query(({ ctx, input }) => { ... }),
});
```

The scope id is derived from the validated input. The permission's registry
tiers decide which of `projectId` / `teamId` / `organizationId` the input must
carry. When the derivation is ambiguous, write it at the call site:

```ts
.permission("traces:view", { via: "projectId" })
```

When it cannot work, the compile error tells you why. The failing type
resolves to `DeclarationError<"...reason in words...">`, so the diagnostic
contains the sentence, not just a type name:

- the input carries no required id at a tier the permission is grantable at
- the permission is platform-tier (`ops:*` never goes through this surface)
- `.permission()` was called before `.input()`

### Opting out

```ts
.noPermission({
  reason: "public share resolution; the token is the credential",
  allow: {
    projectId: "keys the share-token lookup only, never trusted as scope",
  },
})
```

`reason` is always required. If the input carries any scope-tier field,
`allow` becomes required too, with one written justification **per field** —
the type makes each missing justification a compile error. This is the old
`skipPermissionCheck` moved into the compiler.

### Custom checks

`.use()` on the pending builder accepts only middleware carrying the
declaration brand. `declareAuthzMiddleware` is the sole way to produce it:

```ts
const SCOPE_AWARE_WRITE_DECLARATION = {
  kind: "custom",
  reason: "each scope in the write demands its own tier's manage permission",
  permissions: ["organization:manage", "team:manage", "project:update"],
} as const;

.use(declareAuthzMiddleware(SCOPE_AWARE_WRITE_DECLARATION, scopeAwareWrite))
```

A hand-rolled function that sets `ctx.permissionChecked = true` without a
declaration does not compile. Note that the brand must be on the
**identifier's type**: tagging a hoisted function after the fact runs the same
code but the compiler never sees it — assign the result of
`declareAuthzMiddleware`, do not discard it.

Non-authz middleware — plan gates, error handlers — does not belong here. Put
it after the declaration, on the plain builder that `.permission()` returns.

When authorization is data-dependent and must run inside the resolver (a
membership filter, a scope loaded from the row being acted on), use
`authorizeInResolver(enforces)` and claim, per scope field the input carries,
what enforces it:

```ts
.use(
  authorizeInResolver({
    organizationId:
      "requireExistingVk anchors the key to this organization; virtualKeys:update on one of its scopes",
  }),
)
```

The sweep counts a claimed field as covered — the same contract as
`.noPermission()`'s `allow` — and fails on an unclaimed one, so an input
growing a new scope id turns CI red until the resolver's enforcement is
named. A claim about a field the input does not accept also fails, so claims
cannot rot past a rename. There is no argument-less form: a declaration that
claims nothing covers nothing.

### Runtime backstop

Whatever path built the procedure, `enforcePermissionCheck` runs after the
check slot and throws `FORBIDDEN` if nothing set `ctx.permissionChecked`. The
CI sweep (`authz-declaration-sweep.unit.test.ts`) then walks the real router:
every procedure must carry a declaration, and every required scope id in an
input must be covered by a check or explicitly named by one.

## Management API endpoints (`@langwatch/api`)

Every endpoint config carries `AccessDeclaration` (from `@langwatch/authz-contract`):
exactly one of a permission or a written opt-out. Neither, or both, does not
compile.

```ts
v.post(
  "/",
  {
    ...guard("organization:manage"), // permission + route-registry policy, from one argument
    input: createRoleSchema,
    output: roleSchema,
  },
  createRoleHandler,
);

v.get(
  "/health",
  {
    noPermission: { reason: "liveness probe; the response carries no data" },
    output: healthSchema,
  },
  healthHandler,
);
```

`build()` re-judges everything at boot, so a JS-level bypass of the types
still refuses to start:

- an endpoint with no declaration → build error naming the endpoint
- a blank opt-out reason → build error
- a declared permission on a service with no `permissionEnforcer` → build error
- a registry policy promising a permission the config does not enforce →
  build error naming both halves

The framework mounts the enforcer **before** the endpoint's own `middleware`
array, so a custom middleware list can never displace a declared check. Use
`guard()` rather than writing `permission` and the policy separately — one
argument cannot disagree with itself.

## Imperative checks

Two families, named for what they return. The name is deliberately not
`has*Permission`: the legacy `has{Project,Team,Organization}Permission` twins
still live in `server/api/rbac.ts` for the tRPC routers not yet migrated off
them, so a new `has*` here would be a name collision a test mock could bind the
wrong one of. Those twins are being retired; new code uses this facade.

### `require*` — the default

Throws the engine's denial (`permission_denied`) or returns the
**authorization witness**:

```ts
import { requireProjectPermission } from "~/server/app-layer/permissions/imperative";

const authz = await requireProjectPermission(ctx, projectId, "traces:view");
// past this line, the check passed; authz: Authorized<"project">
```

The witness is the piece that makes "forgot the check" a compile error.
`Authorized<Tier>` is a branded proof only the permission seams can mint — the
brand symbol is module-private, so a literal cannot impersonate it. A function
that takes the witness instead of a raw id is unreachable from any path that
skipped the check:

```ts
async function exportRuns(authz: Authorized<"project">, mode: ExportMode) {
  const projectId = authz.scope.id;   // the id the check was decided at
  ...
}

exportRuns(await requireProjectPermission(ctx, projectId, "scenarios:view"), mode); // ✓
exportRuns({ permission: "scenarios:view", scope: { tier: "project", id } }, mode); // ✗ does not compile
```

Adopt the witness on any new service method that must never run unchecked.
The service stops trusting its callers and starts requiring proof.

`PermissionsService.requirePermission` returns the same witness, with the
scope argument typed by the permission's registry tiers — one id, at a tier
the permission is grantable at, or the call does not compile.

### `probe*` — the deliberate boolean

```ts
const canSeeCosts = await probeProjectPermission(ctx, projectId, "cost:view");
```

For call sites that genuinely branch: custom refusal bodies, capability
discovery, visibility decisions. The name says the caller owns what happens on
`false`. If your `probe` is followed by `if (!ok) throw`, you wanted
`require*`.

## Hono routes on `SecuredApp`

A bare `SecuredApp` exposes no HTTP verbs. The only path to `.get`/`.post` is
through a policy:

```ts
app.access(requires("traces:view")).get("/traces/:id", handler);
app.access(publicEndpoint("health probe; no data in the response")).get("/health", handler);
```

Policy vocabulary is typed against the registry. Reasons on `publicEndpoint`,
`internalSecret`, and `handlerManagedAuth` are asserted non-blank, and the
route-policy integration test cross-checks the composed route table against
the registry in both directions, with no allowlist.

Current honest limits on this surface (the next port closes them):
`handlerManagedAuth` records a claim the handler is trusted to keep — back it
with the witness where you can; and do not chain a second verb off one
`.access(...)` call — the second route would mount without the chain. One
policy, one verb.

## Credential arbitration

Before any permission is checked, exactly one credential must have decided
who the request is. Surfaces that accept more than one credential kind
(API key, session cookie) arbitrate with `arbitrateClaims` from
`@langwatch/authz-contract` instead of trying kinds in precedence order: every kind
that is in play claims the request, one claim proceeds, zero claims is
structurally unauthenticated, and two claims are refused as contested. A
claimed credential that fails to resolve is that kind's own refusal — never
a fall-through to the next kind, because masking one credential's failure
with another identity is how a caller ends up acting as someone they did
not mean to be.

The same rule fails the permission gate closed: `requireApiKeyPermission`
mounted without the unified auth middleware in front of it refuses the
request (a mis-wired route is the platform's own defect, surfaced as the
generic unknown response) rather than waving it through unchecked.

Spec: `specs/rbac/credential-arbitration.feature`.

## Escape hatches, and what each one costs

| Hatch                                            | Price                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `.noPermission({ reason, allow })`               | A written reason per scope field, forever visible in the code and the sweep                      |
| `authorizeInResolver({ ...enforces })`           | A per-field claim naming what the resolver enforces; an unclaimed or stale field fails the sweep |
| `.authorizeInService({ reason, permissions })`   | The service owns the check; take the witness in the service signature so the claim is proof      |
| `handlerManagedAuth({ reason, permissions })`    | Same, on the REST surface                                                                        |
| `guard()`-less management endpoint               | Does not exist — build error                                                                     |
| A cast (`as any`, `as never`) around any of this | Passes the compiler and lands in the boot check or the sweep; the reviewers treat it as a defect |

## The lineage guard behind every check

Whatever the declaration kind — declared, custom, or opted out — a runtime
guard in front of it refuses any request whose input carries scope ids that
do not all resolve to one organization
(`AuthzService.checkScopeLineage`, adapted by
`platform/app/src/server/api/trpc.scope-lineage-middleware.ts`). The
declaration sweep closes tier-shadowing
statically, but only for declarations it can see through; this guard removes
the exploit's precondition everywhere instead — a check passing on your own
narrow id can never aim a handler at someone else's wider one, because the
mixed request is refused before the check runs. The refusal is shaped exactly
like a permission denial, so it is not an oracle for which organization an id
belongs to; the mismatch itself is logged. Same-organization cross-team
shapes (moving a project between teams) pass untouched, and a request
carrying at most one scope id costs nothing.

## Where things live

- `packages/features/authz/contract` — the registry and declaration types
  (`AccessDeclaration`, `ValidatePermissionForInput`, `PermissionScopeArg`,
  `TierOfScopeArg`), the middleware brand (`declareAuthzMiddleware`,
  `DeclaredAuthzMiddleware`), and the witness type. Browser-safe.
- `@langwatch/authz-contract` — the portable contract and opaque witness type.
  Witness minting is private to the concrete `AuthzService`; application code
  receives witnesses through `authorize`, it never mints them.
- `platform/app/src/server/app-layer/permissions/imperative.ts` — `require*`
  and `probe*`.
- `platform/app/src/server/api/trpc.permission-builder.ts` — the app's
  declaration policy builder; `@langwatch/trpc` owns generic root creation.
- `packages/api` — the service framework and its boot checks.
- `specs/rbac/typed-permission-declarations.feature` — the behavioural
  contract; every guarantee above is a bound scenario.

The compile-time guarantees are pinned by
`permission-declaration.types.unit.test.ts`, whose `@ts-expect-error` lines
are the assertions — `pnpm typecheck:all` is what runs them.
