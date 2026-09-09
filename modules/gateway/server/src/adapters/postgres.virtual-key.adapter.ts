import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import { PrismaGatewayAuditRepository } from "../repositories/prisma/prisma.gateway-audit.repository.ts";
import { PrismaGatewayChangeEventsRepository } from "../repositories/prisma/prisma.gateway-change-event.repository.ts";
import { PrismaGatewayKeyBudgetRepository } from "../repositories/prisma/prisma.gateway-key-budget.repository.ts";
import { PrismaGatewayScopeResolutionRepository } from "../repositories/prisma/prisma.gateway-scope-resolution.repository.ts";
import { PrismaGatewayVirtualKeyRepository } from "../repositories/prisma/prisma.virtual-key.repository.ts";
import { GatewayScopeResolutionService } from "../services/gateway-scope-resolution.service.ts";
import { VirtualKeyService } from "../services/virtual-key.service.ts";
import { VirtualKeyCryptoAdapter } from "./virtual-key-crypto.adapter.ts";
import { PrismaGatewayTransactionAdapter } from "./postgres.gateway-transaction.adapter.ts";

/**
 * The write-path service wired to this deployment's Postgres, with a fixed
 * test pepper. Characterization suites assert against real rows, so they
 * compose the concrete repositories the way a process does.
 */
function createVirtualKeyServiceForTest(
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

export class PostgresVirtualKeyAdapter {
  private constructor() {}

  static create(): PostgresVirtualKeyAdapter {
    return new PostgresVirtualKeyAdapter();
  }

  static createVirtualKeyServiceForTest = createVirtualKeyServiceForTest;
}
