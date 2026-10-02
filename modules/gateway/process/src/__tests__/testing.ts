/**
 * Test-only concrete capability access for characterization suites (e.g. spend accounting
 * asserted against real ClickHouse arithmetic, not an in-memory double). Application code
 * importing a service/repository directly would make the port stop being the seam.
 */
export type { GatewayService } from "../services/gateway.service.ts";
export { PostgresVirtualKeyAdapter } from "./support/postgres.virtual-key.ts";
export { GatewayBudgetClickHouseRepository } from "../repositories/clickhouse/clickhouse.gateway-budget.repository.ts";
export { PrismaGatewayAdapter, type GatewayPersistence } from "../app/gateway-composition.build.ts";
/** The Prisma-backed trace-destination project fake, for a process suite
 *  that composes the gateway over real rows. */
export { createTraceDestinationProjects } from "./support/trace-destination-project-service.ts";
