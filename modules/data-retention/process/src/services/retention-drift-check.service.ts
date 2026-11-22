/**
 * Flags projects whose stored rows carry a period other than the one they resolve to now: the
 * gap a saved but unapplied change leaves. Each drift is counted on a metric, logged as an error
 * and recorded by the command. Spec: modules/data-retention/specs/retention-drift-check.feature
 */
import { retentionCategories } from "@langwatch/data-retention-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import { type CounterHandle, counter } from "@langwatch/observability/metrics";
import { nowInstant } from "@langwatch/time";

import type {
  CheckRetentionDriftCommandData,
  RetentionDrift,
} from "../eventing/retention-drift.events.ts";
import type { DataRetentionRepository } from "../repositories/data-retention.repository.ts";
import type { RetroactiveRetentionRepository } from "../repositories/retroactive-retention.repository.ts";
import { driftedStamps, retentionDriftWindows } from "../rules/retention-drift.rules.ts";
import type { DataRetentionService } from "./data-retention.service.ts";

export const RETENTION_DRIFT_METRIC_NAME = "langwatch_data_retention_drift_projects_total";

/** What one sweep asked for: organizations whose check was sent, and those that failed. */
export type RetentionDriftRequestOutcome = Readonly<{ requested: number; failed: number }>;

type Send = (data: CheckRetentionDriftCommandData) => Promise<unknown>;

type Options = Readonly<{
  policies: Pick<DataRetentionRepository, "findOrganizationIdsWithRules">;
  /** Archived projects included: their stored rows are still kept on their stamps. */
  projects: Pick<DataRetentionService, "findScopeProjectIds" | "getResolvedForProjects">;
  stamps: Pick<RetroactiveRetentionRepository, "sampleStoredRetention">;
  logger?: Logger;
  drifts?: CounterHandle;
  now?: () => number;
}>;

export class RetentionDriftCheckService {
  #send: Send | undefined;
  private readonly logger: Logger;
  private readonly drifts: CounterHandle;

  static create(options: Options): RetentionDriftCheckService {
    return new RetentionDriftCheckService(options);
  }

  private constructor(private readonly options: Options) {
    this.logger = options.logger ?? createLogger("langwatch:data-retention:retention-drift");
    this.drifts =
      options.drifts ??
      counter({
        name: RETENTION_DRIFT_METRIC_NAME,
        description:
          "Projects whose sampled stored rows carry a retention other than their current setting",
      });
  }

  /** The pipeline's sender, bound once the process registered it. */
  connect(send: Send): void {
    this.#send = send;
  }

  /** One check per organization with rules; one that fails to send is counted, not fatal. */
  async requestAll({ at }: { at?: number } = {}): Promise<RetentionDriftRequestOutcome> {
    const checkedAt = at ?? this.now();
    const organizationIds = await this.options.policies.findOrganizationIdsWithRules();
    let requested = 0;
    let failed = 0;
    for (const organizationId of organizationIds) {
      try {
        await this.send({ tenantId: organizationId, organizationId, occurredAt: checkedAt });
        requested += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(
          { organizationId, error: error instanceof Error ? error.message : String(error) },
          "Retention drift check could not be requested for an organization",
        );
      }
    }
    return { requested, failed };
  }

  async requestOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<RetentionDriftRequestOutcome> {
    await this.send({ tenantId: organizationId, organizationId, occurredAt: this.now() });
    return { requested: 1, failed: 0 };
  }

  /** Every project and category of the organization, sampled; a project that fails is skipped. */
  async check({
    organizationId,
    at,
  }: {
    organizationId: string;
    at: number;
  }): Promise<RetentionDrift[]> {
    const { projects, stamps } = this.options;
    const projectIds = await projects.findScopeProjectIds({
      organizationId,
      scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
    });
    const resolved = await projects.getResolvedForProjects({ projectIds });
    const windows = retentionDriftWindows({ nowMs: at });
    const drifted: RetentionDrift[] = [];
    for (const [projectId, retention] of resolved) {
      for (const category of retentionCategories) {
        const expectedDays = retention[category];
        try {
          const found = driftedStamps({
            expectedDays,
            stamps: await stamps.sampleStoredRetention({ projectId, category, windows }),
          });
          if (found.length > 0) drifted.push({ projectId, category, expectedDays, found });
        } catch (error) {
          this.logger.warn(
            {
              organizationId,
              projectId,
              category,
              error: error instanceof Error ? error.message : String(error),
            },
            "Retention drift check could not read a project's stored rows",
          );
        }
      }
    }
    for (const drift of drifted) this.report({ organizationId, drift });
    return drifted;
  }

  private report({ organizationId, drift }: { organizationId: string; drift: RetentionDrift }) {
    this.drifts.inc({ category: drift.category }, 1);
    this.logger.error(
      {
        organizationId,
        projectId: drift.projectId,
        category: drift.category,
        expected_days: drift.expectedDays,
        found: drift.found,
      },
      "Stored rows carry a retention other than the project's current setting",
    );
  }

  private async send(data: CheckRetentionDriftCommandData): Promise<void> {
    if (!this.#send) throw new Error("Retention drift check used before its pipeline");
    await this.#send(data);
  }

  private now(): number {
    return (this.options.now ?? (() => nowInstant().epochMilliseconds))();
  }
}
