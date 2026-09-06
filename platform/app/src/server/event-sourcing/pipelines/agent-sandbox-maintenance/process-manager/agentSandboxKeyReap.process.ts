import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type {
  IntentSpec,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";

const logger = createLogger("langwatch:agent-sandbox:key-reap");

export const AGENT_SANDBOX_KEY_REAP_PROCESS_NAME = "agentSandboxKeyReap";

/**
 * Hourly. A sandbox key carries its own `expiresAt` and `ApiKeyService.verify`
 * already refuses an elapsed one, so a reaped key was inert before this ran.
 * The sweep is about not leaving a long tail of live-looking rows behind, not
 * about closing an authentication hole.
 */
export const AGENT_SANDBOX_KEY_REAP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Outbox rows this process writes are bookkeeping, one per tick, pruned on the
 * same schedule every other recurring process uses.
 */
const REAP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const agentSandboxKeyReapSchema = z.object({
  scheduledFor: z.number().int(),
});

export interface AgentSandboxKeyReapState {
  lastReapAt: number | null;
}

export interface AgentSandboxKeyReapDeps {
  /** Revokes every elapsed, unrevoked sandbox key; returns the count. */
  reap: () => Promise<number>;
  deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  now?: () => number;
}

type AgentSandboxKeyReapIntents = {
  reap: IntentSpec<typeof agentSandboxKeyReapSchema>;
};

/**
 * Wake handlers must be pure and synchronous, with no I/O and no clock read,
 * because the commit that persists this evolution is what fences racing
 * workers. The revoke itself is an intent, so it runs behind the outbox lease.
 */
export const agentSandboxKeyReapWake: WakeHandler<
  AgentSandboxKeyReapState,
  AgentSandboxKeyReapIntents
> = (_state, ctx) => ({
  state: { lastReapAt: ctx.at },
  intents: [ctx.intents.reap(`reap:${ctx.at}`, { scheduledFor: ctx.at })],
});

export function runAgentSandboxKeyReap(deps: AgentSandboxKeyReapDeps) {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    // `reap` reports its own outcome under `langwatch:api-key:agent-sandbox`.
    // A second line here would split one event across two log streams.
    await deps.reap();

    try {
      await deps.deleteDispatchedBefore({
        processName: AGENT_SANDBOX_KEY_REAP_PROCESS_NAME,
        before: startedAt - REAP_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Agent sandbox key reap outbox retention failed",
      );
    }
  };
}
