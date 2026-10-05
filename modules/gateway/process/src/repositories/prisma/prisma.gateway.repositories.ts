import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { GatewayBudgetSpendRepository } from "../gateway-budget-spend.repository.ts";
import type { GatewayRepositories } from "../gateway.repositories.ts";
import { PrismaGatewayAuditRepository } from "./prisma.gateway-audit.repository.ts";
import { PrismaGatewayBudgetRepository } from "./prisma.gateway-budget.repository.ts";
import { PrismaGatewayCacheRuleRepository } from "./prisma.gateway-cache-rule.repository.ts";
import { PrismaGatewayChangeEventsRepository } from "./prisma.gateway-change-event.repository.ts";
import { PrismaGatewayConnectUpstreamRepository } from "./prisma.gateway-connect-upstream.repository.ts";
import { PrismaGatewayGuardrailRepository } from "./prisma.gateway-guardrail.repository.ts";
import { PrismaGatewayInternalStoreRepository } from "./prisma.gateway-internal-store.repository.ts";
import { PrismaGatewayKeyBudgetRepository } from "./prisma.gateway-key-budget.repository.ts";
import { PrismaGatewayOrganizationDirectoryRepository } from "./prisma.gateway-organization-directory.repository.ts";
import { PrismaGatewayProviderLabelRepository } from "./prisma.gateway-provider-label.repository.ts";
import { PrismaGatewayRealtimeSessionRepository } from "./prisma.gateway-realtime-session.repository.ts";
import { PrismaGatewayScopeResolutionRepository } from "./prisma.gateway-scope-resolution.repository.ts";
import { PrismaGatewaySpendScopeRepository } from "./prisma.gateway-spend-scope.repository.ts";
import { PrismaGatewayTraceExportKeyRepository } from "./prisma.gateway-trace-export-key.repository.ts";
import { PrismaGatewayTransactionRepository } from "./prisma.gateway-transaction.repository.ts";
import { PrismaVirtualKeyDirectBudgetRepository } from "./prisma.gateway-virtual-key-direct-budget.repository.ts";
import { PrismaVirtualKeyAuthorizationRepository } from "./prisma.virtual-key-authorization.repository.ts";
import { PrismaGatewayVirtualKeyRepository } from "./prisma.virtual-key.repository.ts";

/** The gateway slots Postgres answers. */
export type GatewayPostgresRepositories = Pick<
  GatewayRepositories,
  | "virtualKeys"
  | "transactions"
  | "keyBudgets"
  | "changeEvents"
  | "audit"
  | "scopeResolution"
  | "virtualKeyAuthorization"
  | "organizationDirectory"
  | "budgets"
  | "cacheRules"
  | "guardrails"
  | "providerLabels"
  | "directBudgets"
  | "spendScope"
  | "connectUpstream"
  | "realtimeSessions"
  | "internalStore"
  | "traceExportKeys"
>;

/** Keys, budgets, rules and sessions over the one guarded Postgres connection. */
export class PostgresGatewayRepositories {
  static create({
    prisma,
    budgetSpend,
  }: Readonly<{
    prisma: PrismaClient;
    /** The ledger a budget's health reads its spend from. */
    budgetSpend: GatewayBudgetSpendRepository;
  }>): GatewayPostgresRepositories {
    const changeEvents = PrismaGatewayChangeEventsRepository.create(prisma);
    const audit = PrismaGatewayAuditRepository.create(prisma);

    return {
      virtualKeys: PrismaGatewayVirtualKeyRepository.create(prisma),
      transactions: PrismaGatewayTransactionRepository.create({ database: prisma }),
      keyBudgets: PrismaGatewayKeyBudgetRepository.create({ database: prisma }),
      changeEvents,
      audit,
      scopeResolution: PrismaGatewayScopeResolutionRepository.create({ database: prisma }),
      virtualKeyAuthorization: PrismaVirtualKeyAuthorizationRepository.create({ database: prisma }),
      organizationDirectory: PrismaGatewayOrganizationDirectoryRepository.create(prisma),
      budgets: PrismaGatewayBudgetRepository.create(prisma, budgetSpend),
      cacheRules: PrismaGatewayCacheRuleRepository.create({
        database: prisma,
        changes: changeEvents,
        audit,
      }),
      guardrails: PrismaGatewayGuardrailRepository.create(prisma),
      providerLabels: PrismaGatewayProviderLabelRepository.create(prisma),
      directBudgets: PrismaVirtualKeyDirectBudgetRepository.create({ database: prisma }),
      spendScope: PrismaGatewaySpendScopeRepository.create({ database: prisma }),
      connectUpstream: PrismaGatewayConnectUpstreamRepository.create(prisma),
      realtimeSessions: PrismaGatewayRealtimeSessionRepository.create({ database: prisma }),
      internalStore: PrismaGatewayInternalStoreRepository.create({ database: prisma }),
      traceExportKeys: PrismaGatewayTraceExportKeyRepository.create(prisma),
    };
  }
}
