// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

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
import { NotFoundError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { AnomalyRule, Prisma, PrismaClient } from "@prisma/client";

import { validateDestinationConfig } from "./destinationConfig.schema";
import { validateThresholdConfig } from "./thresholdConfig.schema";

const logger = createLogger("langwatch:governance:anomaly-rule");

/**
 * Thrown when a mutation names a rule this org doesn't have.
 *
 * Usually a stale tab: the rule was archived elsewhere and this list still
 * shows it. Known cause, obvious action (reload), so it is handled rather
 * than a 500. `meta.id` carries the rule id; the org id goes to the log.
 */
export class AnomalyRuleNotFoundError extends NotFoundError {
  constructor(ruleId: string) {
    super("anomaly_rule_not_found", "Anomaly rule", ruleId);
    this.name = "AnomalyRuleNotFoundError";
  }
}

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

  /**
   * `findById`, for the mutations that cannot proceed without the row.
   *
   * Which org asked is a debugging detail — it goes to the log, not into an
   * error a customer reads (see {@link AnomalyRuleNotFoundError}).
   */
  private async requireById(
    id: string,
    organizationId: string,
  ): Promise<AnomalyRule> {
    const existing = await this.findById(id, organizationId);
    if (!existing) {
      logger.warn(
        { ruleId: id, organizationId },
        "AnomalyRule not found for organization",
      );
      throw new AnomalyRuleNotFoundError(id);
    }
    return existing;
  }

  async createRule(input: CreateAnomalyRuleInput): Promise<AnomalyRule> {
    if (!SUPPORTED_SEVERITIES.includes(input.severity)) {
      throw new Error(`Unsupported severity: ${input.severity}`);
    }
    if (!SUPPORTED_SCOPES.includes(input.scope)) {
      throw new Error(`Unsupported scope: ${input.scope}`);
    }
    // Strict per-rule-type validation. Throws ZodError on shape failure
    // or a generic Error on unknown ruleType — both translate to
    // BAD_REQUEST in the router. Spec:
    // specs/ai-gateway/governance/anomaly-rule-threshold-schema.feature.
    validateThresholdConfig({
      ruleType: input.ruleType,
      config: input.thresholdConfig ?? {},
    });
    // Strict destinationConfig validation (Phase 2C C3 dispatch). Empty
    // / undefined config is allowed — that's explicit log-only opt-out.
    if (
      input.destinationConfig !== undefined &&
      Object.keys(input.destinationConfig).length > 0
    ) {
      validateDestinationConfig(input.destinationConfig);
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
        destinationConfig: (input.destinationConfig ??
          {}) as Prisma.InputJsonValue,
        status: input.status ?? "active",
        createdById: input.actorUserId,
      },
    });
  }

  async updateRule(input: UpdateAnomalyRuleInput): Promise<AnomalyRule> {
    const existing = await this.requireById(input.id, input.organizationId);
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
      // Re-validate against the effective ruleType after this update.
      // If the caller supplies a new ruleType, the new config must match
      // its schema; if they keep the existing ruleType, the existing
      // schema applies. Throws ZodError or a plain Error (unknown
      // ruleType); router translates to BAD_REQUEST.
      validateThresholdConfig({
        ruleType: input.ruleType ?? existing.ruleType,
        config: input.thresholdConfig,
      });
      data.thresholdConfig = input.thresholdConfig as Prisma.InputJsonValue;
    } else if (
      input.ruleType !== undefined &&
      input.ruleType !== existing.ruleType
    ) {
      // Switching ruleType without supplying a matching config would
      // leave a row whose ruleType + thresholdConfig disagree. Reject
      // up-front so the admin supplies the right shape.
      validateThresholdConfig({
        ruleType: input.ruleType,
        config: existing.thresholdConfig,
      });
    }
    if (input.destinationConfig !== undefined) {
      // Same allow-empty rule as create: empty `{}` clears destinations
      // (back to log-only). Anything non-empty must round-trip the
      // strict schema.
      if (Object.keys(input.destinationConfig).length > 0) {
        validateDestinationConfig(input.destinationConfig);
      }
      data.destinationConfig = input.destinationConfig as Prisma.InputJsonValue;
    }
    if (input.status !== undefined) data.status = input.status;
    return this.prisma.anomalyRule.update({
      where: { id: existing.id },
      data,
    });
  }

  async archive(id: string, organizationId: string): Promise<AnomalyRule> {
    const existing = await this.requireById(id, organizationId);
    return this.prisma.anomalyRule.update({
      where: { id: existing.id },
      data: { archivedAt: new Date(), status: "disabled" },
    });
  }
}
