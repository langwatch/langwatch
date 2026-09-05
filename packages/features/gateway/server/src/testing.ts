/**
 * Test-only concrete capability access for feature characterization suites, reachable only from here — the package's public surface is its barrel + named composition subpaths, and application code importing a service/repository directly would be the port ceasing to be the seam. A characterization suite (e.g. spend accounting asserted against the actual ClickHouse arithmetic, not an in-memory double) is the one caller with a reason, so access is named test-only rather than opened to everyone.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import { VirtualKeyCryptoAdapter } from "./adapters/virtual-key-crypto.adapter";
import { PrismaGatewayAuditRepository } from "./repositories/prisma/prisma.gateway-audit.repository";
import { PrismaGatewayChangeEventsRepository } from "./repositories/prisma/prisma.gateway-change-event.repository";
import { PrismaGatewayVirtualKeyRepository } from "./repositories/prisma/prisma.virtual-key.repository";
import { PrismaGatewayKeyBudgetRepository } from "./repositories/prisma/prisma.gateway-key-budget.repository";
import { PrismaGatewayScopeResolutionRepository } from "./repositories/prisma/prisma.gateway-scope-resolution.repository";
import { PrismaGatewayTransactionAdapter } from "./adapters/prisma.gateway-transaction.adapter";
import { GatewayScopeResolutionService } from "./services/gateway-scope-resolution.service";
import { VirtualKeyService } from "./services/virtual-key.service";

export { GatewayUsageService } from "./services/gateway-usage.service";

/**
 * The write-path service wired to this deployment's Postgres, with a fixed
 * test pepper. Characterization suites assert against real rows, so they
 * compose the concrete repositories the way a process does.
 */
export function createVirtualKeyServiceForTest(
  prisma: PrismaClient,
  projects: ProjectService,
): VirtualKeyService {
  return VirtualKeyService.create({
    transactions: PrismaGatewayTransactionAdapter.create({ database: prisma }),
    keyBudgets: PrismaGatewayKeyBudgetRepository.create({ database: prisma }),
    scopeResolution: GatewayScopeResolutionService.create({
      repository: PrismaGatewayScopeResolutionRepository.create({ database: prisma }),
    }),
    projects,
    repository: PrismaGatewayVirtualKeyRepository.create(prisma),
    changeEvents: PrismaGatewayChangeEventsRepository.create(prisma),
    auditLog: PrismaGatewayAuditRepository.create(prisma),
    crypto: VirtualKeyCryptoAdapter.create({ pepper: "test-virtual-key-pepper" }),
  });
}
