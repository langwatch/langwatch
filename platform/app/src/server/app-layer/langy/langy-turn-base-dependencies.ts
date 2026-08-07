import { createLogger } from "@langwatch/observability";
import { getLangWatchTracer } from "langwatch";
import type { Session } from "~/server/auth";

import {
  LangyEgressMisconfiguredError,
  LangyModelNotConfiguredError,
} from "./errors";
import type { LangyTurnServiceDeps } from "./langy-turn.service";

const logger = createLogger("langwatch:langy:turn-dependencies");
const tracer = getLangWatchTracer("langwatch.langy.chat");

type LangyTurnBaseDependenciesArgs = {
  deps: Pick<
    LangyTurnServiceDeps,
    "conversations" | "credentials" | "resolveModel"
  >;
  projectId: string;
  userId: string;
  session: Session;
  requestedConversationId: string | null;
  modelOverride?: string;
};

/**
 * Fire every project-scoped dependency call in one latency window. allSettled
 * is intentional: each port has distinct domain-error mapping, so fail-fast
 * would lose the reason while providing no useful cancellation of the other
 * calls. Split out of `resolveLangyTurnBaseDependencies`.
 */
async function fetchLangyTurnBaseDependencies({
  deps,
  projectId,
  userId,
  session,
  requestedConversationId,
  modelOverride,
}: LangyTurnBaseDependenciesArgs) {
  return tracer.withActiveSpan(
    "langy.chat.phase2_dependencies",
    {
      attributes: {
        "tenant.id": projectId,
        "langy.phase": "dependencies",
      },
    },
    async () =>
      Promise.allSettled([
        deps.conversations.ensureConversation({
          projectId,
          userId,
          conversationId: requestedConversationId,
        }),
        // The resolved default is forwarded to the worker (ADR-065), so with
        // no override the lookup is load-bearing, not just a gate. An
        // override wins outright and skips it.
        modelOverride
          ? Promise.resolve(null)
          : deps.resolveModel({ projectId }),
        deps.credentials.getOrProvision({
          projectId,
          session,
          mintSessionKey: false,
        }),
        deps.credentials.getEgressAllowlist({ projectId }),
        // ADR-061 mirror tier — resolved in the same window as the egress list.
        deps.credentials.resolveMirrorTier({ projectId }),
      ]),
  );
}

type LangyTurnBaseDependenciesTuple = Awaited<
  ReturnType<typeof fetchLangyTurnBaseDependencies>
>;

/**
 * Validate the settled results and assemble the resolved dependency bundle.
 * Split out of `resolveLangyTurnBaseDependencies`.
 */
function assembleLangyTurnBaseDependencies({
  conversationResult,
  modelResult,
  credentialsResult,
  egressResult,
  mirrorTierResult,
  projectId,
}: {
  conversationResult: LangyTurnBaseDependenciesTuple[0];
  modelResult: LangyTurnBaseDependenciesTuple[1];
  credentialsResult: LangyTurnBaseDependenciesTuple[2];
  egressResult: LangyTurnBaseDependenciesTuple[3];
  mirrorTierResult: LangyTurnBaseDependenciesTuple[4];
  projectId: string;
}) {
  if (conversationResult.status === "rejected") {
    throw conversationResult.reason;
  }
  if (modelResult.status === "rejected") {
    logger.warn(
      { error: modelResult.reason, projectId },
      "getVercelAIModel failed",
    );
    throw new LangyModelNotConfiguredError();
  }
  if (credentialsResult.status === "rejected") {
    throw credentialsResult.reason;
  }
  if (egressResult.status === "rejected") {
    logger.error(
      { error: egressResult.reason, projectId },
      "failed to resolve Langy egress allow-list",
    );
    throw new LangyEgressMisconfiguredError();
  }

  const credentials = credentialsResult.value;
  if (egressResult.value) {
    credentials.egressAllowlist = egressResult.value;
  }
  // A mirror-tier resolver failure must never fail a turn: fall back to skip
  // (mirror nothing) rather than throw. The mirror is LangWatch's own
  // observability of Langy, never on the customer's critical path.
  if (mirrorTierResult.status === "fulfilled") {
    credentials.mirrorTier = mirrorTierResult.value;
  } else {
    logger.warn(
      { error: mirrorTierResult.reason, projectId },
      "failed to resolve Langy mirror tier — mirroring nothing for this turn",
    );
    credentials.mirrorTier = "skip";
  }
  return {
    speculativeConversation: conversationResult.value,
    credentials,
    // The project's configured Langy model, forwarded to the worker so the
    // turn runs on it rather than the worker's own built-in default. Null
    // exactly when an override made the lookup unnecessary.
    resolvedModel: modelResult.value?.modelId ?? null,
  };
}

/**
 * Resolves every project-scoped dependency in one latency window. allSettled is
 * intentional: each port has distinct domain-error mapping, so fail-fast would
 * lose the reason while providing no useful cancellation of the other calls.
 */
export async function resolveLangyTurnBaseDependencies(
  args: LangyTurnBaseDependenciesArgs,
) {
  const [
    conversationResult,
    modelResult,
    credentialsResult,
    egressResult,
    mirrorTierResult,
  ] = await fetchLangyTurnBaseDependencies(args);

  return assembleLangyTurnBaseDependencies({
    conversationResult,
    modelResult,
    credentialsResult,
    egressResult,
    mirrorTierResult,
    projectId: args.projectId,
  });
}
