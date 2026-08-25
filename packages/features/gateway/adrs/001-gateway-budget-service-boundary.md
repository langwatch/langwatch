# ADR-001: Extract Gateway budget decisions behind one service

**Status:** Accepted

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

`PrismaGatewayAdapter` binds the process Prisma client and accepts the
existing ClickHouse budget reader as a composition callback. It constructs
the private repository once and returns the one Gateway service. The
application composition hook is intentionally deferred: it must bind that
adapter and replace `app.gateway.budgetDecisions` without changing any
transport. Until that hook lands, compatibility routes remain on the legacy
service.
