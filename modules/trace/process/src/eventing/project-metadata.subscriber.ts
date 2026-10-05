/**
 * What a project's first trace tells us. Ingest is the only moment some of
 * this is knowable (SDK language, integrated at all), read once on the
 * first real trace. `isRealFirstIngest` guards a re-delivered first trace.
 */

import type { TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type {
  Project,
  UpdateProjectMetadataInput,
  OrgAdminResolution,
} from "@langwatch/project-contract";
import {
  LANGY_TRACE_ORIGIN,
  type TraceSummaryData,
  type TraceProcessingEvent,
} from "@langwatch/trace-contract";

import type { TraceProjectMilestonesService } from "../services/trace-project-milestones.service.ts";

/** The three things the projectMetadata subscriber does to a project. Narrowed
 * from the full ProjectApi so background processes can compose just this. */
export interface TraceProjectMetadata {
  findById(id: string): Promise<Project | null>;
  updateMetadata(input: UpdateProjectMetadataInput): Promise<void>;
  /**
   * The org admin's user id, which is also the distinct_id posthog-js
   * identifies the same person with in the browser.
   */
  resolveOrgAdmin(projectId: string): Promise<OrgAdminResolution>;
}

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
  /** Records the first and later traces as trace's own events (§9); a failure is only logged. */
  milestones: Pick<TraceProjectMilestonesService, "recordFirstTrace" | "recordTraceReceived">;
  /**
   * Marks the project active for the day of this trace, once a day. Injected
   * so trace never imports billing's process package (structurally typed).
   */
  trackActiveDay?: (input: { projectId: string; occurredAt: number }) => Promise<void>;
}

/**
 * Tracks the project's first real trace as an integration milestone, against
 * the org admin: that is the same distinct_id posthog-js identifies the user
 * with in the browser, so this server event joins the browser person.
 */
async function trackFirstTraceIntegrated({
  deps,
  source,
  tenantId,
  attrs,
}: {
  deps: ProjectMetadataSubscriberDeps;
  source: FirstTraceSource;
  tenantId: string;
  attrs: Record<string, string>;
}): Promise<void> {
  const { userId } = await deps.projects.resolveOrgAdmin(tenantId);
  if (!userId) return;

  try {
    await deps.milestones.recordFirstTrace({
      tenantId,
      projectId: tenantId,
      userId,
      sdkLanguage: attrs["sdk.language"] ?? "unknown",
      sdkFramework: attrs["langwatch.sdk.framework"] ?? "unknown",
      occurredAt: source.occurredAt,
    });
  } catch (error) {
    logger.error({ tenantId, error }, "Failed to record the first trace (non-fatal)");
  }
}

/** The trace event that found the project unmarked: the first trace's signal is keyed by it. */
type FirstTraceSource = Readonly<{ id: string; occurredAt: number }>;

/** A later real trace, against the org admin: main's last_trace_at update, non-fatal. */
async function trackTraceReceived({
  deps,
  source,
  tenantId,
}: {
  deps: ProjectMetadataSubscriberDeps;
  source: FirstTraceSource;
  tenantId: string;
}): Promise<void> {
  try {
    const { userId } = await deps.projects.resolveOrgAdmin(tenantId);
    if (!userId) return;

    await deps.milestones.recordTraceReceived({
      tenantId,
      projectId: tenantId,
      userId,
      occurredAt: source.occurredAt,
    });
  } catch (error) {
    logger.error({ tenantId, error }, "Failed to record a later trace (non-fatal)");
  }
}

async function syncProjectMetadata({
  deps,
  source,
  tenantId,
  foldState,
}: {
  deps: ProjectMetadataSubscriberDeps;
  source: FirstTraceSource;
  tenantId: string;
  foldState: TraceSummaryData;
}): Promise<void> {
  const project = await deps.projects.findById(tenantId);

  if (!project) {
    logger.warn({ tenantId }, "Project not found — skipping metadata update");
    return;
  }

  // Level-triggered, so it runs BEFORE the already-marked early return
  // below: an established project is exactly the case that used to be
  // unreachable here, and exactly the case the deploy backfill existed
  // to repair.
  await assertClusteringSchedule(deps, tenantId);

  // A real trace on a project that already sent its first: main's
  // last_trace_at update (customerIoTraceSync), keyed off the same flag.
  if (project.firstMessage) {
    await trackTraceReceived({ deps, source, tenantId });
  }

  // Already marked — nothing to do
  if (project.firstMessage && project.integrated) {
    return;
  }

  await markFirstMessage({
    deps,
    source,
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
async function assertClusteringSchedule(
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

function detectLanguage(attrs: Record<string, string>): string {
  if (attrs["langwatch.platform"] === "optimization_studio") return "other";
  const sdkLanguage = attrs["sdk.language"];
  if (sdkLanguage === "python" || sdkLanguage === "typescript") {
    return sdkLanguage;
  }
  return "other";
}

async function markFirstMessage({
  deps,
  source,
  tenantId,
  project,
  attrs,
}: {
  deps: ProjectMetadataSubscriberDeps;
  source: FirstTraceSource;
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
      language: detectLanguage(attrs),
    },
  });

  // Fired after the metadata write commits, so a failed write retries
  // the event on the project's next trace instead of dropping it.
  if (!project.firstMessage) {
    await trackFirstTraceIntegrated({ deps, source, tenantId, attrs });
  }
}

// Per-project dedup lane: level-triggered subscriber needs serialization
// to collapse concurrent traces to one assertion.
export function projectMetadataGroupKey(event: { tenantId: string }): string {
  return `project-metadata:${event.tenantId}`;
}

// Skip sample traces from empty-state onboarding and Langy's own turns:
// neither should flip the integrated flag, dismiss the onboarding card,
// or reach a CRM milestone as the customer's own first trace.
export function isRealFirstIngest(foldState: TraceSummaryData): boolean {
  const origin = foldState.attributes?.["langwatch.origin"];
  return origin !== "sample" && origin !== LANGY_TRACE_ORIGIN;
}

// Long dedup TTL ensures at most one database write per project window
// for setting first message and SDK language.
export function createProjectMetadataHandler(
  deps: ProjectMetadataSubscriberDeps,
): (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) => Promise<void> {
  return async (event, context) => {
    const { tenantId, state: foldState } = context;

    if (!isRealFirstIngest(foldState)) return;

    await deps.trackActiveDay?.({ projectId: tenantId, occurredAt: event.occurredAt });

    try {
      await syncProjectMetadata({ deps, source: event, tenantId, foldState });
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
