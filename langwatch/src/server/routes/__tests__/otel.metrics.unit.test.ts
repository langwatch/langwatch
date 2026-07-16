// The implementation tests are kept in the integration-named module so they
// can also be run with the integration test project when the route stack is
// exercised there. Re-exporting the module makes them part of the default
// unit-test pass as well.
import "./otel.metrics.integration.test";
