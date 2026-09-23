import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";

import { PrismaGatewayTransactionAdapter } from "../app/postgres.gateway-transaction.ts";
import { PrismaGatewayAuditRepository } from "../repositories/prisma/prisma.gateway-audit.repository.ts";
import { PrismaGatewayChangeEventsRepository } from "../repositories/prisma/prisma.gateway-change-event.repository.ts";
import { PrismaGatewayKeyBudgetRepository } from "../repositories/prisma/prisma.gateway-key-budget.repository.ts";
import { PrismaGatewayScopeResolutionRepository } from "../repositories/prisma/prisma.gateway-scope-resolution.repository.ts";
import { PrismaGatewayVirtualKeyRepository } from "../repositories/prisma/prisma.virtual-key.repository.ts";
import {
  GatewayScopeResolutionService,
  type GatewayPlatformProviders,
} from "../services/gateway-scope-resolution.service.ts";
import { VirtualKeyCryptoService } from "../services/virtual-key-crypto.service.ts";
import { VirtualKeyService } from "../services/virtual-key.service.ts";

/** A deployment holding no provider keys of its own, which is what a self-hosted install is. */
const NO_PLATFORM_PROVIDERS: GatewayPlatformProviders = {
  platformProviderChain: () => Promise.resolve([]),
};

/**
 * The write-path service wired to this deployment's Postgres, with a fixed
 * test pepper. Characterization suites assert against real rows, so they
 * compose the concrete repositories the way a process does.
 */
function createVirtualKeyServiceForTest(
  prisma: ProcessMembers["prisma"],
  projects: ProjectApi,
): VirtualKeyService {
  return VirtualKeyService.create({
    transactions: PrismaGatewayTransactionAdapter.create({ database: prisma }),
    keyBudgets: PrismaGatewayKeyBudgetRepository.create({ database: prisma }),
    scopeResolution: GatewayScopeResolutionService.create({
      repository: PrismaGatewayScopeResolutionRepository.create({ database: prisma }),
      platformProviders: NO_PLATFORM_PROVIDERS,
    }),
    projects,
    repository: PrismaGatewayVirtualKeyRepository.create(prisma),
    changeEvents: PrismaGatewayChangeEventsRepository.create(prisma),
    auditLog: PrismaGatewayAuditRepository.create(prisma),
    crypto: VirtualKeyCryptoService.create({ pepper: "test-virtual-key-pepper" }),
  });
}

export class PostgresVirtualKeyAdapter {
  private constructor() {}

  static create(): PostgresVirtualKeyAdapter {
    return new PostgresVirtualKeyAdapter();
  }

  static createVirtualKeyServiceForTest = createVirtualKeyServiceForTest;
}
