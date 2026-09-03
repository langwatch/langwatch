# ADR-128: Public REST and internal tRPC are separate transport surfaces

**Date:** 2026-08-28

**Status:** Accepted

## Context

LangWatch has accumulated public REST, public RPC, Next.js API routes and tRPC
procedures that reach the same product features in different ways. Some
transports construct or locate services, some contain application logic, and
some define their own version of a feature's input or output. That makes a
feature move incomplete even when its domain service has moved: transport code
still owns part of the behaviour.

The public API and the first-party browser have different needs. Public callers
need ordinary HTTP semantics, OpenAPI, runtime response validation and stable
version negotiation. The browser needs a type-safe, low-boilerplate connection
to our own backend. Making either transport imitate the other weakens one of
those boundaries and does not justify a second implementation of the feature.

## Decision

### Transport roles

Modern public integrations use REST. The first-party UI uses tRPC. Both are
adapters over the same composed feature services; neither is a domain or
application layer.

Existing public RPC and legacy REST routes are compatibility surfaces, not
patterns for new endpoints. They remain unchanged until the owning feature
deliberately replaces or removes them. A migration preserves existing URLs,
inputs, outputs, error semantics, ordering and pagination unless its accepted
scope says otherwise.

### Ownership

The physical ownership is:

```text
packages/features/<feature>/contract  portable schemas, values, errors, service
packages/features/<feature>/server    service implementation and thin adapters
packages/features/<feature>/web       reusable browser behaviour and a small port
apps/api                              app graph, transport roots and middleware
apps/ui                               routing and the real tRPC client adapter
```

A feature's server package may export a public REST installer and an internal
tRPC router fragment. They call the canonical feature service exposed by the
request context. They do not construct services, import repositories, access
Prisma or environment variables, or contain business decisions. `apps/api`
constructs one application graph per process and composes both transport roots.

Hono handlers use `context.app`, `context.actor()` and
`context.authorize()`. tRPC procedures use the equivalent `ctx` members. A
handler validates and authorises one target, applies transport policy, and
calls exactly one feature service operation. It does not catch a domain error
merely to translate it into another domain error.

Feature web packages may depend on contract types and a small named browser
port. They do not import a server router or the complete application-router
type. `apps/ui` owns the actual tRPC client and supplies that port.

### Public REST

Every modern REST endpoint declares one Zod 4 input schema and one output
schema. `z.void()` represents an absent value. The framework validates the
complete input and the returned output at runtime.

Authors do not split an operation into path, query and body schemas. The
framework merges path fields with query fields for GET and with a JSON object
body for POST, PUT, PATCH and DELETE, then parses the complete input once.
Route registration is schema-first and finishes with `.handle()`.

The public URL and date negotiation are defined by the API package's
[public REST ADR](../../../packages/api/adrs/004-public-rest-v1-and-date-negotiation.md):

```text
/api/v1/{service}/{endpoint}
/api/v1/{service}/{YYYY-MM-DD|latest}/{endpoint}
```

`v1` is the static API generation. An optional date or `latest` may be selected
in the URL or, when absent there, by header. Additive changes do not require a
new date contract. Removing a field or changing its meaning does.

Public REST declares its authentication, exact authorisation target and
transport-specific limits. A credential that may reach several projects can
select one, including through `X-Project-Id`; the authenticated project and any
validated input `projectId` must agree before the service call. Request input
never selects the principal or grants itself access. Every endpoint declares a
rate/resource policy or an explicit, reasoned opt-out.

### Internal tRPC

tRPC validates input at runtime and derives its result type from the canonical
service and any compatibility mapper. It does not add a second runtime output
schema. This is a trusted first-party transport, not the public compatibility
contract.

Existing tRPC procedure names and result shapes remain stable while their
implementation moves. A compatibility mapper may preserve an old browser
shape, but it stays in the adapter and contains no domain behaviour.

### Errors and middleware

Authentication, authorisation, validation, transport limits, audit/trace
context and error serialization are middleware responsibilities. Feature
handlers let concrete `HandledError` instances propagate to that boundary.
Internal tRPC preserves trusted handled-error semantics losslessly. Public
REST exposes only the client-safe handled-error contract; it does not accept or
echo caller-supplied explanatory text, documentation links or presentation
metadata. Unknown errors remain unknown and are recorded server-side.

Architecture checks enforce the durable shape: transport adapters may use
schemas, access declarations, limits and the composed service, but not
repositories, database clients, service construction, environment access or
business branching.

## Consequences

There is one implementation of feature behaviour and two intentionally
different transport contracts. Public API consumers get normal HTTP, OpenAPI,
runtime output validation and explicit compatibility. The UI keeps tRPC's
first-party type ergonomics without making the server router part of a feature
web package's public surface.

The API application owns more composition and middleware, and parity tests
must cover every compatibility adapter. tRPC has no runtime output guard, so
service types and compatibility characterisation remain important. Public
REST pays the cost of output parsing because it is the untrusted, published
boundary.

Using tRPC for public integrations was rejected because it exposes a
TypeScript-oriented protocol and weakens ordinary HTTP and OpenAPI support.
Using REST for the browser was rejected because it adds client plumbing without
improving the trusted first-party boundary. Defining all handlers in `apps/api`
or implementing a service per transport was rejected because both scatter
feature ownership and allow behaviour to diverge.

## References

- [ADR-045: Handled errors](./045-domain-errors-handled-boundary.md)
- [ADR-101: Feature package surfaces](./101-feature-package-surfaces.md)
- [ADR-103: Standard Schema API boundary](./103-standard-schema-api-boundary.md)
- [ADR-111: Physical application workspaces](./111-physical-application-workspaces.md)
- [API framework boundary](../../../packages/api/adrs/20260820-api-framework-boundary.md)
- [API endpoint capabilities](../../../packages/api/adrs/003-endpoint-capabilities-are-ports.md)
