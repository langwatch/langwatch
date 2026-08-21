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
          │ (types from @langwatch/authz)     │ wrong scope tier      │
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

| You are writing | Declare with |
| --- | --- |
| A tRPC procedure | `.permission("resource:action")` after `.input(...)` |
| A tRPC procedure with no check | `.noPermission({ reason, allow })` |
| A tRPC procedure with a custom check | `.use(declareAuthzMiddleware(declaration, middleware))` |
| A management API endpoint (`@langwatch/api`) | `...guard("resource:action")` in the endpoint config |
| A management API endpoint with no check | `noPermission: { reason: "..." }` in the endpoint config |
| A Hono route on `SecuredApp` | `.access(requires("resource:action"))` before the verb |
| Service or route code deciding imperatively | `requireProjectPermission(ctx, id, permission)` — returns the witness |
| Code that genuinely branches on the answer | `probeProjectPermission(ctx, id, permission)` — returns the boolean |

Permissions are always the registry union (`AuthzPermission` from
`@langwatch/authz`). The union is generated per resource, so
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

### Runtime backstop

Whatever path built the procedure, `enforcePermissionCheck` runs after the
check slot and throws `FORBIDDEN` if nothing set `ctx.permissionChecked`. The
CI sweep (`authz-declaration-sweep.unit.test.ts`) then walks the real router:
every procedure must carry a declaration, and every required scope id in an
input must be covered by a check or explicitly named by one.

## Management API endpoints (`@langwatch/api`)

Every endpoint config carries `AccessDeclaration` (from `@langwatch/authz`):
exactly one of a permission or a written opt-out. Neither, or both, does not
compile.

```ts
v.post("/", {
  ...guard("organization:manage"),   // permission + route-registry policy, from one argument
  input: createRoleSchema,
  output: roleSchema,
}, createRoleHandler);

v.get("/health", {
  noPermission: { reason: "liveness probe; the response carries no data" },
  output: healthSchema,
}, healthHandler);
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

Two families, named for what they return. There is deliberately no function
called `has*Permission` anywhere any more — that name existed in two modules
with identical signatures, and a test mock could silently bind the wrong one.

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

## Escape hatches, and what each one costs

| Hatch | Price |
| --- | --- |
| `.noPermission({ reason, allow })` | A written reason per scope field, forever visible in the code and the sweep |
| `.authorizeInService({ reason, permissions })` | The service owns the check; take the witness in the service signature so the claim is proof |
| `handlerManagedAuth({ reason, permissions })` | Same, on the REST surface |
| `guard()`-less management endpoint | Does not exist — build error |
| A cast (`as any`, `as never`) around any of this | Passes the compiler and lands in the boot check or the sweep; the reviewers treat it as a defect |

## Where things live

- `packages/authz` — the registry, the declaration types
  (`AccessDeclaration`, `ValidatePermissionForInput`, `PermissionScopeArg`,
  `TierOfScopeArg`), the middleware brand (`declareAuthzMiddleware`,
  `DeclaredAuthzMiddleware`), and the witness type. Browser-safe.
- `@langwatch/authz/witness` — `mintWitness`, server-only by subpath. Do not
  put it on the barrel; application code receives witnesses, it never mints
  them.
- `platform/app/src/server/app-layer/permissions/imperative.ts` — `require*`
  and `probe*`.
- `platform/app/src/server/api/trpc.ts` — the pending builder.
- `packages/api` — the service framework and its boot checks.
- `specs/rbac/typed-permission-declarations.feature` — the behavioural
  contract; every guarantee above is a bound scenario.

The compile-time guarantees are pinned by
`permission-declaration.types.unit.test.ts`, whose `@ts-expect-error` lines
are the assertions — `pnpm typecheck:all` is what runs them.
