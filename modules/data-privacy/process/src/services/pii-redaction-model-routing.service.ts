/**
 * Where a strict batch of a project goes: the PII redaction model, priced or not, or Presidio,
 * and why. Spec: modules/data-privacy/specs/span-pii-redaction.feature
 */
import { type EntitlementApi, isEnterpriseTier } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";

import {
  failureName,
  PII_REDACTION_MODEL_FLAG,
  PII_REDACTION_MODEL_FREE_FLAG,
} from "../rules/pii-redaction-model.rules.ts";
import type { DataPrivacyProjectScopeService } from "./data-privacy-project-scope.service.ts";
import type { PiiAnalysisMetricsOtelService } from "./pii-analysis-metrics-otel.service.ts";
import type { PresidioRedactionService } from "./presidio-redaction.service.ts";
import { ProjectLookupCacheService } from "./project-lookup-cache.service.ts";

const logger = createLogger("langwatch:data-privacy:pii-redaction-model");

/**
 * A project's organization, and its licence self-hosted or its free-list entry and acceptance on
 * Cloud, is read once per minute.
 */
const ORGANIZATION_TTL_MS = 60_000;

/**
 * Where a batch goes: the model, priced or not, Presidio, or Presidio for a reason it counts:
 * self-hosted without the licence, or Cloud at a price no organization admin accepted.
 */
type Refused = Readonly<{ organizationId: string; firstInAMinute: boolean }>;
export type PiiRedactionModelRouting =
  | Readonly<{ kind: "model"; organizationId: string; priced: boolean }>
  | Readonly<{ kind: "presidio" }>
  | (Refused & Readonly<{ kind: "not_licensed" }>)
  | (Refused & Readonly<{ kind: "not_accepted" }>);

type RoutingDependencies = {
  model: Pick<PresidioRedactionService, "isConfigured">;
  featureFlags: FeatureFlagApi;
  /** Whether an organization admin accepted the model's price, which Cloud needs (ADR-201). */
  organizations: Pick<OrganizationApi, "isPiiRedactionModelAccepted">;
  scopes: DataPrivacyProjectScopeService;
  /** Self-hosted, the model comes with the Enterprise license; Cloud prices it. */
  selfHosted: boolean;
  entitlements: Pick<EntitlementApi, "getActivePlan">;
  metrics: Pick<PiiAnalysisMetricsOtelService, "modelFellBack">;
  now: () => number;
};

export class PiiRedactionModelRoutingService {
  static create(input: RoutingDependencies): PiiRedactionModelRoutingService {
    return new PiiRedactionModelRoutingService(input);
  }

  /** Each project's organization; concurrent batches of one project share one read. */
  readonly #organizations: ProjectLookupCacheService<string>;
  /** Each organization's Enterprise licence, keyed by organization id; self-hosted only. */
  readonly #licences: ProjectLookupCacheService<boolean>;
  /** Each organization's free-list entry, keyed by organization id; Cloud only. */
  readonly #free: ProjectLookupCacheService<boolean>;
  /** Whether each organization accepted the model's price, keyed by organization id; Cloud only. */
  readonly #acceptances: ProjectLookupCacheService<boolean>;
  private readonly deps: RoutingDependencies;

  private constructor(deps: RoutingDependencies) {
    this.deps = deps;
    const cache = <T>() =>
      ProjectLookupCacheService.create<T>({ ttlMs: ORGANIZATION_TTL_MS, now: deps.now });
    this.#organizations = cache<string>();
    this.#licences = cache<boolean>();
    this.#free = cache<boolean>();
    this.#acceptances = cache<boolean>();
  }

  /**
   * Where the project's batches go. Configured first, so a deployment naming no model never asks
   * the flag or the database; then the flag, so an off flag reads nothing else; then the licence
   * self-hosted, or the free list and the acceptance on Cloud.
   */
  async routingOf({ projectId }: { projectId: string }): Promise<PiiRedactionModelRouting> {
    try {
      if (!(await this.deps.model.isConfigured())) return { kind: "presidio" };

      const organizationId = await this.#organizationOf({ projectId });
      const routed = await this.deps.featureFlags.isEnabled(PII_REDACTION_MODEL_FLAG, {
        kind: "project",
        projectId,
        organizationId,
      });
      if (!routed) return { kind: "presidio" };
      if (!this.deps.selfHosted) return await this.#cloudRoutingOf({ organizationId });

      const { licensed, firstInAMinute } = await this.#licenceOf({ organizationId });
      return licensed
        ? { kind: "model", organizationId, priced: false }
        : { kind: "not_licensed", organizationId, firstInAMinute };
    } catch (error) {
      this.deps.metrics.modelFellBack("routing_error");
      logger.warn(
        { projectId, reason: failureName(error) },
        "PII redaction model routing could not be decided; using Presidio",
      );
      return { kind: "presidio" };
    }
  }

  /**
   * Cloud: the free list reaches the model unpriced, an admin's acceptance priced, neither stays
   * on Presidio. Read once, here: a call is priced as it was routed and never by a read made
   * after it answered, so a free-list change during a call cannot price it (ADR-201).
   */
  async #cloudRoutingOf({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<PiiRedactionModelRouting> {
    const free = await this.#free.get(organizationId, () =>
      this.deps.featureFlags.isEnabled(PII_REDACTION_MODEL_FREE_FLAG, {
        kind: "organization",
        organizationId,
      }),
    );
    if (free) return { kind: "model", organizationId, priced: false };

    let firstInAMinute = false;
    const accepted = await this.#acceptances.get(organizationId, () => {
      firstInAMinute = true;
      return this.deps.organizations.isPiiRedactionModelAccepted({ organizationId });
    });
    return accepted
      ? { kind: "model", organizationId, priced: true }
      : { kind: "not_accepted", organizationId, firstInAMinute };
  }

  /** Whether the organization holds an Enterprise licence, and whether this read asked for it. */
  async #licenceOf({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ licensed: boolean; firstInAMinute: boolean }> {
    let firstInAMinute = false;
    const licensed = await this.#licences.get(organizationId, async () => {
      firstInAMinute = true;
      const plan = await this.deps.entitlements.getActivePlan({ organizationId });
      return isEnterpriseTier(plan.type);
    });
    return { licensed, firstInAMinute };
  }

  #organizationOf({ projectId }: { projectId: string }): Promise<string> {
    return this.#organizations.get(projectId, async () => {
      const { organizationId } = await this.deps.scopes.getScopeFacts({ projectId });
      return organizationId;
    });
  }
}
