/**
 * Test-only concrete capability access for characterization suites (e.g. spend accounting
 * asserted against real ClickHouse arithmetic, not an in-memory double). Application code
 * importing a service/repository directly would make the port stop being the seam.
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
