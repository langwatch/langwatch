# RPC and REST share one fluent handler contract

**Date:** 2026-08-20

**Status:** Proposed

**Behavioural contracts:**
[../specs/rpc-endpoints.feature](../specs/rpc-endpoints.feature),
[../specs/fluent-registration.feature](../specs/fluent-registration.feature)

**Related:**
[the API framework boundary](./20260820-api-framework-boundary.md),
[explicit version namespaces](./002-explicit-version-namespaces.md),
[endpoint capabilities are ports](./003-endpoint-capabilities-are-ports.md),
[the unified authorization engine](../../../dev/docs/adr/092-unified-authorization-engine.md),
[API discovery](../specs/api-discovery.feature).

## Context

REST keeps method and argument location as transport concerns. Those concerns
must not leak into handlers as raw Hono reads or create a weaker validation
boundary. RPC and REST are both first-class: RPC uses a dotted name and
body-only input, while REST keeps explicit HTTP methods and resource URLs. Both
use the same handler and schema discipline.

The version-block API had a second, quieter problem: an endpoint's identity
was scattered across `.version()` callbacks. Overriding an endpoint in a later
version meant re-declaring it inside a different block, so reading one block
never told you what an endpoint actually does today. And every new capability
— resource limits, deprecation, caching — changed the registration call's
shape, which is why several of them were never added.

## Decision

### 1. RPC uses operation names

`service.register(name, version, handler, define?)` registers an RPC endpoint.
The name is an identifier, not a URL path: no leading slash, dotted
lower-camel segments, at least one dot, no parameters:

```text
^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$   →  things.create       ✓
                                              /things.create       ✗
                                              things/:id           ✗
                                              things.Roll_Secret   ✗
```

Every RPC is a POST. Every argument travels in the JSON body — no path params,
no query string — which is what puts zod on identifiers a REST `:id` left
unvalidated. An RPC with no required arguments declares no `input`; the
pipeline installs the JSON validator only when `input` is present, so a
bodyless POST and a `{}` POST both succeed. Reads are POST too: uniform method
is the point, and it forecloses HTTP caching, which is acceptable on an
API-key-only management surface.

### 2. Handlers take context and input, nothing else

```ts
service.register(
  "things.create",
  "2026-08-07",
  async (context, input) =>
    context.app.things.create({ ...input, actorId: context.actor().id }),
  (b) =>
    b
      .withInput(z.object({ name: z.string() }))
      .withOutput(thingSchema)
      .withDocs({ operationId: "createThing", tags: ["Things"] })
      .withDeprecated("use things.createV2 after 2026-11-01"),
);
```

The handler signature is `(context, input)` — the Hono context and the
validated input, positionally. There is no destructured bag. The process owns
one composed application instance and the host exposes it as `context.app`;
feature handlers do not resolve or construct services per request. The host
also exposes the authenticated principal as `context.actor()` and an
input-dependent permission check as `context.authorize(permission)`. Static
permissions still belong on `withPermission`; `authorize` is only for a second
permission selected from already-validated input. REST path, query and body
schemas are validated separately for OpenAPI, then their transformed object
fields are merged into that same `input` argument. Fields may not be declared
by more than one source. An endpoint with no request values receives `input`
as `undefined`. `registerSse` handlers take `(context, stream)`, a stream having
no body.

Project-scoped RPCs carry `projectId` in their input so credentials that can
reach more than one project can choose a target. The host must compare that
value with the project selected and authorized by authentication before the
handler runs. A caller cannot gain tenancy by choosing an arbitrary body value.

The registration types require an input source when the handler declares an
input parameter and require `withOutput` when the handler returns data. Every
REST route requires `withOutput`, including `z.void()` for no body. Registration
and response serialization repeat those checks at runtime.

### 3. The definition chain is the only extension point

The existing endpoint config fields re-home onto the chain: `withInput`,
`withOutput`, `withParams`, `withQuery`, `withStatus`, `withDocs`, `withAuth`,
`withResourceLimit`, `withMiddleware`, `withMeta`. The two text-carrying ones
are not interchangeable: `withDocs` is the documentation channel — title
(`summary`), `description`, `operationId`, `tags`, extra responses — and
everything in it reaches the published OpenAPI operation. `withMeta` is the
opaque channel the framework never reads: it travels on the mount report so
hosts can attach route policies, and nothing in it is documentation. New
capabilities — `withRateLimit`, `withCache`, `withDeprecated`
([003](./003-endpoint-capabilities-are-ports.md)) — are chain calls. A new
capability never changes the `register` signature, which is what makes the
chain worth its indirection.

### 4. Capabilities may be declared at service level

A `.withX()` on the service builder is the default for every endpoint.
Endpoint-level re-declaration wins. `withMiddleware` stacks — service
middleware runs before endpoint middleware. `withAuth` keeps its existing
override semantics, including `"none"`, but it controls credential middleware
only. It never classifies a route as public. The LangWatch composition root
requires every mount to carry an access policy through `withMeta`; its
`guard(permission)` helper produces that policy and the authorization
middleware from the same declaration, while deliberately public routes
register a public policy with a written reason. A missing policy fails the
build. This is the seam through which the app-owned authorization runtime in
[092](../../../dev/docs/adr/092-unified-authorization-engine.md) plugs in; the
framework does not import that runtime or its grants ledger. The contract is
audited by
[api-endpoint-authorization.feature](../../../specs/security/api-endpoint-authorization.feature).
`withCache` and `withRateLimit` have
explicit opt-outs — `.withoutCache()` / `.withoutRateLimit()` — because a
service-wide default for either needs an escape hatch. There is no opt-out
from a service-level `withDeprecated`: a deprecated service is deprecated.

### 5. Groups share a chain across endpoints

`service.group(name, define?)` returns a registrar with the same methods —
`register`, `registerSse`, `registerRoute`, `withdraw` — whose chain declares
defaults for everything registered through it:

```ts
const things = service.group("things", (b) =>
  b.withDocs({ tags: ["Things"] }).withRateLimit(),
);

things.register("create", "2026-08-07", createHandler, (b) =>
  b.withInput(createSchema).withOutput(thingSchema),
);
things.registerSse("watch", "2026-08-07", watchHandler, (b) =>
  b.withEvents({ result: resultSchema }),
);
```

The precedence ladder is service < group < endpoint: a re-declaration closer
to the endpoint wins, middleware stacks in that order, and the opt-outs are
unchanged. A dotted name registered through a group is prefixed with the
group's name — the example registers `things.create` and `things.watch` — and
the grammar check runs on the full name, so a group cannot smuggle in a name
`register` would refuse. `registerRoute` paths are used as-is; REST paths
already carry their shape. Groups do not nest, and a group carries no
version: the version stays explicit on every registration.

### 6. REST and SSE keep their own verbs

Two shapes cannot be dotted-name POSTs and get their own registration methods
with the same chain:

- `service.registerRoute(method, path, version, handler, define)` for the
  HTTP surface. `withParams`, `withQuery` and `withInput` declare path, query
  and body sources; handlers receive their parsed object fields as one input.
  GET has no JSON body source, and every `:param` in the path requires
  `withParams`. REST handlers return values, never a hand-built `Response` that
  bypasses output validation.
- `service.registerSse(name, version, handler, define?)` with
  `.withEvents(...)` / `.withQuery(...)`: a dotted name mounted as a GET, per
  [../specs/sse-streaming.feature](../specs/sse-streaming.feature).

### 7. Version blocks are gone

`.version(date, callback)` is replaced by the version argument on each
registration. The version catalogue is the union of versions named in
`register` calls, and inheritance falls out of the data: an endpoint serves at
version V its latest registration dated on or before V. Withdrawal is
explicit: `service.withdraw(name, version)`. The URL consequences are
[002](./002-explicit-version-namespaces.md).

### 8. Every rule is enforced twice

The name grammar and the no-`params`/`query` rule are enforced by the types on
`register` and again by startup asserts. Types are erased, so the asserts are
what still holds for a JavaScript caller, a config widened on its way through
a helper, or anything behind an `any`. One test table drives both statements,
so a change to either that forgets the other fails there.

`isRpcPath` exports the grammar for consumers that must recognise an RPC name
after the fact — the platform's discovery catalogue reads operations back out
of the published OpenAPI document with it. A consumer asks the grammar rather
than writing a second regex that agrees until one of them changes.

## Alternatives considered

Keeping separate REST and RPC handler contracts was rejected: transport shape
does not justify separate validation, service access or error behaviour.

Allowing GET for RPC reads was rejected: it splits the surface, invites HTTP
caching of calls that were never designed for it, and buys nothing an
API-key-only management surface needs.

Keeping the leading slash on RPC names was rejected: the name is an
identifier, and the slash invited `:param` thinking — every rejected grammar
in the pilot's test table started life as someone typing a URL.

A terminal `.handle()` on the chain was rejected in favour of the handler as
the third argument: handler-next-to-name keeps the call sites uniform between
endpoints that declare a definition and endpoints that do not, and a terminal
call makes chains read as if intermediate results were valid registrations.

The destructured handler bag — `(c, { input, params, query, app })` — was
rejected: it made every handler name four concepts it usually ignores, hid the
common case (context plus input) inside an object literal, and gave domain
services a framework type to depend on. Two positional arguments match Hono's
own idiom, and everything the bag carried moves to typed context variables.

Prefixless groups — shared defaults without the name prefix — were rejected:
the resource segment is the grouping axis RPC names already have, and a group
whose defaults land on names it does not own is a service default with worse
visibility. Nested groups were rejected for now: service, group and endpoint
is already a three-rung ladder, and deeper ladders make precedence questions
unanswerable at review.

Version blocks were kept through the pilot and rejected here: an override
inside a later block is invisible from the earlier one, and the blocks forced
endpoint identity to be re-keyed on every version bump.

## Consequences

- One authoring style to teach; the rejected forms fail in the editor and at
  startup, not in review.
- The discovery catalogues become the machine-readable index of the surface:
  every service serves its own `rpc.discover`, and the root `rpc.discover`
  links to all of them. Both are projections of the same registrations the
  document is generated from, so neither can drift from the document.
- Hosts generating specs must pass `excludeStaticFile: false`; dotted paths
  are otherwise dropped as static files, silently. This trap is pinned by
  test, not by documentation.
- HTTP/Hono routes use `registerRoute`; the framework preserves their verbs
  and URLs without giving them a second handler contract.
- `withRateLimit`, `withCache` and `withDeprecated` arrive with the chain they
  hang off; the port contracts are [003](./003-endpoint-capabilities-are-ports.md).
