import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type {
  IntentSpec,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";

const logger = createLogger("langwatch:connected-agents:archive-sweep");

export const CONNECTED_AGENT_ARCHIVE_PROCESS_NAME = "connectedAgentArchive";

/**
 * Daily. A connected agent unseen for thirty days is one nobody runs any
 * more; archiving it keeps the agents list to what is real. A reconnect of
 * the same identity restores the row, so nothing is lost.
 */
export const CONNECTED_AGENT_ARCHIVE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Outbox rows this process writes are bookkeeping, one per day. */
const ARCHIVE_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const connectedAgentArchiveSchema = z.object({
  scheduledFor: z.number().int(),
});

export interface ConnectedAgentArchiveState {
  lastSweepAt: number | null;
}

export interface ConnectedAgentArchiveDeps {
  /** Archives every connected agent unseen for too long; returns the count. */
  archive: () => Promise<number>;
  deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  now?: () => number;
}

type ConnectedAgentArchiveIntents = {
  archive: IntentSpec<typeof connectedAgentArchiveSchema>;
};

/**
 * Pure and synchronous, like every wake handler: the commit that persists
 * this evolution is what fences racing workers. The sweep itself is an
 * intent, so it runs behind the outbox lease.
 */
export const connectedAgentArchiveWake: WakeHandler<
  ConnectedAgentArchiveState,
  ConnectedAgentArchiveIntents
> = (_state, ctx) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intents.archive(`archive:${ctx.at}`, { scheduledFor: ctx.at })],
});

export function runConnectedAgentArchive(deps: ConnectedAgentArchiveDeps) {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    await deps.archive();

    try {
      await deps.deleteDispatchedBefore({
        processName: CONNECTED_AGENT_ARCHIVE_PROCESS_NAME,
        before: startedAt - ARCHIVE_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "connected agent archive outbox retention failed",
      );
    }
  };
}
