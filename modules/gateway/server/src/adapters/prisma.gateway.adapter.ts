import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { GatewayAudit } from "../app/gateway.members.ts";
import type { GatewayBudgetSpend } from "../app/gateway.members.ts";
import type { GatewayChangeEvents } from "../app/gateway.members.ts";
import {
  PrismaGatewayBudgetRepository,
  type GatewayBudgetDatabase,
} from "../repositories/prisma/prisma.gateway-budget.repository.ts";
import {
  PrismaGatewayCacheRuleRepository,
  type GatewayCacheRuleDatabase,
} from "../repositories/prisma/prisma.gateway-cache-rule.repository.ts";
import {
  PrismaGatewayGuardrailRepository,
  type GatewayGuardrailDatabase,
} from "../repositories/prisma/prisma.gateway-guardrail.repository.ts";
import { GatewayCacheRuleService } from "../services/gateway-cache-rule.service.ts";
import { GatewayGuardrailService } from "../services/gateway-guardrail.service.ts";
import { GatewayService } from "../services/gateway.service.ts";

/**
 * Everything Gateway persistence touches, as the three private repositories below declare it — a composed slice rather than the generated client, so a process just hands the one it already holds and this file (and every layer above it) names no generated declaration at all.
 */
export type GatewayPersistence = GatewayBudgetDatabase &
  GatewayCacheRuleDatabase &
  GatewayGuardrailDatabase;

/** Composes Gateway's one process-owned service from private persistence adapters. */
export class PrismaGatewayAdapter {
  private constructor(private readonly service: GatewayService) {}

  static create(options: {
    database: GatewayPersistence;
    projects: ProjectApi;
    evaluators: EvaluatorApi;
    monitors: MonitorApi;
    changes: GatewayChangeEvents;
    audit: GatewayAudit;
    budgetSpend?: GatewayBudgetSpend;
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
        cacheRules,
        guardrails,
      }),
    );
  }

  build(): GatewayService {
    return this.service;
  }
}
