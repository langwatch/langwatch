/**
 * AnomalyRuleService — admin CRUD for anomaly detection rules.
 *
 * This slice ships the configuration entity ONLY (per
 * @master_orchestrator's tighter scope). Rule eval + alert dispatch
 * is Option C — a server-side worker that polls active rules,
 * evaluates them against gateway_activity_events, and emits alerts
 * to the destinations configured per rule.
 *
 * Spec: specs/ai-gateway/governance/anomaly-rules.feature
 */
import type { AnomalyRule, Prisma, PrismaClient } from "@prisma/client";

export type RuleSeverity = "critical" | "warning" | "info";
export type RuleScope =
  | "organization"
  | "team"
  | "project"
  | "source_type"
  | "source";

export const SUPPORTED_SEVERITIES: readonly RuleSeverity[] = [
  "critical",
  "warning",
  "info",
] as const;
export const SUPPORTED_SCOPES: readonly RuleScope[] = [
  "organization",
  "team",
  "project",
  "source_type",
  "source",
] as const;

export interface CreateAnomalyRuleInput {
  organizationId: string;
  name: string;
  description?: string | null;
  severity: RuleSeverity;
  ruleType: string;
  scope: RuleScope;
  scopeId: string;
  thresholdConfig?: Record<string, unknown>;
  destinationConfig?: Record<string, unknown>;
  status?: "active" | "disabled";
  actorUserId: string;
}

export interface UpdateAnomalyRuleInput {
  id: string;
  organizationId: string;
  name?: string;
  description?: string | null;
  severity?: RuleSeverity;
  ruleType?: string;
  scope?: RuleScope;
  scopeId?: string;
  thresholdConfig?: Record<string, unknown>;
  destinationConfig?: Record<string, unknown>;
  status?: "active" | "disabled";
}

export class AnomalyRuleService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): AnomalyRuleService {
    return new AnomalyRuleService(prisma);
  }

  async list(organizationId: string): Promise<AnomalyRule[]> {
    return this.prisma.anomalyRule.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ severity: "asc" }, { name: "asc" }],
    });
  }

  async findById(
    id: string,
    organizationId: string,
  ): Promise<AnomalyRule | null> {
    const row = await this.prisma.anomalyRule.findUnique({ where: { id } });
    if (!row || row.organizationId !== organizationId) return null;
    return row;
  }

  async createRule(input: CreateAnomalyRuleInput): Promise<AnomalyRule> {
    if (!SUPPORTED_SEVERITIES.includes(input.severity)) {
      throw new Error(`Unsupported severity: ${input.severity}`);
    }
    if (!SUPPORTED_SCOPES.includes(input.scope)) {
      throw new Error(`Unsupported scope: ${input.scope}`);
    }
    return this.prisma.anomalyRule.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        description: input.description ?? null,
        severity: input.severity,
        ruleType: input.ruleType,
        scope: input.scope,
        scopeId: input.scopeId,
        thresholdConfig: (input.thresholdConfig ?? {}) as Prisma.InputJsonValue,
        destinationConfig: (input.destinationConfig ?? {}) as Prisma.InputJsonValue,
        status: input.status ?? "active",
        createdById: input.actorUserId,
      },
    });
  }

  async updateRule(input: UpdateAnomalyRuleInput): Promise<AnomalyRule> {
    const existing = await this.findById(input.id, input.organizationId);
    if (!existing) {
      throw new Error(
        `AnomalyRule ${input.id} not found in org ${input.organizationId}`,
      );
    }
    const data: Prisma.AnomalyRuleUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.severity !== undefined) {
      if (!SUPPORTED_SEVERITIES.includes(input.severity)) {
        throw new Error(`Unsupported severity: ${input.severity}`);
      }
      data.severity = input.severity;
    }
    if (input.ruleType !== undefined) data.ruleType = input.ruleType;
    if (input.scope !== undefined) {
      if (!SUPPORTED_SCOPES.includes(input.scope)) {
        throw new Error(`Unsupported scope: ${input.scope}`);
      }
      data.scope = input.scope;
    }
    if (input.scopeId !== undefined) data.scopeId = input.scopeId;
    if (input.thresholdConfig !== undefined) {
      data.thresholdConfig =
        input.thresholdConfig as Prisma.InputJsonValue;
    }
    if (input.destinationConfig !== undefined) {
      data.destinationConfig =
        input.destinationConfig as Prisma.InputJsonValue;
    }
    if (input.status !== undefined) data.status = input.status;
    return this.prisma.anomalyRule.update({
      where: { id: existing.id },
      data,
    });
  }

  async archive(id: string, organizationId: string): Promise<AnomalyRule> {
    const existing = await this.findById(id, organizationId);
    if (!existing) {
      throw new Error(
        `AnomalyRule ${id} not found in org ${organizationId}`,
      );
    }
    return this.prisma.anomalyRule.update({
      where: { id: existing.id },
      data: { archivedAt: new Date(), status: "disabled" },
    });
  }
}
