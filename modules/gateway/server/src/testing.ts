/**
 * Test-only concrete capability access for characterization suites (e.g. spend accounting
 * asserted against real ClickHouse arithmetic, not an in-memory double). Application code
 * importing a service/repository directly would make the port stop being the seam.
 */
export { GatewayUsageService } from "./services/gateway-usage.service.ts";
export type { GatewayService } from "./services/gateway.service.ts";
export { PostgresVirtualKeyAdapter } from "./adapters/postgres.virtual-key.adapter.ts";
export { GatewayBudgetLedgerAdapter } from "./adapters/gateway-budget-ledger.adapter.ts";
export {
  PrismaGatewayAdapter,
  type GatewayPersistence,
} from "./adapters/prisma.gateway.adapter.ts";
export { GatewayBudgetSpend } from "./ports/gateway-budget-spend.port.ts";
/** The complete Project contract fake the budget suites compose against; named
 *  here so a suite in another package composes the same one rather than
 *  carrying a second copy of thirty stub methods. */
export { TestProjectApi } from "./__tests__/support/test-project-api.ts";
/** The Prisma-backed trace-destination half of that fake, for a process suite
 *  that composes the gateway over real rows. */
export { TraceDestinationProjectService } from "./__tests__/support/trace-destination-project-service.ts";
