/**
 * Test-only concrete capability access for feature characterization suites, reachable only from here — the package's public surface is its barrel + named composition subpaths, and application code importing a service/repository directly would be the port ceasing to be the seam. A characterization suite (e.g. spend accounting asserted against the actual ClickHouse arithmetic, not an in-memory double) is the one caller with a reason, so access is named test-only rather than opened to everyone.
 */
export { GatewayUsageService } from "./services/gateway-usage.service";
export type { GatewayService } from "./services/gateway.service";
export { PostgresVirtualKeyAdapter } from "./adapters/postgres.virtual-key.adapter";
export { GatewayBudgetLedgerAdapter } from "./adapters/gateway-budget-ledger.adapter";
export { PrismaGatewayAdapter, type GatewayPersistence } from "./adapters/prisma.gateway.adapter";
export { GatewayBudgetSpendPort } from "./ports/gateway-budget-spend.port";
/** The complete Project contract fake the budget suites compose against; named
 *  here so a suite in another package composes the same one rather than
 *  carrying a second copy of thirty stub methods. */
export { TestProjectService } from "./__tests__/support/test-project-service";
