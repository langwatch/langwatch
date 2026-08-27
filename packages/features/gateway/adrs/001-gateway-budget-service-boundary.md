# ADR-001: Extract Gateway budget decisions behind one service

**Status:** Accepted

## Context

The first Gateway slice is the request-time budget decision. It is the
capability already shared by the Go gateway, CLI compatibility route, user
route, and Gateway budget APIs. One process-owned `GatewayService` owns the
decision; callers do not construct a budget service per request.

The service validates its input with the Gateway contract, owns the private
budget repository boundary, prefers authoritative ClickHouse spend when
available, and preserves the existing decision, warning, block, and scope
response fields. Virtual-key CRUD, usage reads, routing, cache rules, and
guardrails remain residual Gateway migrations and are not duplicated in this
slice.

## Decision

`PrismaGatewayAdapter` is composed once with the process Prisma client,
Project service, and optional ClickHouse spend port. It constructs Gateway's
private repositories and one `GatewayService`.

Gateway obtains trace destination and project ownership through the complete
`ProjectService` contract. Its repositories load only Gateway-owned keys,
budget rows, membership facts, and spend data. The service applies reachability
policy after Project resolves the stored destinations.

Existing REST, tRPC, Go-gateway, and CLI transports keep their current shapes
and read the composed service. Virtual-key CRUD, usage, routing, cache rules,
and guardrails remain later vertical cuts.

## Contracts and validation

The contract owns portable budget inputs, results, errors and the canonical
`GatewayService`. Zod 4 validates values entering that boundary; Prisma types
remain private to repository adapters.

## Persistence

Gateway repositories own budget, key, membership, audit and spend persistence.
Project identity, organization ownership and trace destinations come from the
complete `ProjectService`, never a Gateway-owned Project query.

## Dependencies

The concrete service receives its private Gateway repository and the complete
Project service. ClickHouse spend is an optional process-composed repository
dependency, not a second budget service.

## Public surfaces and transports

Existing REST, tRPC, Go Gateway and CLI names and response shapes do not change.
Those transports call the same process-owned service.

## Runtime and registration

The API and worker composition roots construct one Gateway service. Request
handlers and jobs receive it from their process application graph.

## Environment and configuration

Gateway packages do not read environment variables. Boot validates virtual-key
pepper and other runtime configuration once and injects semantic values.

## Errors

Ordinary service methods return a result or throw a concrete Gateway contract
error. Only `try*` methods expose absence.

## Consequences

Later Gateway slices join this service rather than creating another budget
implementation.

See [the executable feature contract](../specs/gateway-budget-service.feature).
