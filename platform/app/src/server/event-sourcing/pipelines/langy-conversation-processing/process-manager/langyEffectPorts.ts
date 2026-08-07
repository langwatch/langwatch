import { createLogger } from "@langwatch/observability";
import { LangyDispatchRejectedError } from "~/server/app-layer/langy/errors";
import { serializeLangyTurnError } from "~/server/app-layer/langy/execution/langy-turn-errors";
import type { LangyTitleGenerator } from "~/server/app-layer/langy/langy-title-generation.service";
import { LangyTurnDispatchRetry } from "~/server/app-layer/langy/langy-turn-retry.error";
import {
  AGENT_DISPATCH_TIMEOUT_MS,
  type LangyWorkerPort,
} from "~/server/app-layer/langy/langyWorker";
import type {
  LangyTurnHandoff,
  LangyTurnHandoffStore,
} from "~/server/app-layer/langy/streaming/langyTurnHandoff";
import type { LangyFailTurnCommandPort } from "~/server/app-layer/langy/subscribers/agent-turn-liveness.subscriber";

import type {
  LangyGenerateTitleIntent,
  LangyWorkerDispatchIntent,
} from "./langyConversationProcess.types";

const logger = createLogger("langwatch:langy:process-effects");

/**
 * Slack the outbox lease MUST keep on top of the slowest in-flight effect: a
 * handoff read plus the transactional commit that retires the message. The
 * lease has to OUTLIVE a healthy long-running dispatch — if it expires while
 * `dispatchTurn` is still awaiting the manager, a second dispatcher instance
 * re-leases the row and re-delivers the same intent concurrently, and the
 * original handler's `markDispatched` is then fenced out by the superseding
 * lease token. A persistently slow-but-live effect would redeliver forever
 * and never be retired. Keep this comfortably above the network jitter around
 * a commit.
 */
export const LANGY_OUTBOX_LEASE_MARGIN_MS = 30_000;

/**
 * Exclusive-lease window for the Langy process outbox. Derived from the
 * worker-dispatch budget so the relationship can never silently drift: the
 * lease always outlasts the slowest accepted dispatch. The generic 30s default
 * is unsafe here because a single dispatch may legitimately run up to
 * {@link AGENT_DISPATCH_TIMEOUT_MS}.
 */
export const LANGY_OUTBOX_LEASE_DURATION_MS =
  AGENT_DISPATCH_TIMEOUT_MS + LANGY_OUTBOX_LEASE_MARGIN_MS;

/**
 * Typed effect ports the Langy process outbox dispatches into. There is
 * deliberately NO fail-turn port: the heartbeat-aware liveness subscriber
 * owns observed worker health and terminal recovery.
 *
 * Handlers must stay idempotent on the intent identity — outbox delivery is
 * at-least-once.
 */
export interface LangyWorkerDispatchPort {
  /** Idempotent per turnId — mirrors Go ClaimTurn semantics. */
  dispatchTurn(
    params: LangyWorkerDispatchIntent & { projectId: string },
  ): Promise<void>;
}

export interface LangyTitleGenerationPort {
  /** Requests the one-shot auto-title generation for a finalized turn. */
  generateTitle(
    params: LangyGenerateTitleIntent & { projectId: string },
  ): Promise<void>;
}

export interface LangyEffectPorts {
  workerDispatch: LangyWorkerDispatchPort;
  titleGeneration: LangyTitleGenerationPort;
}

export interface CreateLangyEffectPortsOptions {
  handoffStore: Pick<LangyTurnHandoffStore, "read" | "stash">;
  worker: Pick<LangyWorkerPort, "dispatch">;
  mintSessionKey: (args: {
    userId: string;
    projectId: string;
    organizationId: string;
  }) => Promise<{ token: string; apiKeyId: string }>;
  revokeSessionKey: (args: {
    apiKeyId: string;
    projectId: string;
  }) => Promise<void>;
  /** Terminalizes a permanently rejected turn — same port liveness uses. */
  failTurn: LangyFailTurnCommandPort;
  /** Client-visible error frame for the stream tail. Best-effort. */
  markError: (params: {
    conversationId: string;
    turnId: string;
    error: ReturnType<typeof serializeLangyTurnError>;
  }) => Promise<void>;
  titleGenerator: LangyTitleGenerator;
  saveTitle: (params: {
    projectId: string;
    conversationId: string;
    turnId: string;
    title: string;
    model: string;
  }) => Promise<void>;
}

function assertHandoffIdentity(params: {
  handoff: LangyTurnHandoff;
  projectId: string;
  conversationId: string;
  turnId: string;
}): void {
  const { handoff, projectId, conversationId, turnId } = params;
  if (
    handoff.projectId !== projectId ||
    handoff.conversationId !== conversationId ||
    handoff.turnId !== turnId
  ) {
    throw new Error(
      `Langy turn handoff identity mismatch for ${projectId}/${conversationId}/${turnId}`,
    );
  }
}

/**
 * Peek rather than consume: an outbox failure must be able to retry the same
 * short-lived handoff until its normal TTL expires. Missing/expired is not
 * recoverable by retrying this intent — the heartbeat-aware liveness
 * subscriber owns terminalizing an abandoned turn.
 */
async function loadDispatchHandoff(params: {
  handoffStore: Pick<LangyTurnHandoffStore, "read" | "stash">;
  projectId: string;
  conversationId: string;
  turnId: string;
}): Promise<LangyTurnHandoff | undefined> {
  const { handoffStore, projectId, conversationId, turnId } = params;
  const handoff = await handoffStore.read({ conversationId, turnId });
  if (!handoff) {
    logger.warn(
      { projectId, conversationId, turnId },
      "No Langy turn handoff found; leaving recovery to liveness",
    );
    return undefined;
  }
  assertHandoffIdentity({ handoff, projectId, conversationId, turnId });
  return handoff;
}

function resolveDispatchIntent(
  handoff: LangyTurnHandoff,
): "create" | "revive" | "continue" {
  if (handoff.resumeToken) return "revive";
  return handoff.credentials.langwatchApiKey ? "create" : "continue";
}

function buildWorkerDispatchParams(params: {
  intent: "create" | "revive" | "continue";
  projectId: string;
  conversationId: string;
  turnId: string;
  candidate: LangyTurnHandoff;
}): Parameters<LangyWorkerPort["dispatch"]>[0] {
  const { intent, projectId, conversationId, turnId, candidate } = params;
  return {
    intent,
    projectId,
    conversationId,
    turnId,
    userId: candidate.actorUserId,
    runToken: candidate.runToken,
    prompt: candidate.prompt,
    system: candidate.system,
    // The seed rides the re-drive too: this is exactly the path where a
    // probe-hit turn lands on a worker that has since died, and the fresh
    // session it spawns must still get the conversation so far.
    ...(candidate.historySeed ? { historySeed: candidate.historySeed } : {}),
    credentials: candidate.credentials,
    ...(candidate.modelOverride
      ? { modelOverride: candidate.modelOverride }
      : {}),
    ...(candidate.resumeToken ? { resumeToken: candidate.resumeToken } : {}),
  };
}

/**
 * A probe hit is only a latency hint: the worker may die before this durable
 * effect reaches it. Recover the key from the actor identity in Postgres,
 * persist it into the retryable handoff, then redrive once. Subsequent
 * outbox/liveness deliveries reuse the same key rather than minting on every
 * retry.
 */
async function recoverDispatchCredentials(params: {
  deps: CreateLangyEffectPortsOptions;
  dispatchHandoff: LangyTurnHandoff;
  projectId: string;
  conversationId: string;
  turnId: string;
}): Promise<LangyTurnHandoff> {
  const { deps, dispatchHandoff, projectId, conversationId, turnId } = params;
  const minted = await deps.mintSessionKey({
    userId: dispatchHandoff.actorUserId,
    projectId,
    organizationId: dispatchHandoff.credentials.organizationId,
  });
  const recovered: LangyTurnHandoff = {
    ...dispatchHandoff,
    credentials: {
      ...dispatchHandoff.credentials,
      langwatchApiKey: minted.token,
      langwatchApiKeyId: minted.apiKeyId,
    },
  };
  try {
    await deps.handoffStore.stash(recovered);
  } catch (error) {
    await deps
      .revokeSessionKey({ apiKeyId: minted.apiKeyId, projectId })
      .catch((revokeError) => {
        logger.warn(
          { revokeError, projectId, conversationId, turnId },
          "failed to revoke unstashed Langy recovery key",
        );
      });
    throw error;
  }
  return recovered;
}

/**
 * A permanent rejection poisons the outbox if it is allowed to retry: the
 * agent will answer the same 4xx forever, every ~minute, and every later
 * turn queues behind it. Terminalize instead — durably fail the turn (the
 * same path liveness uses for an abandoned one) and consume the intent.
 */
async function terminalizeRejectedDispatch(params: {
  deps: CreateLangyEffectPortsOptions;
  projectId: string;
  conversationId: string;
  turnId: string;
}): Promise<void> {
  const { deps, projectId, conversationId, turnId } = params;
  logger.warn(
    { projectId, conversationId, turnId },
    "langy dispatch permanently rejected; terminalizing the turn",
  );
  const error = serializeLangyTurnError(new LangyDispatchRejectedError());
  await deps
    .markError({ conversationId, turnId, error })
    .catch(() => undefined);
  await deps.failTurn.failTurn({ projectId, conversationId, turnId, error });
}

async function dispatchLangyTurn(
  deps: CreateLangyEffectPortsOptions,
  {
    projectId,
    conversationId,
    turnId,
  }: LangyWorkerDispatchIntent & { projectId: string },
): Promise<void> {
  const handoff = await loadDispatchHandoff({
    handoffStore: deps.handoffStore,
    projectId,
    conversationId,
    turnId,
  });
  if (!handoff) return;

  let dispatchHandoff = handoff;
  let intent = resolveDispatchIntent(dispatchHandoff);
  let outcome = await deps.worker.dispatch(
    buildWorkerDispatchParams({
      intent,
      projectId,
      conversationId,
      turnId,
      candidate: dispatchHandoff,
    }),
  );

  if (
    outcome === "credentialsRequired" &&
    !dispatchHandoff.credentials.langwatchApiKey
  ) {
    dispatchHandoff = await recoverDispatchCredentials({
      deps,
      dispatchHandoff,
      projectId,
      conversationId,
      turnId,
    });
    intent = resolveDispatchIntent(dispatchHandoff);
    outcome = await deps.worker.dispatch(
      buildWorkerDispatchParams({
        intent,
        projectId,
        conversationId,
        turnId,
        candidate: dispatchHandoff,
      }),
    );
  }

  if (outcome === "accepted") return;

  if (outcome === "rejected") {
    await terminalizeRejectedDispatch({
      deps,
      projectId,
      conversationId,
      turnId,
    });
    return;
  }

  throw new LangyTurnDispatchRetry(
    `langy dispatch not accepted (${outcome}) for turn ${turnId}`,
  );
}

async function generateLangyTitle(
  deps: CreateLangyEffectPortsOptions,
  {
    projectId,
    conversationId,
    turnId,
  }: LangyGenerateTitleIntent & {
    projectId: string;
  },
): Promise<void> {
  const generated = await deps.titleGenerator({ projectId, conversationId });
  if (!generated) return;
  await deps.saveTitle({
    projectId,
    conversationId,
    turnId,
    title: generated.title,
    model: generated.model,
  });
}

/**
 * Live effect adapters for process-outbox delivery. The dispatcher owns the
 * consumer span and retry attempt; the worker and title generator own their
 * downstream spans.
 */
export function createLangyEffectPorts(
  deps: CreateLangyEffectPortsOptions,
): LangyEffectPorts {
  return {
    workerDispatch: {
      dispatchTurn: (params) => dispatchLangyTurn(deps, params),
    },
    titleGeneration: {
      generateTitle: (params) => generateLangyTitle(deps, params),
    },
  };
}

export interface StubLangyEffectCalls {
  dispatchedTurns: Array<LangyWorkerDispatchIntent & { projectId: string }>;
  titleRequests: Array<LangyGenerateTitleIntent & { projectId: string }>;
}

/** Recording stubs for unit tests — no real effects. */
export function createStubLangyEffectPorts(): {
  ports: LangyEffectPorts;
  calls: StubLangyEffectCalls;
} {
  const calls: StubLangyEffectCalls = {
    dispatchedTurns: [],
    titleRequests: [],
  };
  return {
    calls,
    ports: {
      workerDispatch: {
        async dispatchTurn(params) {
          calls.dispatchedTurns.push(params);
        },
      },
      titleGeneration: {
        async generateTitle(params) {
          calls.titleRequests.push(params);
        },
      },
    },
  };
}
