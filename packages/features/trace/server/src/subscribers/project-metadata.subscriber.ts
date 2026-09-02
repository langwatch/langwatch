import type { TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import type { TraceProjectMetadataPort } from "../ports/trace-project-metadata.port";
import type { TraceProcessingEvent } from "@langwatch/trace-contract";

const logger = createLogger("langwatch:trace-processing:project-metadata");

/**
 * Roughly one poll of the onboarding screen that waits on these flags, so a
 * user who has just sent their first trace waits at most one extra cycle.
 */
export const PROJECT_METADATA_WINDOW_MS = 3_000;

export interface ProjectMetadataSubscriberDeps {
  /**
   * Narrowed from the whole `ProjectService` to the three capabilities this
   * subscriber uses. The published service satisfies the port structurally, so
   * every existing caller passes what it already passed.
   */
  projects: TraceProjectMetadataPort;
  /**
   * ADR-051: ensures the project's topic clustering process exists and has a
   * scheduled daily wake.
   *
   * Called on EVERY real ingest, not just the first — this is the
   * reconciliation path, so a project that somehow lost its schedule gets it
   * back on its next trace instead of waiting for an operator to run the
   * backfill. Safe to call repeatedly: a bootstrap-trigger request evolves an
   * already-bootstrapped process to the same state and cannot move its wake.
   * The injected implementation is rate-limited (see
   * createRateLimitedBootstrap), so this costs at most one commit per project
   * per claim window.
   */
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
}

/**
 * What a project's first trace tells us about the project.
 *
 * Ingest is the only moment some of this is knowable — the SDK language, that
 * the project is integrated at all — so it is read once, on the first real
 * trace. `isRealFirstIngest` is the whole guard: a re-delivered first trace
 * must not re-announce a project as newly integrated.
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
    projects: TraceProjectMetadataPort;
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
    const project = await deps.projects.tryGetById(tenantId);

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

  /**
   * One queue lane per project, matching this subscriber's per-project dedup id.
   *
   * The queue's dedup key is global to the queue, but the check that decides
   * whether a duplicate is still squashable looks the existing job up in the
   * CURRENT group's job set. So a dedup id that spans groups never squashes:
   * the lookup misses, the key is treated as stale, and it is deleted before a
   * fresh job stages — which also drops the guard protecting the pending job in
   * the other group. A per-project dedup id therefore only bites under a
   * per-project lane, and inheriting the default per-trace lane silently turns
   * the dedup into a no-op that leaves one live job per concurrent trace.
   *
   * This subscriber's work is per-project and level-triggered — it asserts the
   * project's metadata from whichever trace happens to carry it — so all of a
   * project's jobs belong in one serialized lane where the dedup collapses them
   * to one. The queue prefixes `<tenantId>/fold/traceSummary/reactor/
   * projectMetadata/` around this key.
   */
  static projectMetadataGroupKey(event: { tenantId: string }): string {
    return `project-metadata:${event.tenantId}`;
  }

  /**
   * Pure relevance guard, shared by `when` (pre-enqueue, sees the committed
   * fold state) and the handler (fail-open path). Sample traces (seeded from
   * the empty-state "Seed sample traces" path; every span carries
   * `langwatch.origin = "sample"`) are not a real first ingest. Flipping
   * `firstMessage` / `integrated` on them would prematurely dismiss the
   * empty-state onboarding card even though the user hasn't connected their own
   * app yet. Skip entirely — a real trace will trigger this subscriber again.
   */
  static isRealFirstIngest(foldState: TraceSummaryData): boolean {
    return foldState.attributes?.["langwatch.origin"] !== "sample";
  }

  /**
   * Subscriber handler that marks the project as having received its first
   * message.
   *
   * Sets project.firstMessage = true, project.integrated (unless
   * optimization_studio), and detects the SDK language from span resource
   * attributes. On the firstMessage transition it also tracks the
   * `first_trace_integrated` analytics event against the org admin.
   *
   * Uses a long dedup TTL so we only hit the database once per project in a
   * given window.
   */
  static createProjectMetadataHandler(
    deps: ProjectMetadataSubscriberDeps,
  ): (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) => Promise<void> {
    return async (_event, context) => {
      const { tenantId, state: foldState } = context;

      if (!ProjectMetadataSync.isRealFirstIngest(foldState)) return;

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
