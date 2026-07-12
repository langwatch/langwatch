/**
 * Langy worker port — the control plane's HTTP calls to the Go opencode manager
 * that are NOT the turn dispatch itself: a liveness probe (so we can skip minting
 * a session key a live worker would discard) and a fire-and-forget warm (so the
 * opencode spawn overlaps the rest of the turn-start instead of preceding the
 * first token).
 *
 * Extracted from routes/langy.ts so the turn-start orchestration lives in the
 * app layer. Both fail OPEN in the safe direction: a broken probe means "mint as
 * if cold" (the pre-optimisation cost, never a broken turn); a failed warm means
 * a cold start (the status quo). Neither can start or duplicate a turn.
 */
import { context, propagation } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:langy:worker");
const tracer = getLangWatchTracer("langwatch.langy.chat");

/** The warm is fire-and-forget; don't let it hold a socket open. */
const AGENT_WARM_TIMEOUT_MS = 3_000;
/**
 * The probe sits in front of EVERY message, so it gets a tight budget. It exists
 * to save a ~70ms mint; spending longer than that waiting for the answer would
 * make it a pessimisation. On timeout we fail open and mint, exactly as before.
 */
const AGENT_PROBE_TIMEOUT_MS = 1_000;

export interface LangyWorkerPort {
  /**
   * Ask the manager whether a worker with these capabilities is already running,
   * so we can skip minting a session key it would only discard. FAILS OPEN
   * (returns false → the caller mints), so a probe outage costs the old mint,
   * never a broken turn.
   */
  probe(args: {
    conversationId: string;
    model?: string;
    hasGithubAuth: boolean;
    egressAllowlist?: string[];
  }): Promise<boolean>;

  /**
   * Boot the conversation's worker ahead of the turn (manager `POST /warm`).
   * Never awaited by the turn, never throws. `/warm` acquires a worker but never
   * claims it or posts a message, so it cannot start or duplicate a turn.
   */
  warm(args: {
    conversationId: string;
    credentials: unknown;
    modelOverride?: string;
  }): Promise<void>;
}

/**
 * HTTP implementation over the manager's internal-secret-authenticated endpoints.
 */
export function createLangyWorkerPort(config: {
  agentUrl: string;
  internalSecret: string;
}): LangyWorkerPort {
  const { agentUrl, internalSecret } = config;

  return {
    async probe({ conversationId, model, hasGithubAuth, egressAllowlist }) {
      try {
        const response = await fetch(`${agentUrl}/worker/probe`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${internalSecret}`,
          },
          body: JSON.stringify({
            conversationId,
            // Capability fields, not a pre-computed signature: the manager owns
            // the canonicalisation, and computing it here too would be a second
            // copy of the rule, free to drift until every probe silently missed.
            ...(model ? { model } : {}),
            hasGithubAuth,
            ...(egressAllowlist?.length ? { egressAllowlist } : {}),
          }),
          signal: AbortSignal.timeout(AGENT_PROBE_TIMEOUT_MS),
        });
        if (!response.ok) return false;
        const body = (await response.json()) as { alive?: unknown };
        return body.alive === true;
      } catch (error) {
        logger.debug(
          { error, conversationId },
          "langy worker probe failed — minting a session key as if cold",
        );
        return false;
      }
    },

    async warm({ conversationId, credentials, modelOverride }) {
      // Its own span, the one worth staring at: the warm is fire-and-forget, so
      // the only way to know whether the boot actually hides behind the rest of
      // the turn is to see this span overlap the ones that follow it. traceparent
      // is injected so the manager's spawn/boot spans attach to THIS trace.
      await tracer.withActiveSpan(
        "langy.chat.warm_worker",
        { attributes: { "langy.conversation.id": conversationId } },
        async () => {
          try {
            const headers: Record<string, string> = {
              "Content-Type": "application/json",
              Authorization: `Bearer ${internalSecret}`,
            };
            propagation.inject(context.active(), headers);

            const response = await fetch(`${agentUrl}/warm`, {
              method: "POST",
              headers,
              body: JSON.stringify({
                conversationId,
                credentials,
                ...(modelOverride ? { modelOverride } : {}),
              }),
              signal: AbortSignal.timeout(AGENT_WARM_TIMEOUT_MS),
            });
            void response.body?.cancel();
          } catch (error) {
            // A cold start is the status quo, not a failure. Debug on purpose.
            logger.debug(
              { error, conversationId },
              "langy worker warm failed — cold-starting",
            );
          }
        },
      );
    },
  };
}
