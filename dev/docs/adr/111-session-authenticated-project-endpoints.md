# ADR-111: Session-authenticated project endpoints are a declared policy

- **Status:** Proposed
- **Date:** 2026-08-20
- **Supersedes:** nothing
- **Related:** [ADR-045](045-domain-errors-handled-boundary.md) (handled errors at
  the boundary), [ADR-092](092-unified-authorization-engine.md) (the grants ledger),
  [ADR-076](076-single-pnpm-workspace.md) (`@langwatch/api` as a workspace package)

## Context

The platform runs two HTTP families side by side.

```
                    ┌──────────────────────────────┐
   50 route files   │  SecuredApp                  │  createProjectApp
   ───────────────► │  ~/server/api/security       │  createOrgApp
                    │                              │  createServiceApp
                    └──────────────┬───────────────┘
                                   │  both register into
                                   ▼
                    ┌──────────────────────────────┐
                    │  route-policy registry       │ ◄── the RBAC audit
                    │  registerRoutePolicy(...)    │     reads THIS
                    └──────────────┬───────────────┘
                                   │
    6 route files   ┌──────────────┴───────────────┐
   ───────────────► │  @langwatch/api              │  createService
                    │  packages/api                │  + createManagementService
                    └──────────────────────────────┘
```

They share one thing that matters: the **route-policy registry**. Every audit
that answers "what may reach this endpoint" reads the registry, never the
enforcement chain. That makes the declaration load-bearing, and it makes a
declaration nothing enforces a silent lie.

Both families express **API-key** authorization declaratively and well.
`requires("traces:view")` on a `SecuredApp` yields a real chain
(`authMiddleware` → `requirePermission`), and `guard("organization:manage")` on
`createManagementService` yields both halves — the registry entry and the
middleware — from a single argument.

**Neither family can express session authorization at all.**

A browser endpoint that needs "a logged-in user holding `prompts:view` on this
project" has exactly one option today: declare `handlerManagedAuth`, which
registers the intent and enforces nothing, then hand-write the enforcement in
the handler.

```
   handlerManagedAuth({ permissions: ["prompts:view"], credential: "session" })
              │                                    │
              │ declares                           │ enforces
              ▼                                    ▼
   ┌────────────────────┐              ┌────────────────────────┐
   │ route registry     │              │  ...nothing.           │
   │ "needs prompts:view"│              │  The handler does it,  │
   │  ← audits read this│              │  by hand, every time.   │
   └────────────────────┘              └────────────────────────┘
```

**17 route families do this** (`credential: "session"`, counted across
`platform/app/src` and `platform/app/ee`). Against 17 API-key families that get
a real declared chain, and 3 `"both"` plus 2 `"internal"`.

### What the hand-written half actually costs

It is not a theoretical gap. The two most recent session routes disagree about
the error contract:

| | `export/traces` | `prompt-playground` (new) |
|---|---|---|
| unauthenticated | `throw new ExportUnauthenticatedError()` | `c.json({ error: "..." }, { status: 401 })` |
| unauthorized | `throw` a `HandledError` | `c.json({ error: "..." }, { status: 403 })` |
| result | code-keyed copy, registry-rendered | prose blob, no `code`, unrenderable |

`export/traces` even documents why it throws — "createServiceApp's onError
serialises a HandledError with its code, which is what lets the browser render
the registry's copy instead of an unrecognisable prose blob". The playground
route, written later, hand-rolls five different ad-hoc shapes (401, 403, 422,
425, 500). CLAUDE.md names this exact anti-pattern.

That is the predictable outcome of leaving a cross-cutting concern to be
retyped per route: roughly half the sites get it right.

### A second, quieter hole

`EndpointConfig.middleware` is a single key (`packages/api/src/types.ts:153`):

```ts
{ ...guard("organization:manage"), middleware: [somethingElse] }
   │                                └── replaces the enforcement chain
   └── meta.policy survives, so the registry still reports the route as guarded
```

`auth: "none"` (`types.ts:149`) does the same to authentication. No endpoint
does this today and no test forbids it — `managed-service.unit.test.ts` covers
the *missing* guard ("refuses to build rather than mounting an unclassified
route") but not the *overridden* one. Since the audit reads the declaration, an
override is invisible to it.

## What we are NOT changing, and why it matters

An earlier reading of this problem concluded `packages/api` needed a new
streaming primitive, because `v.sse()` mounts GET and reads only the query
string (`SSEConfig` has `query`, no body; `SSEHandler` receives `{ query, app }`)
and the playground POSTs a whole conversation. **That conclusion was wrong**, and
the correction is load-bearing for this design:

```ts
// packages/api/src/types.ts:274 — Handler, when no `output` is declared
) => TConfig extends { output: ZodType }
  ? InferOutput<TConfig> | Promise<InferOutput<TConfig>>
  : Response | Promise<Response>;          // ← typed raw Response

// packages/api/src/response.ts:23 — and the pipeline hands it straight back
if (result instanceof Response) return result;
```

`serializeEndpointResult` calls this "the framework's deliberate opt-out … a
redirect, a file stream and a hand-built error all need it". So:

```ts
v.rpc("prompt.execute", { ...guard("prompts:view"), input: schema },
  (c, { input, app }) => streamSSE(c, (stream) => ...))   // typechecks today
```

**`packages/api` needs no change to carry a POST-with-body SSE endpoint.**
`v.sse()` is the typed-event convenience for GET streams; `v.rpc()` is the right
tool here, and it already mounts a real POST whose arguments all travel in the
body. Scope stays in the app layer, where authz belongs.

## Decision

### 1. `sessionPermission` becomes a first-class `AccessPolicy` kind

Not a wrapper over `handlerManagedAuth`, and not a per-family helper — a member
of the union in `access-policy.ts`, alongside `permission` and
`apiKeyPermission`, with a real enforcement chain behind it.

```ts
| {
    readonly kind: "sessionPermission";
    readonly permission: Permission;
    /**
     * Where the project id is read from. Mandatory and explicit: the
     * enforcement middleware runs BEFORE input validation (see §3), so it
     * cannot be inferred from a validated field.
     */
    readonly project: ProjectRef;
  }

type ProjectRef =
  | { readonly from: "body"; readonly field: string }
  | { readonly from: "param"; readonly name: string }
  | { readonly from: "header" };   // X-Project-Id, the existing convention
```

with the factory `requiresSession(permission, { project })`.

`credentialClassFor` learns the kind and reports `session`, so the OpenAPI
generator keeps refusing to advertise it as an API-key surface — a browser
endpoint is not an SDK surface and must not appear as one.

### 2. One definition, consumed by both families

```
             requiresSession("prompts:view", { project: … })
                              │
              ┌───────────────┴────────────────┐
              │  server/api/security/          │
              │    access-policy.ts   (kind)   │
              │    session-auth.ts    (chain)  │
              └───────────────┬────────────────┘
                              │
          ┌───────────────────┴───────────────────┐
          ▼                                       ▼
  SecuredApp projectStrategy            createProjectService
  case "sessionPermission":             (new: @langwatch/api sibling
    [sessionAuth,                        of createManagementService)
     requireSessionProjectPermission]      guard() → { meta, middleware }
          │                                       │
          └──────────────► registry ◄─────────────┘
```

The 17 existing hand-rolled sites migrate incrementally; nothing forces a big
bang. Each migration deletes a session fetch, a permission check and a bespoke
error shape.

`createProjectService` is the session/project sibling of
`createManagementService`, and deliberately differs from it in three ways:

| | `createManagementService` | `createProjectService` |
|---|---|---|
| credential | organization API key | browser session cookie |
| scope | organization | project |
| plan gate | `requireEnterprisePlanRest` **mandatory** | none — these are product surfaces |

### 3. The ordering constraint, stated once

The pipeline is fixed and the guard sits before validation:

```
versionContext → auth → orgMw → resourceLimit → config.middleware → openapi
                                                       │
                                                       │  ◄── guard() runs HERE
                                                       ▼
                              validation → providers → handler
                                   │                      │
                                   └── input parsed HERE ─┘
```

So the enforcement middleware cannot read validated input, which is precisely
why `ProjectRef` is explicit rather than inferred. For `from: "body"` the
middleware calls `await c.req.json()`; Hono caches the parsed body in
`bodyCache` (`hono@4.13.1/dist/request.js:87-100`), so the validator that runs
afterwards re-reads the cache and never sees a consumed stream. Verified, not
assumed.

The body is *unvalidated* at that point, so the middleware treats a missing or
non-string `projectId` as a refusal, never as a crash — and the shape it
demands is one field, not the endpoint's schema.

### 4. The guard becomes tamper-evident

Closing the §"second, quieter hole". Two changes, and the second is the one that
actually holds:

- `guard()` returns its middleware under a key the endpoint author does not
  spell (`_guard`), which the mount step concatenates with any `middleware` the
  endpoint declares, rather than a key a later property silently replaces.
- `registerMountedRoute` refuses to mount when a route declares `meta.policy`
  whose enforcement is absent from the composed stack, and when `auth: "none"`
  appears on a route whose policy is not `public` or `internal`.

A test pins both: an endpoint that declares a policy and overrides its
enforcement must fail the build, the same way an endpoint that declares no
policy already does.

### 5. The prompt playground is the first consumer

```ts
const { service, guard } = createProjectService({
  name: "prompt-playground",
  basePath: "/api/prompt-playground",
});

service.version(PLAYGROUND_API_VERSION, (v) => {
  v.rpc("prompt.execute",
    { ...guard("prompts:view", { project: { from: "body", field: "projectId" } }),
      input: executeRequestSchema },
    (c, { input }) => streamSSE(c, (stream) => streamPromptExecution({ … })));
});
```

Every `c.json({ error })` in that handler becomes a thrown `HandledError` with a
stable `code`, a customer-safe message and an entry in the client presentation
registry — so the conversation can render our copy rather than a prose blob.
The failure modes it already has (`DatasetNotReadyError` → 425,
`LlmModelNotSetError` → 422) get codes instead of ad-hoc bodies.

## Consequences

**Good**

- The registry stops carrying declarations nothing enforces, for the largest
  class of route that had them.
- The error contract on browser endpoints stops being retyped per route, which
  is what made it diverge.
- `packages/api` is untouched; authz stays in the app layer where ADR-092 put it.
- A declared-but-unenforced policy becomes a build failure rather than an
  invisible one.

**Costs and risks**

- A new policy kind is a new thing to learn, and `handlerManagedAuth` remains
  for the genuinely bespoke cases (signature checks, CLI device flow). The line
  is: if the gate is "a session plus an RBAC permission", it is declarative now.
- `from: "body"` couples the guard to a field name. That is why the reference is
  explicit and reviewable rather than a convention.
- Migrating 17 families is real work and is deliberately incremental. The ADR
  does not require it to be finished before the playground lands.
- `X-Project-Id` already means "the project an org key is acting on". Reusing it
  for `from: "header"` needs care so the two readings cannot be confused; the
  safest first move is to ship `body` and `param` only, and add `header` when a
  route actually wants it.

## Appendix: acceptance criteria

These are the scenarios the implementing PR must write into
`specs/api/session-authenticated-endpoints.feature` **and bind**. They live here
rather than in a `.feature` file on this branch on purpose: `check-feature-parity`
refuses a file in which every scenario is `@unimplemented` ("0 of 17 scenarios
enforced"), and it is right to — an all-parked file reads as specified while
enforcing nothing. A proposal records its acceptance criteria; a spec binds them.

**The declared policy enforces**

- A signed-in user holding the permission reaches the handler
- An anonymous caller is refused before the handler runs
- A signed-in user without the permission is refused
- An API key does not reach a session route
- Every refusal carries a stable code

**Locating the project**

- The project is read from a declared body field
- The handler still receives the whole validated body
- A request naming no project is refused, not crashed
- A project the user cannot see reads as refused

**The registry tells the truth**

- A session route registers its permission
- A session route is not advertised as an API-key surface

**The guard cannot be silently disarmed**

- Overriding an endpoint's middleware does not drop its guard
- Disabling authentication on a guarded endpoint fails the build
- An endpoint declaring no policy still fails the build

**The playground, as the first consumer**

- A viewer can run a prompt in the playground
- Execution is refused without permission to view prompts
- A dataset that is still normalising is reported as such

## Deployment Impact

None. No chart, service, environment variable or migration change. The new
policy kind is internal to the app; no published document changes, and the
playground endpoint is excluded from the OpenAPI spec on purpose
(`openapi-route-exclusions.ts`) both before and after.
