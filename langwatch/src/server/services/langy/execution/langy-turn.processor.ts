/**
 * Langy turn processor + spawn function (ADR-044 parts 1–3).
 *
 * A direct analog of `startScenarioProcessor`. `startLangyTurnProcessor` wires
 * the pool's spawn function, boots the reconcile sweep, and returns a shutdown
 * handle that drains in-flight turns. `runTurn` is the spawn function: it does
 * what the old `/chat` stream executor did, minus holding a browser socket.
 *
 *   1. POST {OPENCODE_AGENT_URL}/chat with the internal Bearer secret.
 *   2. Bridge the manager's NDJSON: token deltas -> the Redis token buffer;
 *      transient `[langy:progress:*]` ticks -> EPHEMERAL signals; the meaningful
 *      `opened` (PR opened) result -> a DURABLE `tool_call_completed` event.
 *   3. Refresh the heartbeat key on a timer for the turn's life (liveness).
 *   4. On completion: `finalizeTurn` (turn_finalized, the whole answer) + end
 *      marker. On error: `failTurn` (agent_turn_failed) + error marker.
 *
 * @see src/server/scenarios/scenario.processor.ts (the pattern copied)
 * @see specs/langy/langy-event-driven-turns.feature
 */

import { createLogger } from "~/utils/logger/server";
import { getApp } from "~/server/app-layer/app";
import { auditLog } from "~/server/auditLog";
import { connection } from "~/server/redis";
import {
  recordExtraLangyGithubPrs,
  releaseLangyGithubPrPermit,
} from "~/server/middleware/rate-limit-langy-github-prs";
import { extractOpenedPrLinks } from "~/server/services/langy/githubPrLinks";
import {
  parseGithubProgressEvents,
  type GithubProgressEvent,
} from "~/server/services/langy/githubProgressEvents";
import { stripLangySentinels } from "~/server/services/langy/langySentinels";
import type { LangyConversationService } from "~/server/app-layer/langy/langy-conversation.service";
import { LANGY_LIVENESS } from "../streaming/langy.streaming.constants";
import { RedisLangyEphemeralPublisher } from "../streaming/langyEphemeralPublisher";
import {
  createLangyTokenBuffer,
  LangyTokenBuffer,
} from "../streaming/langyTokenBuffer";
import { createLangyTurnHandoffStore } from "../streaming/langyTurnHandoff";
import type { LangyTurnJobData, LangyWorkerPool } from "./langy-worker-pool";
import {
  reconcileLangyTurns,
  type LangyTurnReconcilerDeps,
} from "./langy-turn-reconciler";

const logger = createLogger("langwatch:langy:turn-processor");

/** Progress stages that carry no persisted result — pure "how far through". */
const EPHEMERAL_PROGRESS_STAGES = new Set<GithubProgressEvent["stage"]>([
  "cloning",
  "cloned",
  "branched",
  "edited",
  "committed",
  "pushed",
  "opening_pr",
]);

/** How the manager wire is spelled today (unchanged from the old route). */
const AGENT_CHAT_TIMEOUT_MS = 120_000;

export interface RunTurnDeps {
  conversations: LangyConversationService;
  ephemeral: RedisLangyEphemeralPublisher;
  buffer: LangyTokenBuffer;
  agentUrl: string;
  internalSecret: string;
  fetchImpl?: typeof fetch;
}

/**
 * Parse an OpenCode NDJSON line into a text delta, or detect a hard error. Kept
 * byte-identical to the old route's `handleLine` (message.part.delta with
 * field=text, plus the legacy `text` shape); adds `error` event detection so an
 * at-capacity / opencode error terminalizes the turn instead of hanging.
 */
function parseAgentLine(
  line: string,
): { delta?: string; error?: string } | null {
  if (!line.trim()) return null;
  try {
    const event = JSON.parse(line) as {
      type?: string;
      error?: string;
      part?: { type?: string; text?: string };
      properties?: { field?: string; delta?: string };
    };
    if (event.type === "error") {
      return { error: event.error || "agent error" };
    }
    if (event.type === "text" && event.part?.text) {
      return { delta: event.part.text };
    }
    if (
      event.type === "message.part.delta" &&
      event.properties?.field === "text" &&
      typeof event.properties?.delta === "string"
    ) {
      return { delta: event.properties.delta };
    }
    return null;
  } catch {
    return null; // ignore malformed/partial JSON lines
  }
}

/**
 * Run one Langy turn end-to-end. The spawn function for the `LangyWorkerPool`.
 */
export async function runTurn(
  job: LangyTurnJobData,
  deps: RunTurnDeps,
): Promise<void> {
  const {
    projectId,
    conversationId,
    turnId,
    prompt,
    system,
    modelOverride,
    credentials,
  } = job;
  const doFetch = deps.fetchImpl ?? fetch;
  const turnLogger = logger.child({ projectId, conversationId, turnId });

  const heartbeat = setInterval(() => {
    void deps.buffer
      .heartbeat({ conversationId, turnId })
      .catch((error) =>
        turnLogger.debug({ error }, "heartbeat refresh failed"),
      );
  }, LANGY_LIVENESS.HEARTBEAT_INTERVAL_MS);
  // Beat once immediately so a turn is "live" before the first interval tick.
  await deps.buffer.heartbeat({ conversationId, turnId }).catch(() => {});

  let fullText = "";
  let emittedProgress = 0;

  const drainProgress = async () => {
    const { events } = parseGithubProgressEvents(fullText);
    for (let i = emittedProgress; i < events.length; i++) {
      const ev = events[i]!;
      if (EPHEMERAL_PROGRESS_STAGES.has(ev.stage)) {
        // Transient "how far through" — ephemeral (Redis), never the event log.
        await deps.ephemeral.publish(projectId, {
          type: "lw.langy_conversation.progress_reported",
          conversationId,
          turnId,
          message: ev.detail ? `${ev.stage}: ${ev.detail}` : ev.stage,
          occurredAt: Date.now(),
        });
      } else if (ev.stage === "opened") {
        // A PR was opened — a meaningful, persisted result. DURABLE milestone.
        const toolCallId = ev.detail || `${turnId}:pr:${i}`;
        await deps.conversations.recordToolCallCompleted({
          projectId,
          conversationId,
          turnId,
          toolCallId,
          toolName: "github.open_pr",
        });
        await deps.buffer.appendMilestone({
          conversationId,
          turnId,
          kind: "pr_opened",
          detail: ev.detail,
        });
      }
    }
    emittedProgress = events.length;
  };

  try {
    const agentResponse = await doFetch(`${deps.agentUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${deps.internalSecret}`,
      },
      body: JSON.stringify({
        conversationId,
        prompt,
        system,
        credentials,
        ...(modelOverride ? { modelOverride } : {}),
      }),
      signal: AbortSignal.timeout(AGENT_CHAT_TIMEOUT_MS),
    });

    if (!agentResponse.ok || !agentResponse.body) {
      void agentResponse.body?.cancel();
      throw new Error(`manager responded ${agentResponse.status}`);
    }

    const reader = agentResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let hardError: string | null = null;

    const handleLine = async (line: string) => {
      const parsed = parseAgentLine(line);
      if (!parsed) return;
      if (parsed.error) {
        hardError = parsed.error;
        return;
      }
      if (parsed.delta) {
        fullText += parsed.delta;
        await deps.buffer.appendChunk({
          conversationId,
          turnId,
          text: parsed.delta,
        });
        await drainProgress();
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        await handleLine(line);
      }
    }
    if (buffer.trim()) await handleLine(buffer);

    if (hardError) {
      throw new Error(hardError);
    }

    // Terminal: the whole final answer is the durable source of truth; tokens
    // were never events. Sentinels are stripped from the persisted body.
    const answer = stripLangySentinels(fullText);
    await deps.conversations.finalizeTurn({
      projectId,
      conversationId,
      turnId,
      parts: [{ type: "text", text: answer, role: "assistant" }],
      outcome: "completed",
    });
    await deps.buffer.markEnd({ conversationId, turnId });

    // GitHub-PR permit reconcile + audit — moved here from the old synchronous
    // route's stream executor `finally` (ADR-044). The reserve happened on the
    // route (gate-keeping GH_TOKEN before spawn); reconcile is per-PR, not
    // per-turn: bump the daily counter by any EXTRA PRs a runaway turn opened,
    // and release the slot when the turn opened none. Preserves the
    // release-only-if-`permitReserved` latch (the erosion-via-blip cap-bypass).
    await reconcilePrPermit({ job, fullText, turnLogger });

    turnLogger.info("langy turn completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    turnLogger.warn({ error: message }, "langy turn failed");
    // Terminal failure with no answer to carry -> agent_turn_failed.
    try {
      await deps.conversations.failTurn({
        projectId,
        conversationId,
        turnId,
        error: message,
      });
    } catch (dispatchError) {
      turnLogger.error(
        { error: dispatchError },
        "failed to dispatch failTurn",
      );
    }
    await deps.buffer
      .markError({ conversationId, turnId, error: message })
      .catch(() => {});
    // A failed turn opened no PR — return the reserved permit so a read-only /
    // failed chat doesn't burn the user's daily slot.
    if (job.permitReserved) {
      await releaseLangyGithubPrPermit({ userId: job.actorUserId }).catch(
        (releaseError) =>
          turnLogger.warn({ releaseError }, "failed to release PR permit"),
      );
    }
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Reconcile the per-turn GitHub-PR permit against the PRs the turn actually
 * opened, and audit each. Idempotent-ish and isolated so a reconcile failure
 * never masks a completed turn.
 */
async function reconcilePrPermit({
  job,
  fullText,
  turnLogger,
}: {
  job: LangyTurnJobData;
  fullText: string;
  turnLogger: ReturnType<typeof logger.child>;
}): Promise<void> {
  try {
    const links = extractOpenedPrLinks(fullText);
    if (links.length === 0) {
      // No PR opened — return the reserved slot.
      if (job.permitReserved) {
        await releaseLangyGithubPrPermit({ userId: job.actorUserId });
      }
      return;
    }
    // PR(s) opened — the up-front permit is consumed (do NOT release). If more
    // than one landed, bump the daily counter by the remaining N-1 so the cap
    // is per-PR, not per-turn (release-only-if-reserved preserved).
    if (links.length > 1 && job.permitReserved) {
      await recordExtraLangyGithubPrs({
        userId: job.actorUserId,
        extra: links.length - 1,
      });
    }
    for (const link of links) {
      await auditLog({
        userId: job.actorUserId,
        projectId: job.projectId,
        action: "langy.github.pr_opened",
        args: {
          owner: link.owner,
          repo: link.repo,
          number: link.number,
          url: link.url,
        },
      });
    }
  } catch (error) {
    turnLogger.error({ error }, "failed to reconcile langy github PR permit");
  }
}

/** Build the production run-turn deps from the app + env + Redis. */
function createRunTurnDeps(): RunTurnDeps | null {
  const agentUrl = process.env.OPENCODE_AGENT_URL;
  const internalSecret = process.env.LANGY_INTERNAL_SECRET;
  if (!agentUrl || !internalSecret || !connection) {
    logger.info(
      { hasAgentUrl: !!agentUrl, hasSecret: !!internalSecret, hasRedis: !!connection },
      "Langy turn processor missing config — spawn function will no-op",
    );
    return null;
  }
  // A dedicated blocking connection for XREAD BLOCK follow reads on the reader
  // side; the writer side (this processor) only XADDs, so it uses the shared
  // connection directly.
  const buffer = createLangyTokenBuffer({ redis: connection });
  const ephemeral = new RedisLangyEphemeralPublisher(buffer);
  return {
    conversations: getApp().langy.conversations,
    ephemeral,
    buffer,
    agentUrl,
    internalSecret,
  };
}

/**
 * Start the Langy turn processor: wire the pool spawn function, boot + schedule
 * the reconcile sweep, and return a shutdown handle. Returns undefined when
 * Redis / manager config is absent (mirrors `startScenarioProcessor`).
 */
export async function startLangyTurnProcessor(
  pool: LangyWorkerPool,
  overrides?: {
    runTurnDeps?: RunTurnDeps;
    reconcilerDeps?: LangyTurnReconcilerDeps;
  },
): Promise<{ close: () => Promise<void> } | undefined> {
  if (!connection) {
    logger.info("No Redis connection, skipping langy turn processor");
    return undefined;
  }

  const deps = overrides?.runTurnDeps ?? createRunTurnDeps();
  if (!deps) return undefined;

  pool.setSpawnFunction((job) => runTurn(job, deps));

  const reconcilerDeps: LangyTurnReconcilerDeps =
    overrides?.reconcilerDeps ?? {
      buffer: deps.buffer,
      conversations: deps.conversations,
    };

  // Boot sweep + periodic sweep. Fire-and-forget so a slow ClickHouse scan
  // never wedges worker startup.
  const runSweep = () =>
    reconcileLangyTurns(reconcilerDeps).catch((err) =>
      logger.warn({ err }, "langy reconcile sweep failed"),
    );
  void runSweep();
  const sweepInterval = setInterval(() => void runSweep(), LANGY_LIVENESS.SWEEP_INTERVAL_MS);

  logger.info("Langy turn processor started (event-driven)");

  return {
    close: async () => {
      clearInterval(sweepInterval);
      // Emit a terminal failure for every in-flight turn so a deploy mid-turn
      // does not orphan turns in-flight (deploy-survival, mirror drainInFlightRuns).
      const handoffStore = createLangyTurnHandoffStore({ redis: connection! });
      void handoffStore; // reserved: retry path would re-stash here in future
      await pool.drain(async (job) => {
        await deps.conversations.failTurn({
          projectId: job.projectId,
          conversationId: job.conversationId,
          turnId: job.turnId,
          error: "Worker restarting — turn terminated before completion",
        });
        await deps.buffer
          .markError({
            conversationId: job.conversationId,
            turnId: job.turnId,
            error: "worker restart",
          })
          .catch(() => {});
      });
    },
  };
}
