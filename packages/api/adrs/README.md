# API architecture decisions

These decisions define the reusable API service framework:

- [API framework boundary](./20260820-api-framework-boundary.md)
- [RPC and REST share one fluent handler contract](./001-rpc-first-fluent-registration.md)
- [Explicit version namespaces](./002-explicit-version-namespaces.md)
- [Endpoint capabilities are ports](./003-endpoint-capabilities-are-ports.md)
- [Public REST v1 and date negotiation](./004-public-rest-v1-and-date-negotiation.md)

API family decisions live with their owning feature or in the central
[application ADR index](../../../dev/docs/adr/README.md). The ownership and
trust boundary between public REST and internal tRPC is defined by
[ADR-128](../../../dev/docs/adr/128-public-rest-and-internal-trpc.md).
