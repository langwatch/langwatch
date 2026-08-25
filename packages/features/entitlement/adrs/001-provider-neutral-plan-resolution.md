# ADR-001: Entitlements resolves plans without enterprise dependencies

**Date:** 2026-08-21

**Status:** Accepted

**Behavioural contract:**
[Provider-neutral entitlement resolution](../specs/entitlement-resolution.feature)

**Related:**
[ADR-101: feature package surfaces](../../../../dev/docs/adr/101-feature-package-surfaces.md).

## Context

Core product code needs to ask which capabilities and limits apply to an
organization. Today that vocabulary is split between the core subscription
layer, enterprise Billing and enterprise Licensing. Core provider interfaces
import enterprise `PlanInfo`, Billing imports Licensing, and Licensing imports
Billing plan types. The dependency cycle makes a Stripe concern appear to be a
core product contract.

Billing and licensing are sources of entitlement information, not the owner of
the question. Self-hosted installations also need a useful baseline when no
enterprise implementation is present.

## Decision

Create a core Entitlements feature with two physical packages:

```text
packages/features/entitlement/
├── contract/                 # @langwatch/entitlement-contract
├── server/                   # @langwatch/entitlement-server
├── adrs/
└── specs/
```

The contract owns the provider-neutral `Plan`, `PlanSource`, `PlanProvider`,
`PlanProviderUser` and source/enricher interfaces. Plans describe capabilities,
limits and provenance without Stripe identifiers, signed-license structures,
Prisma records or enterprise plan implementation types.

The server owns deterministic source selection and entitlement enrichment. A
valid non-free license plan wins; otherwise an active subscription plan wins;
otherwise the core free plan is returned. Authorization context such as an
operator impersonation override is applied after source selection rather than
encoded by a billing provider.

Enterprise Billing and Licensing each implement Entitlements contracts. Core
consumers depend only on `@langwatch/entitlement-contract`. An application
composition root supplies the installed sources in their declared precedence;
core packages never import enterprise implementations.

This decision does not require extracting Billing in the first implementation
slice. Existing Billing and Licensing implementations may initially provide
adapters from their current locations while Entitlements becomes the stable
contract and selection service between them and core consumers.

No Entitlements web package is created until Entitlements owns independent
browser behaviour. Billing and other feature web packages may display values
from the contract.

### Public surfaces and transports

Entitlements exposes a contract package and a server capability. It has no
public HTTP, internal RPC, worker or web surface of its own; callers receive the
class instance from a composition root.

### Dependencies

Core consumers depend only on `@langwatch/entitlement-contract`. Billing and
Licensing implement its ports, and the composition root injects their
instances. Entitlements never imports an enterprise implementation or another
feature server.

### Persistence

Entitlements owns no database table or repository. Provider adapters may read
their own persistence, but they return the provider-neutral contract values
before selection begins.

### Runtime and registration

`EntitlementService` is a class created through `EntitlementService.create`.
Importing either package performs no registration. The app and worker may each
compose the service with the sources available to that runtime.

### Environment and configuration

Neither package reads environment variables. Source availability and
precedence arrive as typed constructor options after the app or worker has
validated its environment.

### Errors

Provider failures remain explicit thrown errors unless a provider contract
defines a handled absence. Singular lookups do not encode missing values as a
successful nullable result.

### Contracts and validation

Zod schemas define plans, sources, provider users and resolution inputs.
TypeScript types are inferred from those schemas, and the contract package has
an independent declaration build so transport and provider adapters consume
the same compiled vocabulary.

## Alternatives considered

Putting the shared plan contract in enterprise Billing would require every
core limit check to depend on Stripe-owned code. Putting it in Licensing would
reverse the same problem for SaaS subscriptions. Keeping the current core
subscription folder while it imports both enterprise implementations leaves
the cycle intact.

## Consequences

- Core features can enforce limits without an enterprise dependency.
- Billing and Licensing become interchangeable entitlement sources rather than
  mutually importing implementations.
- Source precedence is visible and tested in one service.
- A new core feature and additional dependency injection are required.
- Provider-specific fields must be translated before a plan crosses the
  Entitlements contract.
