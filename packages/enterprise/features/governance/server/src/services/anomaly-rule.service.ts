// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  ANOMALY_RULE_SCOPES,
  ANOMALY_RULE_SEVERITIES,
  AnomalyRuleNotFoundError,
  type AnomalyRule,
  type CreateAnomalyRuleInput,
  unsupportedValue,
  type UpdateAnomalyRuleInput,
  validateDestinationConfig,
  validateThresholdConfig,
} from "@langwatch/enterprise-governance-contract";
import type {
  AnomalyRuleChanges,
  AnomalyRuleRepository,
} from "../ports/anomaly-rule.port";

export class AnomalyRuleService {
  private constructor(
    private readonly repository: AnomalyRuleRepository,
    private readonly now: () => Date,
  ) {}

  static create(options: {
    repository: AnomalyRuleRepository;
    now?: () => Date;
  }): AnomalyRuleService {
    return new AnomalyRuleService(options.repository, options.now ?? (() => new Date()));
  }

  async list(organizationId: string): Promise<AnomalyRule[]> {
    return this.repository.list(organizationId);
  }

  async tryFindById(id: string, organizationId: string): Promise<AnomalyRule | null> {
    const row = await this.repository.tryFindById(id);
    if (!row || row.organizationId !== organizationId) return null;
    return row;
  }

  /**
   * `findById`, for the mutations that cannot proceed without the row.
   *
   * Which org asked is a debugging detail — it goes to the log, not into an
   * error a customer reads (see {@link AnomalyRuleNotFoundError}).
   */
  async getById(id: string, organizationId: string): Promise<AnomalyRule> {
    const existing = await this.tryFindById(id, organizationId);
    if (!existing) {
      throw new AnomalyRuleNotFoundError(id);
    }
    return existing;
  }

  async createRule(input: CreateAnomalyRuleInput): Promise<AnomalyRule> {
    if (!ANOMALY_RULE_SEVERITIES.includes(input.severity)) {
      throw unsupportedValue({
        field: "severity",
        value: input.severity,
        allowed: ANOMALY_RULE_SEVERITIES,
      });
    }
    if (!ANOMALY_RULE_SCOPES.includes(input.scope)) {
      throw unsupportedValue({
        field: "scope",
        value: input.scope,
        allowed: ANOMALY_RULE_SCOPES,
      });
    }
    // Strict per-rule-type validation. Throws ZodError on shape failure or a
    // `ValidationError` on an unknown ruleType — both reach the admin as
    // `validation_error`. Spec:
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
    return this.repository.create({
      organizationId: input.organizationId,
      name: input.name,
      description: input.description ?? null,
      severity: input.severity,
      ruleType: input.ruleType,
      scope: input.scope,
      scopeId: input.scopeId,
      thresholdConfig: input.thresholdConfig ?? {},
      destinationConfig: input.destinationConfig ?? {},
      status: input.status ?? "active",
      createdById: input.actorUserId,
    });
  }

  async updateRule(input: UpdateAnomalyRuleInput): Promise<AnomalyRule> {
    const existing = await this.getById(input.id, input.organizationId);
    const changes: AnomalyRuleChanges = {};
    if (input.name !== undefined) changes.name = input.name;
    if (input.description !== undefined) changes.description = input.description;
    if (input.severity !== undefined) {
      if (!ANOMALY_RULE_SEVERITIES.includes(input.severity)) {
        throw unsupportedValue({
          field: "severity",
          value: input.severity,
          allowed: ANOMALY_RULE_SEVERITIES,
        });
      }
      changes.severity = input.severity;
    }
    if (input.ruleType !== undefined) changes.ruleType = input.ruleType;
    if (input.scope !== undefined) {
      if (!ANOMALY_RULE_SCOPES.includes(input.scope)) {
        throw unsupportedValue({
          field: "scope",
          value: input.scope,
          allowed: ANOMALY_RULE_SCOPES,
        });
      }
      changes.scope = input.scope;
    }
    if (input.scopeId !== undefined) changes.scopeId = input.scopeId;
    if (input.thresholdConfig !== undefined) {
      // Re-validate against the effective ruleType after this update.
      // If the caller supplies a new ruleType, the new config must match
      // its schema; if they keep the existing ruleType, the existing
      // schema applies. Throws ZodError or a `ValidationError` (unknown
      // ruleType); both reach the admin as `validation_error`.
      validateThresholdConfig({
        ruleType: input.ruleType ?? existing.ruleType,
        config: input.thresholdConfig,
      });
      changes.thresholdConfig = input.thresholdConfig;
    } else if (input.ruleType !== undefined && input.ruleType !== existing.ruleType) {
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
      changes.destinationConfig = input.destinationConfig;
    }
    if (input.status !== undefined) changes.status = input.status;
    return this.repository.update(existing.id, changes);
  }

  async archive(id: string, organizationId: string): Promise<AnomalyRule> {
    const existing = await this.getById(id, organizationId);
    return this.repository.update(existing.id, {
      archivedAt: this.now(),
      status: "disabled",
    });
  }
}
