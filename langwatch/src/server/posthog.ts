import { PostHog } from "posthog-node";
import { createLogger } from "~/utils/logger/server";
import { env } from "../env.mjs";

const logger = createLogger("langwatch:posthog:client");

// Create a private singleton instance
const _posthogInstance = env.POSTHOG_KEY
  ? new PostHog(env.POSTHOG_KEY, {
      host: env.POSTHOG_HOST,
    })
  : null;

/**
 * Returns the PostHog instance if it exists, null otherwise.
 * The instance is immutable and should not be modified.
 */
export function getPostHogInstance(): PostHog | null {
  return _posthogInstance;
}

/**
 * Fire-and-forget server-side event tracking.
 * Silently no-ops when POSTHOG_KEY is not set (self-hosted without PostHog).
 *
 * Identity: pass `userId` for session-backed calls (web). For non-session callers
 * (API key → SDK/CLI/MCP) pass `distinctId` explicitly (e.g. `project:<id>`). When
 * `organizationId` is provided it is emitted as `$groups.organization` so org-level
 * analytics work regardless of which identity path was used.
 */
export function trackServerEvent({
  userId,
  distinctId,
  event,
  properties,
  projectId,
  organizationId,
  groups,
}: {
  userId?: string;
  distinctId?: string;
  event: string;
  properties?: Record<string, unknown>;
  projectId?: string;
  organizationId?: string;
  groups?: Record<string, string>;
}) {
  const posthog = getPostHogInstance();
  if (!posthog) return;

  const resolvedDistinctId = userId ?? distinctId;
  if (!resolvedDistinctId) {
    logger.warn(
      { event },
      "trackServerEvent called without userId or distinctId; skipping",
    );
    return;
  }

  const resolvedGroups: Record<string, string> = {
    ...(organizationId ? { organization: organizationId } : {}),
    ...(projectId ? { project: projectId } : {}),
    ...(groups ?? {}),
  };

  posthog.capture({
    distinctId: resolvedDistinctId,
    event,
    properties: {
      ...properties,
      ...(projectId ? { projectId } : {}),
    },
    ...(Object.keys(resolvedGroups).length > 0
      ? { groups: resolvedGroups }
      : {}),
  });
}

/**
 * Shuts down the PostHog client, flushing pending events.
 * Called by the main shutdown handler in start.ts — no separate signal handlers
 * to avoid competing with the graceful shutdown sequence.
 */
export async function shutdownPostHog(): Promise<void> {
  if (_posthogInstance) {
    logger.info("Shutting down PostHog client");
    await _posthogInstance.shutdown();
  }
}
