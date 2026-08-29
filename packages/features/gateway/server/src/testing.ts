/**
 * Test-only concrete capability access for feature characterization suites.
 *
 * Reachable only from here on purpose. The package's public surface is its
 * barrel and the named composition subpaths; a service and a repository behind
 * them are implementations of ports, and application code importing one
 * directly is how the port stops being the seam.
 *
 * A characterization suite is the one caller with a reason: spend accounting
 * asserted against an in-memory double asserts the double, not the ClickHouse
 * arithmetic that actually bills. So the access is named as test-only here
 * rather than opened to everyone.
 */
export { GatewayUsageService } from "./services/gateway-usage.service";
export { GatewayBudgetClickHouseRepository } from "./repositories/clickhouse/clickhouse.gateway-budget.repository";
