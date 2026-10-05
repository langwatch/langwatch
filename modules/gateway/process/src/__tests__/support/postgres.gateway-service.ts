import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type { GatewayAuditRepository } from "../../repositories/gateway-audit.repository.ts";
import type { GatewayBudgetSpendRepository } from "../../repositories/gateway-budget-spend.repository.ts";
import type { GatewayChangeEventsRepository } from "../../repositories/gateway-change-event.repository.ts";
import {
  PrismaGatewayBudgetRepository,
  type GatewayBudgetDatabase,
} from "../../repositories/prisma/prisma.gateway-budget.repository.ts";
import {
  PrismaGatewayCacheRuleRepository,
  type GatewayCacheRuleDatabase,
} from "../../repositories/prisma/prisma.gateway-cache-rule.repository.ts";
import {
  PrismaGatewayGuardrailRepository,
  type GatewayGuardrailDatabase,
} from "../../repositories/prisma/prisma.gateway-guardrail.repository.ts";
import { GatewayCacheRuleService } from "../../services/gateway-cache-rule.service.ts";
import { GatewayEndUserCapsService } from "../../services/gateway-end-user-caps.service.ts";
import { GatewayGuardrailService } from "../../services/gateway-guardrail.service.ts";
import { GatewayService, type GatewayBudgetOrganizations } from "../../services/gateway.service.ts";

/**
 * Everything Gateway persistence touches, as the three private repositories
 * declare it — a composed slice, not the generated client, so this file
 * (and every layer above it) names no generated declaration at all.
 */
export type GatewayPersistence = GatewayBudgetDatabase &
  GatewayCacheRuleDatabase &
  GatewayGuardrailDatabase;

/** Gateway's budget service over real Postgres rows, for suites asserting on the database. */
export class PrismaGatewayAdapter {
  private constructor(private readonly service: GatewayService) {}

  static create(options: {
    database: GatewayPersistence;
    projects: ProjectApi;
    organizations: GatewayBudgetOrganizations;
    evaluators: EvaluatorApi;
    monitors: MonitorApi;
    changes: GatewayChangeEventsRepository;
    audit: GatewayAuditRepository;
    budgetSpend?: GatewayBudgetSpendRepository;
  }): PrismaGatewayAdapter {
    const budgetRepository = PrismaGatewayBudgetRepository.create(
      options.database,
      options.budgetSpend,
    );
    const cacheRules = GatewayCacheRuleService.create(
      PrismaGatewayCacheRuleRepository.create({
        database: options.database,
        changes: options.changes,
        audit: options.audit,
      }),
    );
    const guardrails = GatewayGuardrailService.create({
      repository: PrismaGatewayGuardrailRepository.create(options.database),
      evaluators: options.evaluators,
      monitors: options.monitors,
      projects: options.projects,
      audit: options.audit,
    });
    return new PrismaGatewayAdapter(
      GatewayService.create({
        repository: budgetRepository,
        projects: options.projects,
        organizations: options.organizations,
        cacheRules,
        guardrails,
      }),
    );
  }

  build(): GatewayService {
    return this.service;
  }
}

/** End-user caps over real Postgres budget rows and the given spend ledger. */
export class GatewayEndUserCapsAdapter {
  private constructor() {}

  static create(options: {
    database: GatewayBudgetDatabase;
    spend: GatewayBudgetSpendRepository;
  }): GatewayEndUserCapsService {
    return GatewayEndUserCapsService.create({
      budgets: PrismaGatewayBudgetRepository.create(options.database, options.spend),
      spend: options.spend,
    });
  }
}
