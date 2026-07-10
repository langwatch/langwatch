/**
 * Redis-backed store for the incremental Claude Code turn conversion state.
 *
 * Keyed `{claude-span-sync}:state:<tenantId>:<traceId>` (the `{…}` hash tag pins
 * every key to one slot so the store works on a Redis Cluster). The value is the
 * bounded JSON blob from claude-code-turn-conversion.state.ts, written with a
 * refreshed 48h TTL on every pass so an active turn's state never expires
 * mid-conversion. A missing / unparseable value reads back as null, the
 * reactor's cue to re-convert the turn from zero (idempotent full redraw).
 */

import type { Cluster, Redis } from "ioredis";

import { CLAUDE_TURN_CONVERSION_STATE_TTL_SECONDS } from "./claude-code-log-to-span";
import {
  type ClaudeTurnConversionState,
  deserializeClaudeTurnConversionState,
  serializeClaudeTurnConversionState,
} from "./claude-code-turn-conversion.state";
import type { ClaudeTurnConversionStateStore } from "~/server/event-sourcing/pipelines/trace-processing/reactors/claudeCodeSpanSync.reactor";

function stateKey(tenantId: string, traceId: string): string {
  return `{claude-span-sync}:state:${tenantId}:${traceId}`;
}

/**
 * Build a {@link ClaudeTurnConversionStateStore} over a Redis connection. When
 * the connection is absent (build / no-Redis modes) the store degrades to a
 * no-op that always reads null, so the reactor simply re-converts from zero each
 * pass, correct, just not incremental.
 */
export function createRedisClaudeTurnConversionStateStore(
  connection: Redis | Cluster | undefined | null,
): ClaudeTurnConversionStateStore {
  return {
    async read(tenantId, traceId): Promise<ClaudeTurnConversionState | null> {
      if (!connection) return null;
      const raw = await connection.get(stateKey(tenantId, traceId));
      return deserializeClaudeTurnConversionState(raw);
    },
    async write(tenantId, traceId, state): Promise<void> {
      if (!connection) return;
      await connection.set(
        stateKey(tenantId, traceId),
        serializeClaudeTurnConversionState(state),
        "EX",
        CLAUDE_TURN_CONVERSION_STATE_TTL_SECONDS,
      );
    },
  };
}
