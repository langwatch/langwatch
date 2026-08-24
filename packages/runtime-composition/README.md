# Runtime Composition

`@langwatch/runtime-composition` is the portable foundation shared by the API,
worker, and contributor-only combined runtime. It provides typed capabilities,
immutable feature declarations, closed runtime graph construction, and ordered
resource ownership without importing transports, infrastructure clients,
application source, or ambient configuration.

The architecture is defined by
[ADR-102](../../dev/docs/adr/102-runtime-composition-roots.md), refined by
[ADR-111](../../dev/docs/adr/111-physical-application-workspaces.md), and the
[runtime composition specification](../../specs/dependencies/runtime-composition.feature).
