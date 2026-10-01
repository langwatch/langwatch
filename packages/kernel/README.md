# Runtime Composition

Feature declarations construct nothing. `await application.boot({ role })`
validates dependencies and constructs the graph. `runtime.start()` starts its
registered services; `runtime.stop()` closes them in reverse order before
releasing feature resources. Concurrent calls share their lifecycle result.

One declaration may contribute API transports and worker work. Boot constructs
only the selected role's contributions, once. Reading an unavailable
contribution throws; tasks construct neither transports nor worker work.

Setup remains synchronous. Register each acquired resource immediately with
`resources.own(name, close)` so partial setup failures can release it. Use
`withClose` for ownership of a completed app instead; do not register the same
resource through both paths. Boot awaits cleanup of the current and preceding
features before rejecting. Failed service starts also roll back, including the
partially started service. Cleanup continues after errors and aggregates them;
a boot or start failure remains the cause when its cleanup also fails.

`ResourceScope` implements close-once resource ownership. `GracefulShutdown`
adds process signal handling and deadlines. See
[ADR-133](../../../dev/docs/adr/133-composition-spec.md) for the shared contract.
