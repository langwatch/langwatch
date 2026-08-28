import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { GatewayAuditPort } from "../ports/gateway-audit.port";
import type { GatewayBudgetSpendPort } from "../ports/gateway-budget-spend.port";
import type { GatewayChangeEventsPort } from "../ports/gateway-change-events.port";
import { PrismaGatewayBudgetRepository } from "../repositories/prisma/prisma.gateway-budget.repository";
import { PrismaGatewayCacheRuleRepository } from "../repositories/prisma/prisma.gateway-cache-rule.repository";
import { PrismaGatewayGuardrailRepository } from "../repositories/prisma/prisma.gateway-guardrail.repository";
import { GatewayCacheRulePersistence } from "../services/gateway-cache-rule.service";
import { GatewayGuardrailCatalogue } from "../services/gateway-guardrail.service";
import { GatewayService } from "../services/gateway.service";

/** Composes Gateway's one process-owned service from private persistence adapters. */
export class PrismaGatewayAdapter {
  private constructor(private readonly service: GatewayService) {}

  static create(options: {
    database: PrismaClient;
    projects: ProjectService;
    evaluators: EvaluatorService;
    monitors: MonitorService;
    changes: GatewayChangeEventsPort;
    audit: GatewayAuditPort;
    budgetSpend?: GatewayBudgetSpendPort;
  }): PrismaGatewayAdapter {
    const budgetRepository = PrismaGatewayBudgetRepository.create(
      options.database,
      options.budgetSpend,
    );
    const cacheRules = GatewayCacheRulePersistence.create(
      PrismaGatewayCacheRuleRepository.create({
        database: options.database,
        changes: options.changes,
        audit: options.audit,
      }),
    );
    const guardrails = GatewayGuardrailCatalogue.create({
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
        cacheRules,
        guardrails,
      }),
    );
  }

  build(): GatewayService {
    return this.service;
  }
}
