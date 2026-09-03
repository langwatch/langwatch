import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { GatewayAuditPort } from "../ports/gateway-audit.port";
import type { GatewayBudgetSpendPort } from "../ports/gateway-budget-spend.port";
import type { GatewayChangeEventsPort } from "../ports/gateway-change-events.port";
import {
  PrismaGatewayBudgetRepository,
  type GatewayBudgetDatabase,
} from "../repositories/prisma/prisma.gateway-budget.repository";
import {
  PrismaGatewayCacheRuleRepository,
  type GatewayCacheRuleDatabase,
} from "../repositories/prisma/prisma.gateway-cache-rule.repository";
import {
  PrismaGatewayGuardrailRepository,
  type GatewayGuardrailDatabase,
} from "../repositories/prisma/prisma.gateway-guardrail.repository";
import { GatewayCacheRulePersistence } from "../services/gateway-cache-rule.service";
import { GatewayGuardrailCatalogue } from "../services/gateway-guardrail.service";
import { GatewayService } from "../services/gateway.service";

/**
 * Everything Gateway persistence touches, as the three private repositories
 * below declare it.
 *
 * A composed slice rather than the generated client: a process hands the one
 * it already holds and it fits, while this file — and every layer above it —
 * names no generated declaration at all.
 */
export type GatewayPersistence = GatewayBudgetDatabase &
  GatewayCacheRuleDatabase &
  GatewayGuardrailDatabase;

/** Composes Gateway's one process-owned service from private persistence adapters. */
export class PrismaGatewayAdapter {
  private constructor(private readonly service: GatewayService) {}

  static create(options: {
    database: GatewayPersistence;
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
