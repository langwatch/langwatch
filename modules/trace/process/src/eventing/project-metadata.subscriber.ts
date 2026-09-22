import type { TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  LANGY_TRACE_ORIGIN,
  type TraceSummaryData,
  type TraceProcessingEvent,
} from "@langwatch/trace-contract";

import type { TraceProjectMetadata } from "../app/trace.members.ts";

const logger = createLogger("langwatch:trace-processing:project-metadata");

/**
 * Roughly one poll of the onboarding screen that waits on these flags, so a
 * user who has just sent their first trace waits at most one extra cycle.
 */
export const PROJECT_METADATA_WINDOW_MS = 3_000;

export interface ProjectMetadataSubscriberDeps {
  /**
   * Narrowed from the whole `ProjectApi` to the three capabilities this
   * subscriber uses. The published service satisfies the port structurally, so
   * every existing caller passes what it already passed.
   */
  projects: TraceProjectMetadata;
  // ADR-051: reconciliation path ensures topic clustering runs daily; safe
  // to call repeatedly as it's rate-limited.
  bootstrapTopicClustering?: (projectId: string) => Promise<void>;
  /**
   * The process's product-analytics sink (server-side capture, never the
   * browser). Fire-and-forget: it must never be fatal to the ingest path.
   */
  recordProductEvent: (input: {
    userId: string;
    event: string;
    properties?: Record<string, unknown>;
    projectId?: string;
  }) => void;
  /**
   * Marks the project active for the day of this trace, once a day. Injected
   * so trace never imports billing's process package (structurally typed).
   */
  trackActiveDay?: (input: { projectId: string; occurredAt: number }) => Promise<void>;
}

/**
 * What a project's first trace tells us. Ingest is the only moment some of
 * this is knowable (SDK language, integrated at all), read once on the
 * first real trace. `isRealFirstIngest` guards a re-delivered first trace.
 */
export class ProjectMetadataSync {
  /**
   * Tracks the project's first real trace as an integration milestone, against
   * the org admin: that is the same distinct_id posthog-js identifies the user
   * with in the browser, so this server event joins the browser person.
   */
  private static async trackFirstTraceIntegrated({
    projects,
    recordProductEvent,
    tenantId,
    attrs,
  }: {
    projects: TraceProjectMetadata;
    recordProductEvent: ProjectMetadataSubscriberDeps["recordProductEvent"];
    tenantId: string;
    attrs: Record<string, string>;
  }): Promise<void> {
    const { userId } = await projects.resolveOrgAdmin(tenantId);
    if (!userId) return;

    recordProductEvent({
      userId,
      event: "first_trace_integrated",
      properties: {
        sdk_language: attrs["sdk.language"] ?? "unknown",
        sdk_framework: attrs["langwatch.sdk.framework"] ?? "unknown",
      },
      projectId: tenantId,
    });
  }

  private static async syncProjectMetadata(
    deps: ProjectMetadataSubscriberDeps,
    tenantId: string,
    foldState: TraceSummaryData,
  ): Promise<void> {
    const project = await deps.projects.findById(tenantId);

    if (!project) {
      logger.warn({ tenantId }, "Project not found — skipping metadata update");
      return;
    }

    // Level-triggered, so it runs BEFORE the already-marked early return
    // below: an established project is exactly the case that used to be
    // unreachable here, and exactly the case the deploy backfill existed
    // to repair.
    await ProjectMetadataSync.assertClusteringSchedule(deps, tenantId);

    // Already marked — nothing to do
    if (project.firstMessage && project.integrated) {
      return;
    }

    await ProjectMetadataSync.markFirstMessage({
      deps,
      tenantId,
      project,
      attrs: foldState.attributes ?? {},
    });
  }

  /**
   * Own error handling: a bootstrap failure must not be reported as a metadata
   * failure, and must not stop the metadata write that follows. Failing is
   * survivable — the next trace re-asserts it.
   */
  private static async assertClusteringSchedule(
    deps: ProjectMetadataSubscriberDeps,
    tenantId: string,
  ): Promise<void> {
    try {
      await deps.bootstrapTopicClustering?.(tenantId);
    } catch (error) {
      logger.error(
        {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Topic clustering bootstrap failed — retried on this project's next trace (non-fatal)",
      );
    }
  }

  private static detectLanguage(attrs: Record<string, string>): string {
    if (attrs["langwatch.platform"] === "optimization_studio") return "other";
    const sdkLanguage = attrs["sdk.language"];
    if (sdkLanguage === "python" || sdkLanguage === "typescript") {
      return sdkLanguage;
    }
    return "other";
  }

  private static async markFirstMessage({
    deps,
    tenantId,
    project,
    attrs,
  }: {
    deps: ProjectMetadataSubscriberDeps;
    tenantId: string;
    project: { firstMessage: boolean; integrated: boolean };
    attrs: Record<string, string>;
  }): Promise<void> {
    const isOptimizationStudio = attrs["langwatch.platform"] === "optimization_studio";

    await deps.projects.updateMetadata({
      id: tenantId,
      data: {
        firstMessage: true,
        integrated: isOptimizationStudio ? project.integrated : true,
        language: ProjectMetadataSync.detectLanguage(attrs),
      },
    });

    // Fired after the metadata write commits, so a failed write retries
    // the event on the project's next trace instead of dropping it.
    if (!project.firstMessage) {
      await ProjectMetadataSync.trackFirstTraceIntegrated({
        projects: deps.projects,
        recordProductEvent: deps.recordProductEvent,
        tenantId,
        attrs,
      });
    }
  }

  // Per-project dedup lane: level-triggered subscriber needs serialization
  // to collapse concurrent traces to one assertion.
  static projectMetadataGroupKey(event: { tenantId: string }): string {
    return `project-metadata:${event.tenantId}`;
  }

  // Skip sample traces from empty-state onboarding and Langy's own turns:
  // neither should flip the integrated flag, dismiss the onboarding card,
  // or reach a CRM milestone as the customer's own first trace.
  static isRealFirstIngest(foldState: TraceSummaryData): boolean {
    const origin = foldState.attributes?.["langwatch.origin"];
    return origin !== "sample" && origin !== LANGY_TRACE_ORIGIN;
  }

  // Long dedup TTL ensures at most one database write per project window
  // for setting first message and SDK language.
  static createProjectMetadataHandler(
    deps: ProjectMetadataSubscriberDeps,
  ): (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) => Promise<void> {
    return async (event, context) => {
      const { tenantId, state: foldState } = context;

      if (!ProjectMetadataSync.isRealFirstIngest(foldState)) return;

      await deps.trackActiveDay?.({ projectId: tenantId, occurredAt: event.occurredAt });

      try {
        await ProjectMetadataSync.syncProjectMetadata(deps, tenantId, foldState);
      } catch (error) {
        logger.error(
          {
            tenantId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to update project metadata — non-fatal",
        );
      }
    };
  }
}
