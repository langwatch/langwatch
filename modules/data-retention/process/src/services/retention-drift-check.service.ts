/**
 * Flags projects whose stored rows carry a period other than the one they resolve to now. Rows
 * kept longer under a shorter save the admin left unapplied are deferred (warned); every other
 * drift is unexpected (an error). Spec: modules/data-retention/specs/retention-drift-check.feature
 */
import { type RetentionCategory, retentionCategories } from "@langwatch/data-retention-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import { type CounterHandle, counter } from "@langwatch/observability/metrics";

import type { DataRetentionDirectoryReader } from "../app/data-retention.app.ts";
import type { RetentionDrift } from "../eventing/retention-drift.events.ts";
import type { RetentionApplyStatusRepository } from "../repositories/retention-apply-status.repository.ts";
import type { RetroactiveRetentionRepository } from "../repositories/retroactive-retention.repository.ts";
import {
  driftedStamps,
  retentionDriftKind,
  retentionDriftWindows,
} from "../rules/retention-drift.rules.ts";
import {
  hasDeferredShortening,
  type ScopeApplyRecord,
} from "../rules/stored-apply-status.rules.ts";
import type { DataRetentionService } from "./data-retention.service.ts";

export const RETENTION_DRIFT_METRIC_NAME = "langwatch_data_retention_drift_projects_total";

type Options = Readonly<{
  /** Archived projects included: their stored rows are still kept on their stamps. */
  projects: Pick<DataRetentionService, "findScopeProjectIds" | "getResolvedForProjects">;
  stamps: Pick<RetroactiveRetentionRepository, "sampleStoredRetention">;
  applyStatus: Pick<RetentionApplyStatusRepository, "findForOrganization">;
  directory: Pick<DataRetentionDirectoryReader, "findOrganizationDirectory">;
  logger?: Logger;
  drifts?: CounterHandle;
}>;

/** Whether a project's category sits under a shorter save still waiting for its apply. */
type DeferredLookup = (input: { projectId: string; category: RetentionCategory }) => boolean;

export class RetentionDriftCheckService {
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
    const deferred = await this.deferredLookup({ organizationId });
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
          if (found.length === 0) continue;
          const kind = retentionDriftKind({
            expectedDays,
            found,
            deferredShortening: deferred({ projectId, category }),
          });
          drifted.push({ projectId, category, expectedDays, found, kind });
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

  /** An apply status that cannot be read marks nothing deferred, so every drift stays an error. */
  private async deferredLookup({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<DeferredLookup> {
    let records: ScopeApplyRecord[];
    let teamOfProject: Map<string, string>;
    try {
      const [found, directory] = await Promise.all([
        this.options.applyStatus.findForOrganization({ organizationId }),
        this.options.directory.findOrganizationDirectory({ organizationId }),
      ]);
      records = found;
      teamOfProject = new Map(directory.projects.map((project) => [project.id, project.teamId]));
    } catch (error) {
      this.logger.warn(
        { organizationId, error: error instanceof Error ? error.message : String(error) },
        "Retention drift check could not read the apply status; every drift reads as unexpected",
      );
      return () => false;
    }
    return ({ projectId, category }) =>
      hasDeferredShortening({ organizationId, projectId, category, records, teamOfProject });
  }

  private report({ organizationId, drift }: { organizationId: string; drift: RetentionDrift }) {
    this.drifts.inc({ category: drift.category, kind: drift.kind }, 1);
    const fields = {
      organizationId,
      projectId: drift.projectId,
      category: drift.category,
      kind: drift.kind,
      expected_days: drift.expectedDays,
      found: drift.found,
    };
    if (drift.kind === "deferred") {
      this.logger.warn(
        fields,
        "Stored rows keep a longer retention under a shorter save that was not applied",
      );
      return;
    }
    this.logger.error(
      fields,
      "Stored rows carry a retention other than the project's current setting",
    );
  }
}
