import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { GatewayBudgetSpendRepository } from "../gateway-budget-spend.repository.ts";
import type {
  GatewayPersistenceTransaction,
  GatewayTransactionRepository,
} from "../gateway-transaction.repository.ts";
import type { GatewayCipher, GatewayRepositories } from "../gateway.repositories.ts";
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
import { PrismaGatewayTraceDestinationReportRepository } from "./prisma.gateway-trace-destination-report.repository.ts";
import { PrismaGatewayTraceExportKeyRepository } from "./prisma.gateway-trace-export-key.repository.ts";
import { PrismaVirtualKeyDirectBudgetRepository } from "./prisma.gateway-virtual-key-direct-budget.repository.ts";
import { PrismaVirtualKeyAuthorizationRepository } from "./prisma.virtual-key-authorization.repository.ts";
import { PrismaGatewayVirtualKeyRepository } from "./prisma.virtual-key.repository.ts";

/** The gateway slots Postgres answers. */
type GatewayPostgresRepositories = Pick<
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
  | "traceDestinationReport"
>;

/** Keys, budgets, rules and sessions over the one guarded Postgres connection. */
export class PostgresGatewayRepositories {
  static create({
    prisma,
    budgetSpend,
    encryption,
  }: Readonly<{
    prisma: PrismaClient;
    /** The ledger a budget's health reads its spend from. */
    budgetSpend: GatewayBudgetSpendRepository;
    /** Seals the connect upstream's and the trace export key's tokens at rest. */
    encryption: GatewayCipher;
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
      connectUpstream: PrismaGatewayConnectUpstreamRepository.create({
        prisma,
        cipher: encryption,
      }),
      realtimeSessions: PrismaGatewayRealtimeSessionRepository.create({ database: prisma }),
      internalStore: PrismaGatewayInternalStoreRepository.create({ database: prisma }),
      traceExportKeys: PrismaGatewayTraceExportKeyRepository.create({ prisma, cipher: encryption }),
      traceDestinationReport: PrismaGatewayTraceDestinationReportRepository.create({
        database: prisma,
      }),
    };
  }
}

/** The one client slice a transaction needs. */
type GatewayTransactionDatabase = Pick<PrismaClient, "$transaction">;

/** Prisma's interactive transaction, handed to services as an opaque handle. */
export class PrismaGatewayTransactionRepository implements GatewayTransactionRepository {
  static create(input: {
    database: GatewayTransactionDatabase;
  }): PrismaGatewayTransactionRepository {
    return new PrismaGatewayTransactionRepository(input.database);
  }

  private constructor(private readonly database: GatewayTransactionDatabase) {}

  run<T>(work: (transaction: GatewayPersistenceTransaction) => Promise<T>): Promise<T> {
    return this.database.$transaction((transaction) => work(transaction));
  }
}
