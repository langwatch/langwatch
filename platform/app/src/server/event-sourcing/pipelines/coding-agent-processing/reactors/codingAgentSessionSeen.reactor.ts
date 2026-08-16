import { createLogger } from "@langwatch/observability";

import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import { throttledPerWindow } from "../../../reactors/throttleWindow";
import type { CodingAgentSessionState } from "../projections/codingAgentSession.foldProjection";
import type { CodingAgentProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:coding-agent-processing:session-seen-reactor",
);

/**
 * The window one project's touch jobs collapse into.
 *
 * Five minutes, because nothing downstream reads the moment: the column feeds
 * a recency window measured in days, and the sidebar that renders it is read
 * on a page load, not a poll. The window only has to stop a busy project's
 * event stream from queueing a job per fold, and the write behind it is rate
 * limited again at the service, so even a job that does dispatch usually
 * writes nothing.
 */
export const CODING_AGENT_SESSION_SEEN_WINDOW_MS = 5 * 60 * 1000;

/** What the reactor needs to record the project's activity. */
export interface CodingAgentSessionSeenReactorDeps {
  touchCodingAgentSessionSeen(params: {
    projectId: string;
    at: Date;
  }): Promise<void>;
}

/**
 * One queue lane per project, matching this reactor's per-project dedup id.
 *
 * The queue's dedup key is global, but the check that decides whether a
 * duplicate is still squashable looks the existing job up in the CURRENT
 * group's job set. Under the pipeline's default per-session grouping, two
 * sessions of one project produce the same dedup id in two different groups,
 * the lookup misses, and the key is treated as stale rather than collapsing —
 * which for a project running several agents at once is every fold. Grouping
 * on what the key is keyed on is what makes the collapse happen.
 *
 * Serializing a project's touches costs nothing: they are idempotent
 * assertions of the same fact about the same row, and the fold's own lane is
 * separate (`<tenant>/fold/<fold>/reactor/<reactor>/…`), so a session's
 * contributions still apply in order.
 */
export function codingAgentSessionSeenGroupKey(event: {
  tenantId: string;
}): string {
  return `coding-agent-session-seen:${event.tenantId}`;
}

/**
 * Reactor that records the project a coding-agent session folded under, so the
 * project's sidebar can offer its Sessions destination.
 *
 * Every error is logged and swallowed. The session row, its counters and its
 * cost are already committed; a failed touch costs one menu link until the
 * project's next fold re-asserts it, and rethrowing would put the job back on
 * the queue to fail the same way.
 *
 * Spec: specs/coding-agent/project-menu-links.feature.
 */
export function createCodingAgentSessionSeenReactor(
  deps: CodingAgentSessionSeenReactorDeps,
): ReactorDefinition<CodingAgentProcessingEvent, CodingAgentSessionState> {
  return {
    name: "codingAgentSessionSeen",
    options: {
      runIn: ["worker"],
      groupKeyFn: (payload) => codingAgentSessionSeenGroupKey(payload.event),
      ...throttledPerWindow({
        makeJobId: (payload) =>
          `coding-agent-session-seen:${payload.event.tenantId}`,
        windowMs: CODING_AGENT_SESSION_SEEN_WINDOW_MS,
        // The window collapses a live burst; the TTL throttles a backlog. A
        // reactor's ready score is the event's own `createdAt`, so a group
        // draining a backlog stages jobs whose deadline has already passed:
        // they dispatch immediately and the window collapses nothing.
        //
        // Safe past dispatch, which is why the default is false and this
        // overrides it: the handler reads nothing from the event it was given
        // beyond the project it names, and every trigger inside the window
        // names the same project and asserts the same fact.
        shouldSurviveDispatch: true,
      }),
    },

    async handle(
      _event: CodingAgentProcessingEvent,
      context: ReactorContext<CodingAgentSessionState>,
    ): Promise<void> {
      const { tenantId } = context;

      try {
        await deps.touchCodingAgentSessionSeen({
          projectId: tenantId,
          at: new Date(),
        });
      } catch (error) {
        logger.warn(
          { error, tenantId },
          "recording the project's coding-agent session activity failed, non-fatal, the next fold retries it",
        );
      }
    },
  };
}
