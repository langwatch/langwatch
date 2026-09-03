import { createLogger } from "@langwatch/observability";
import { context, propagation, trace } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { z } from "zod";

import { LANGY_AGENT_DISPATCH_TIMEOUT_MS } from "../ports/langy-effect.port";
import type {
  LangyDispatchOutcome,
  LangyWorkerMetricsPort,
  LangyWorkerPort,
} from "../ports/langy-turn-runtime.port";

export type { LangyDispatchOutcome } from "../ports/langy-turn-runtime.port";

const AGENT_WARM_TIMEOUT_MS = 3_000;
const AGENT_PROBE_TIMEOUT_MS = 1_000;
const AGENT_CANCEL_TIMEOUT_MS = 3_000;

const probeResponseSchema = z.object({
  alive: z.boolean().optional(),
});

export const AGENT_DISPATCH_TIMEOUT_MS = LANGY_AGENT_DISPATCH_TIMEOUT_MS;

export type LangyWorkerHttpConfig = {
  agentUrl: string;
  internalSecret: string;
};

export type LangyWorkerAdapterConfig = LangyWorkerHttpConfig & {
  metrics: LangyWorkerMetricsPort;
};

function headers(internalSecret: string): Record<string, string> {
  const result: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${internalSecret}`,
  };
  propagation.inject(context.active(), result);
  return result;
}

function dispatchOutcome(response: Response): LangyDispatchOutcome {
  if (response.status === 202 || response.ok) {
    return "accepted";
  }

  if (response.status === 409) {
    return "busy";
  }

  if (response.status === 428) {
    return "credentialsRequired";
  }

  if (response.status === 400 || response.status === 422) {
    return "rejected";
  }

  return "unavailable";
}

/** HTTP adapter for the process-owned Langy worker manager. */
export function createLangyWorkerPort(config: LangyWorkerAdapterConfig): LangyWorkerPort {
  const { agentUrl, internalSecret, metrics } = config;
  const logger = createLogger("langwatch:langy:worker");
  const tracer = getLangWatchTracer("langwatch.langy.chat");

  return {
    async probe({
      projectId,
      actorUserId,
      conversationId,
      model,
      hasGithubAuth,
      githubRepoScopeKey,
      egressAllowlist,
      mirrorTier,
      harness,
    }) {
      try {
        const response = await fetch(`${agentUrl}/worker/probe`, {
          method: "POST",
          headers: headers(internalSecret),
          body: JSON.stringify({
            projectId,
            actorUserId,
            conversationId,
            ...(model ? { model } : {}),
            hasGithubAuth,
            ...(githubRepoScopeKey ? { githubRepoScopeKey } : {}),
            ...(egressAllowlist?.length ? { egressAllowlist } : {}),
            ...(mirrorTier ? { mirrorTier } : {}),
            ...(harness ? { harness } : {}),
          }),
          signal: AbortSignal.timeout(AGENT_PROBE_TIMEOUT_MS),
        });
        if (!response.ok) {
          return false;
        }

        const body = probeResponseSchema.parse(await response.json());
        const alive = body.alive === true;
        trace.getActiveSpan()?.setAttribute("langy.probe.hit", alive);
        return alive;
      } catch (error) {
        logger.debug(
          { error, conversationId },
          "langy worker probe failed — minting a session key as if cold",
        );
        return false;
      }
    },

    async warm({ projectId, actorUserId, conversationId, credentials, modelOverride }) {
      await tracer.withActiveSpan(
        "langy.chat.warm_worker",
        {
          attributes: {
            "tenant.id": projectId,
            "user.id": actorUserId,
            "langy.conversation.id": conversationId,
          },
        },
        async () => {
          try {
            const response = await fetch(`${agentUrl}/warm`, {
              method: "POST",
              headers: headers(internalSecret),
              body: JSON.stringify({
                projectId,
                actorUserId,
                conversationId,
                credentials,
                ...(modelOverride ? { modelOverride } : {}),
              }),
              signal: AbortSignal.timeout(AGENT_WARM_TIMEOUT_MS),
            });
            void response.body?.cancel();
          } catch (error) {
            logger.debug({ error, conversationId }, "langy worker warm failed — cold-starting");
          }
        },
      );
    },

    async dispatch({
      intent,
      conversationId,
      turnId,
      projectId,
      userId,
      runToken,
      prompt,
      system,
      historySeed,
      credentials,
      modelOverride,
      resumeToken,
    }) {
      return tracer.withActiveSpan(
        "langy.chat.dispatch_turn",
        {
          attributes: {
            "tenant.id": projectId,
            "user.id": userId,
            "langy.conversation.id": conversationId,
            "langy.turn.id": turnId,
            "langy.worker.intent": intent,
          },
        },
        async (span): Promise<LangyDispatchOutcome> => {
          try {
            const response = await fetch(`${agentUrl}/worker/${intent}`, {
              method: "POST",
              headers: headers(internalSecret),
              body: JSON.stringify({
                conversationId,
                turnId,
                projectId,
                userId,
                runToken,
                prompt,
                system,
                ...(historySeed ? { historySeed } : {}),
                credentials,
                ...(modelOverride ? { modelOverride } : {}),
                ...(resumeToken ? { resumeToken } : {}),
              }),
              signal: AbortSignal.timeout(AGENT_DISPATCH_TIMEOUT_MS),
            });
            void response.body?.cancel();
            const outcome = dispatchOutcome(response);
            span.setAttribute("langy.dispatch.outcome", outcome);
            metrics.recordDispatch({ outcome });
            return outcome;
          } catch (error) {
            logger.warn(
              { error, conversationId, turnId },
              "langy worker dispatch failed — leaving the turn to the liveness subscriber",
            );
            span.setAttribute("langy.dispatch.outcome", "error");
            metrics.recordDispatch({ outcome: "error" });
            return "unavailable";
          }
        },
      );
    },

    async cancel({ conversationId, turnId, projectId }) {
      await tracer.withActiveSpan(
        "langy.chat.cancel_turn",
        {
          attributes: {
            "tenant.id": projectId,
            "langy.conversation.id": conversationId,
            "langy.turn.id": turnId,
          },
        },
        async () => {
          try {
            const response = await fetch(`${agentUrl}/worker/cancel`, {
              method: "POST",
              headers: headers(internalSecret),
              body: JSON.stringify({ conversationId, turnId, projectId }),
              signal: AbortSignal.timeout(AGENT_CANCEL_TIMEOUT_MS),
            });
            void response.body?.cancel();
          } catch (error) {
            logger.debug(
              { error, conversationId, turnId },
              "langy worker cancel failed — the turn is already stopped on record",
            );
          }
        },
      );
    },
  };
}
