import { createLogger } from "@langwatch/observability";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import { trackServerEvent } from "~/server/posthog";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import { throttledPerWindow } from "../../../reactors/throttleWindow";
import type { TraceSummaryData } from "../projections/traceSummary.foldProjection";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:project-metadata-reactor",
);

/**
 * Roughly one poll of the onboarding screen that waits on these flags, so a
 * user who has just sent their first trace waits at most one extra cycle.
 */
export const PROJECT_METADATA_WINDOW_MS = 3_000;

export interface ProjectMetadataReactorDeps {
  projects: ProjectService;
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
}

/**
 * One queue lane per project, matching this reactor's per-project dedup id.
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
 * This reactor's work is per-project and level-triggered — it asserts the
 * project's metadata from whichever trace happens to carry it — so all of a
 * project's jobs belong in one serialized lane where the dedup collapses them
 * to one. The queue prefixes `<tenantId>/fold/traceSummary/reactor/
 * projectMetadata/` around this key.
 */
export function projectMetadataGroupKey(event: { tenantId: string }): string {
  return `project-metadata:${event.tenantId}`;
}

/**
 * Reactor that marks the project as having received its first message.
 *
 * Sets project.firstMessage = true, project.integrated (unless optimization_studio),
 * and detects the SDK language from span resource attributes. On the
 * firstMessage transition it also tracks the `first_trace_integrated`
 * analytics event against the org admin.
 *
 * Uses a long dedup TTL so we only hit the database once per project in a given window.
 */
/**
 * Pure relevance guard, shared by shouldReact (pre-enqueue) and handle
 * (fail-open path). Sample traces (seeded from the empty-state "Seed
 * sample traces" path; every span carries `langwatch.origin = "sample"`)
 * are not a real first ingest. Flipping `firstMessage` / `integrated` on
 * them would prematurely dismiss the empty-state onboarding card even
 * though the user hasn't connected their own app yet. Skip entirely —
 * a real trace will trigger this reactor again.
 */
function isRealFirstIngest(foldState: TraceSummaryData): boolean {
  return foldState.attributes?.["langwatch.origin"] !== "sample";
}

/**
 * Tracks the project's first real trace as an integration milestone, against
 * the org admin: that is the same distinct_id posthog-js identifies the user
 * with in the browser, so this server event joins the browser person.
 */
async function trackFirstTraceIntegrated({
  projects,
  tenantId,
  attrs,
}: {
  projects: ProjectService;
  tenantId: string;
  attrs: Record<string, string>;
}): Promise<void> {
  const { userId } = await projects.resolveOrgAdmin(tenantId);
  if (!userId) return;

  trackServerEvent({
    userId,
    event: "first_trace_integrated",
    properties: {
      sdk_language: attrs["sdk.language"] ?? "unknown",
      sdk_framework: attrs["langwatch.sdk.framework"] ?? "unknown",
    },
    projectId: tenantId,
  });
}

export function createProjectMetadataReactor(
  deps: ProjectMetadataReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "projectMetadata",
    shouldReact: (_event, context) => isRealFirstIngest(context.foldState),
    options: {
      runIn: ["worker"],
      groupKeyFn: (payload) => projectMetadataGroupKey(payload.event),
      // Held to roughly one onboarding poll. This reactor flips the flags an
      // onboarding screen waits on, and one of those screens reads them once
      // without polling at all, so a long window would leave a user who has
      // already sent a trace looking at the "connect your app" guide. One
      // extra poll of latency buys collapsing an entire trace's spans, which
      // for an established project are all no-ops anyway.
      //
      // The lane above and the window here are the two halves of one
      // behaviour: the lane lets a project's concurrent traces share a dedup
      // key at all, the window gives that key long enough to collapse them.
      ...throttledPerWindow({
        makeJobId: (payload) => `project-meta:${payload.event.tenantId}`,
        windowMs: PROJECT_METADATA_WINDOW_MS,
      }),
    },

    async handle(
      _event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId, foldState } = context;
      const attrs = foldState.attributes ?? {};

      if (!isRealFirstIngest(foldState)) return;

      try {
        const project = await deps.projects.getById(tenantId);

        if (!project) {
          logger.warn(
            { tenantId },
            "Project not found — skipping metadata update",
          );
          return;
        }

        // Level-triggered, so it runs BEFORE the already-marked early return
        // below: an established project is exactly the case that used to be
        // unreachable here, and exactly the case the deploy backfill existed
        // to repair.
        //
        // Own error handling: a bootstrap failure must not be reported as a
        // metadata failure, and must not stop the metadata write that follows.
        // Failing is survivable now — the next trace re-asserts it.
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

        // Already marked — nothing to do
        if (project.firstMessage && project.integrated) {
          return;
        }

        const isOptimizationStudio =
          attrs["langwatch.platform"] === "optimization_studio";

        const sdkLanguage = attrs["sdk.language"];
        const language = isOptimizationStudio
          ? "other"
          : sdkLanguage === "python"
            ? "python"
            : sdkLanguage === "typescript"
              ? "typescript"
              : "other";

        await deps.projects.updateMetadata({
          id: tenantId,
          data: {
            firstMessage: true,
            integrated: isOptimizationStudio ? project.integrated : true,
            language,
          },
        });

        // Fired after the metadata write commits, so a failed write retries
        // the event on the project's next trace instead of dropping it.
        if (!project.firstMessage) {
          await trackFirstTraceIntegrated({
            projects: deps.projects,
            tenantId,
            attrs,
          });
        }
      } catch (error) {
        logger.warn(
          {
            tenantId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to update project metadata — non-fatal",
        );
      }
    },
  };
}
