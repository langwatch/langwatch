# @langwatch/authz-contract

The portable AuthZ contract and pure decision domain. Browser and server code
share this one root export for:

- the append-only permission registry and vocabulary;
- Zod 4 schemas for principals, scopes, decisions, grant commands, event
  payloads, queries, and handled problem shapes;
- the pure `AuthzEngine`, role expansion, declarations, and bitsets;
- abstract `AuthzService` and `AuthzGrantsService` capabilities.

The package imports no Node, Prisma, Redis, Eventing, Hono, tRPC, or application
source. Eventing owns its envelopes; the schemas here describe only portable
command data and event payloads.

`Authorized<Tier, Permission>` is an opaque proof returned by
`AuthzService.authorize` or `requirePermission`. There is no witness subpath or
public mint function. A concrete service subclass may mint a witness only
through its protected capability after an allowed decision.

The permission registry order is a wire invariant because bitsets use its
indices. Existing resources and actions are never reordered or removed; new
ones are appended.
