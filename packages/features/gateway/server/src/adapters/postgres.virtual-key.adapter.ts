import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import { PrismaGatewayAuditRepository } from "../repositories/prisma/prisma.gateway-audit.repository";
import { PrismaGatewayChangeEventsRepository } from "../repositories/prisma/prisma.gateway-change-event.repository";
import { PrismaGatewayKeyBudgetRepository } from "../repositories/prisma/prisma.gateway-key-budget.repository";
import { PrismaGatewayScopeResolutionRepository } from "../repositories/prisma/prisma.gateway-scope-resolution.repository";
import { PrismaGatewayVirtualKeyRepository } from "../repositories/prisma/prisma.virtual-key.repository";
import { GatewayScopeResolutionService } from "../services/gateway-scope-resolution.service";
import { VirtualKeyService } from "../services/virtual-key.service";
import { VirtualKeyCryptoAdapter } from "./virtual-key-crypto.adapter";
import { PrismaGatewayTransactionAdapter } from "./postgres.gateway-transaction.adapter";

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
