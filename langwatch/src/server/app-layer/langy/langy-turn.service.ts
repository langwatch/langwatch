/**
 * LangyTurnService — durable turn admission and dispatch orchestration, lifted out of
 * `routes/langy.ts` (ADR-046 / LANGY_REWORK_PLAN.md S2 increment C).
 *
 * The Hono route now keeps only Phase 1 (session auth, demo gate, rate limit,
 * body validation, project-permission gate) and maps DomainErrors to HTTP. This
 * service owns everything after the gate: resolve the conversation, model,
 * credentials and egress list; probe-then-mint the per-turn session key; reserve
 * the PR permit; guard against a concurrent turn; stash the
 * live-access grant + the worker handoff; and atomically accept the turn. Once
 * accepted, a direct dispatch starts the worker immediately while the process
 * outbox remains the at-least-once recovery path.
 *
 * The ORDER here is load-bearing: gate precedence, the message-before-turn
 * invariant, permit release on early exit, and mint-only-on-a-probe-miss are
 * deliberate. Independent reads and transient Redis writes overlap so they do
 * not add avoidable serial latency to the command path.
 *
 * Errors are thrown as DomainErrors (each carries its httpStatus); the route
 * renders them. Infrastructure failures throw and surface generically.
 */

import { createHash } from "node:crypto";
import type { LangyMessagePart } from "@langwatch/langy";
import { LANGY_CONVERSATION_STATUS } from "@langwatch/langy";
import { createLogger } from "@langwatch/observability";
import { trace } from "@opentelemetry/api";
import type { LangyCredentialService } from "~/server/app-layer/langy/LangyCredentialService";
import { LangySessionKeyScopeError } from "~/server/app-layer/langy/langyApiKey";
import {
  extractLangyConversationMemory,
  LANGY_REFERENT_POLICY,
  renderLangyConversationMemory,
} from "~/server/app-layer/langy/langyConversationMemory";
import { LANGY_TURN_OVERRIDE_FALLBACK } from "~/server/app-layer/langy/langyPromptRegistry";
import type { LangyTurnContext } from "~/server/app-layer/langy/langyTurnContext.schema";
import { renderLangyTurnContext } from "~/server/app-layer/langy/langyTurnContext.schema";
import type { LangyWorkerPort } from "~/server/app-layer/langy/langyWorker";
import type {
  LangyMessageRepository,
  LangyMessageRow,
} from "~/server/app-layer/langy/repositories/langy-message.repository";
import { mintRunToken } from "~/server/app-layer/langy/streaming/langyFrameAuth";
import type { LangyTokenBuffer } from "~/server/app-layer/langy/streaming/langyTokenBuffer";
import type { LangyTurnAccessStore } from "~/server/app-layer/langy/streaming/langyTurnAccess";
import type { LangyTurnHandoffStore } from "~/server/app-layer/langy/streaming/langyTurnHandoff";
import type { Session } from "~/server/auth";
import { getLangyTurnsCounter } from "~/server/metrics";
import {
  LangyAgentUnavailableError,
  LangyConversationNotOwnedError,
  LangyEmptyMessageError,
  LangyIdempotencyMismatchError,
  LangyInsufficientScopeError,
  LangyModelNotAllowedError,
  LangyTurnInProgressError,
  LangyTurnNotStoppableError,
  langyEngineCanRunModel,
} from "./errors";
import type { LangyConversationService } from "./langy-conversation.service";
import { buildFinalAssistantParts } from "./langy-final-parts";
import { extractTextFromParts } from "./langy-message.service";
import { LangyTurnAttempt } from "./langy-turn-attempt";
import { resolveLangyTurnBaseDependencies } from "./langy-turn-base-dependencies";
import type { LangyTurnAdmissionRepository } from "./repositories/langy-turn-admission.repository";

const logger = createLogger("langwatch:langy:turn-service");

/**
 * The Langy system-block override — Langy's role, not a code assistant. The text
 * lives in `langyPromptRegistry` as the in-repo source of truth + registry
 * fallback (ADR-050), so the seed script and the registry loader share the exact
 * same bytes. Aliased here to keep the composition below readable.
 */
const LANGY_OVERRIDE = LANGY_TURN_OVERRIDE_FALLBACK;

/**
 * Turn identity binds the client's idempotency key to WHO sent it and WHAT was
 * sent. Three properties fall out structurally:
 *
 * - a transport retry (same user, same key, same content) derives the same id
 *   and collapses onto the admitted turn;
 * - the same key with DIFFERENT content derives a different id, which the
 *   admission receipt exposes as a mismatch instead of silently replaying the
 *   original send;
 * - two users can never mint the same turn id, whatever keys they choose.
 *
 * The hash input uses the zod-parsed messages verbatim: a retry is the same
 * client re-serializing the same payload, so byte-stable JSON is a fair
 * equality. Semantic reordering counts as different content — by design.
 */
export function langyTurnIdentity(input: {
  userId: string;
  idempotencyKey: string;
  messages: unknown;
  modelOverride?: string;
}): { turnId: string; messageId: string } {
  const digest = createHash("sha256")
    .update(input.userId)
    .update("\u0000")
    .update(input.idempotencyKey)
    .update("\u0000")
    .update(JSON.stringify(input.messages))
    .update("\u0000")
    .update(input.modelOverride ?? "")
    .digest("hex")
    .slice(0, 32);
  return { turnId: `langyturn_${digest}`, messageId: `langymsg_${digest}` };
}

export interface LangyChatMessageInput {
  role: "user" | "assistant" | "system";
  parts: LangyMessagePart[];
}

export interface StartConversationTurnInput {
  projectId: string;
  /** Stable identity for one logical send, reused by every transport retry. */
  idempotencyKey: string;
  session: Session;
  /** The client-supplied conversation id, or null to mint a fresh one. */
  requestedConversationId: string | null;
  messages: LangyChatMessageInput[];
  modelOverride?: string;
  /** A regenerate re-drives the last turn against the message already on record. */
  isRetry: boolean;
  /** Composer context chips (page context + skills), rendered into the system block. */
  turnContext: LangyTurnContext;
}

export interface LangyTurnServiceDeps {
  conversations: LangyConversationService;
  credentials: LangyCredentialService;
  /** Resolve the project's default model; rejects when none is configured. */
  resolveModel: (args: { projectId: string }) => Promise<unknown>;
  /** Direct fast-path dispatch plus durable process-effect recovery. `cancel`
   * is the best-effort worker abort behind a user Stop (ADR-058). */
  worker: Pick<LangyWorkerPort, "probe" | "dispatch" | "cancel"> | null;
  /**
   * The durable token buffer (ADR-044). A user Stop reads its `delta` tail to
   * reconstruct the partial answer as the source of truth, then `markEnd`s it so
   * every attached browser's live stream settles. Null where there is no Redis.
   */
  tokenBuffer: Pick<LangyTokenBuffer, "readTail" | "markEnd"> | null;
  reservePermit: (args: { userId: string }) => Promise<{
    reserved: boolean;
    allowed: boolean;
    resetAt: number;
  }>;
  releasePermit: (args: { userId: string }) => Promise<void>;
  perDayPrCap: number;
  /** Mint the per-turn session key (prisma pre-bound at composition). */
  mintSessionKey: (args: {
    session: Session;
    projectId: string;
    organizationId: string;
  }) => Promise<{ token: string; apiKeyId: string }>;
  revokeSessionKey: (args: {
    apiKeyId: string;
    projectId: string;
  }) => Promise<void>;
  admission: LangyTurnAdmissionRepository;
  accessStore: LangyTurnAccessStore | null;
  handoffStore: LangyTurnHandoffStore | null;
  /**
   * The conversation's durable messages, read so a follow-up turn can be told
   * what earlier turns of the SAME conversation created (see
   * `langyConversationMemory` for why the agent cannot be relied on to remember
   * it). Null where there is no projection, and a failed read is never fatal —
   * a turn without its memory is degraded, not broken.
   */
  messages: Pick<LangyMessageRepository, "findAllByConversation"> | null;
}

/**
 * Reconstruct the partial answer text from the durable buffer's `delta` entries
 * (ADR-058). The buffer batches deltas and flushes its tail on `markEnd`, so this
 * is the durable truth up to the last flush; a handful of un-flushed words still
 * in the worker's memory are not the control plane's to see, and "the partial is
 * preserved" does not require them. Non-`delta` entries (status, reasoning, tool,
 * plan, terminals) are not answer text and are skipped.
 */
async function reconstructPartialAnswer(
  tokenBuffer: Pick<LangyTokenBuffer, "readTail">,
  { conversationId, turnId }: { conversationId: string; turnId: string },
): Promise<string> {
  const { reads } = await tokenBuffer.readTail({ conversationId, turnId });
  let text = "";
  for (const { entry } of reads) {
    if (entry.type === "delta") text += entry.text;
  }
  return text;
}

export class LangyTurnService {
  private constructor(private readonly deps: LangyTurnServiceDeps) {}

  static create(deps: LangyTurnServiceDeps): LangyTurnService {
    return new LangyTurnService(deps);
  }

  /**
   * Stop an in-flight turn FOR REAL (ADR-058). The browser's `useChat` stop only
   * aborts its own subscription; this ends the turn on the durable record — the
   * confirmation — and only then, best-effort, asks the worker to abandon the
   * generation. The order matters: the truthful stop must not depend on a live,
   * responsive worker.
   *
   *   1. reconstruct the partial answer from the durable buffer's `delta` tail
   *      (the source of truth, refresh-safe — never whatever the browser painted);
   *   2. record `agent_responded { outcome: "stopped" }` on the shared
   *      turn-terminal slot, so a stop racing a natural finish collapses to
   *      exactly one terminal and the partial is preserved as the assistant
   *      message that anchors a later Continue;
   *   3. `markEnd` the buffer so every attached browser's live stream settles out
   *      of its spinner;
   *   4. best-effort `worker.cancel` to stop the token burn.
   *
   * Idempotent by construction: if the turn already reached a terminal, the
   * terminal command collapses at the store (first-writer-wins) and steps 3–4 are
   * harmless no-ops — a Stop clicked a beat too late leaves the finished answer
   * intact.
   *
   * The control gate is stricter than watching a turn: only the turn's actor or
   * the conversation owner may stop it, never a shared viewer. A caller who may
   * not control it gets a handled `LangyConversationNotOwnedError` (403). An
   * owner who is not the actor must additionally name the turn the record has in
   * flight — see the guard below for why an unproven id may not write a
   * terminal (`LangyTurnNotStoppableError`, 409).
   */
  async stopTurn({
    projectId,
    conversationId,
    turnId,
    userId,
  }: {
    projectId: string;
    conversationId: string;
    turnId: string;
    userId: string;
  }): Promise<void> {
    const { tokenBuffer, worker, conversations, accessStore } = this.deps;

    const isActor = accessStore
      ? await accessStore.isTurnActor({
          projectId,
          conversationId,
          turnId,
          userId,
        })
      : false;
    if (!isActor) {
      const conv = await conversations.findByIdVisible({
        id: conversationId,
        projectId,
        userId,
      });
      if (!conv || !conv.isOwn) {
        throw new LangyConversationNotOwnedError(conversationId);
      }
      // The turn id is client input, and a stop is the one place it buys a
      // DURABLE terminal — an assistant message and a conversation returned to
      // idle. The turn's own actor already proved the turn exists under this
      // conversation (the live-access grant is written before the turn is
      // accepted, so it cannot lag). An owner who is NOT the actor has proved
      // nothing about the id, so it must be the turn the record has in flight;
      // otherwise a bogus id would terminate — or fabricate an answer on — a
      // turn that is not running. The sibling `agent_response_failed` fold has
      // carried exactly this guard all along.
      if (conv.currentTurnId !== turnId) {
        throw new LangyTurnNotStoppableError(turnId);
      }
    }

    const partialText = tokenBuffer
      ? await reconstructPartialAnswer(tokenBuffer, { conversationId, turnId })
      : "";

    // The durable terminal — this write IS the "real backend confirmation".
    await conversations.finalizeTurn({
      projectId,
      conversationId,
      turnId,
      parts: buildFinalAssistantParts({ text: partialText }),
      outcome: "stopped",
    });

    // End the stream and chase the token burn. Both are best-effort and
    // independent of the durable terminal above; neither may throw back into the
    // mutation, and a wedged worker must not delay the stop the user already got.
    await Promise.allSettled([
      tokenBuffer?.markEnd({ conversationId, turnId }) ?? Promise.resolve(),
      worker?.cancel({ conversationId, turnId, projectId }) ??
        Promise.resolve(),
    ]);
  }

  /**
   * Start (or continue) an agent turn on a conversation. Returns the ids the
   * client subscribes with. A relocation of the route's Phases 2–N — see the
   * file header for why the ordering is exact.
   */
  async startConversationTurn(
    input: StartConversationTurnInput,
  ): Promise<{ conversationId: string; turnId: string }> {
    const {
      projectId,
      idempotencyKey,
      session,
      requestedConversationId,
      messages,
      modelOverride,
      isRetry,
      turnContext,
    } = input;
    const userId = session.user.id;
    const { worker, accessStore, handoffStore } = this.deps;

    // Env / infra preconditions the route used to 503 on.
    if (!worker) {
      throw new LangyAgentUnavailableError("Agent not configured");
    }
    if (!accessStore || !handoffStore) {
      throw new LangyAgentUnavailableError();
    }

    // Reject content-free sends BEFORE anything durable happens: an admitted
    // empty turn is one the agent can only 422, and a permanently rejected
    // dispatch used to poison the process outbox with endless retries.
    const lastUserMessage = messages[messages.length - 1];
    const userText = extractTextFromParts(lastUserMessage?.parts);
    if (!userText.trim()) {
      // Self-report like every other rejection branch — without this the
      // empty-send path is invisible in the turn-outcome metric.
      getLangyTurnsCounter("rejected").inc();
      throw new LangyEmptyMessageError();
    }

    const identity = langyTurnIdentity({
      userId,
      idempotencyKey,
      messages,
      ...(modelOverride ? { modelOverride } : {}),
    });

    const conversationService = this.deps.conversations;
    const credentialService = this.deps.credentials;

    const { speculativeConversation, credentials } =
      await resolveLangyTurnBaseDependencies({
        deps: this.deps,
        projectId,
        userId,
        session,
        requestedConversationId,
        ...(modelOverride ? { modelOverride } : {}),
      });

    // The receipt and active-turn row are the authoritative admission boundary.
    // Stable ids make every sibling write and every later request replay collapse
    // to the same logical send.
    const admission = await this.deps.admission.claim({
      projectId,
      userId,
      idempotencyKey,
      conversationId: speculativeConversation.id,
      turnId: identity.turnId,
    });
    if (admission.kind === "mismatch") {
      getLangyTurnsCounter("mismatch").inc();
      throw new LangyIdempotencyMismatchError();
    }
    if (admission.kind === "replay") {
      getLangyTurnsCounter("replay").inc();
      return {
        conversationId: admission.conversationId,
        turnId: admission.turnId,
      };
    }
    if (admission.kind === "pending") {
      getLangyTurnsCounter("rejected").inc();
      throw new LangyAgentUnavailableError(
        "This turn is already being prepared. Please retry shortly.",
      );
    }
    if (admission.kind === "busy") {
      getLangyTurnsCounter("busy").inc();
      throw new LangyTurnInProgressError();
    }

    // Enrich the ACTIVE span (the tRPC procedure span on the fast path, the
    // outbox consumer span on recovery) rather than opening a new one: the ids
    // are what make a turn findable in the trace store, and one enriched span
    // beats another layer of nesting on an already-deep trace.
    trace.getActiveSpan()?.setAttributes({
      "tenant.id": projectId,
      "langy.conversation.id": admission.conversationId,
      "langy.turn.id": admission.turnId,
      "user.id": userId,
    });

    const conversation = {
      id: admission.conversationId,
      // An expired retry receipt may replace the speculative fresh id with the
      // original one. That original was also a new conversation.
      isNew:
        speculativeConversation.isNew ||
        speculativeConversation.id !== admission.conversationId,
    };
    const turnId = admission.turnId;
    const attempt = new LangyTurnAttempt(
      {
        projectId,
        userId,
        idempotencyKey,
        conversationId: conversation.id,
        turnId,
        claimToken: admission.claimToken,
      },
      this.deps,
    );

    try {
      const questionParts = lastUserMessage?.parts ?? [];
      const title =
        extractTextFromParts(messages[0]?.parts).slice(0, 80) || null;

      // The per-conversation frame-signing key is created from resolved
      // conversation state, never from a caller-supplied "new" flag.
      const mintedRunToken = conversation.isNew ? mintRunToken() : null;

      const probeWorker = () =>
        worker.probe({
          projectId,
          actorUserId: userId,
          conversationId: conversation.id,
          ...(modelOverride ? { model: modelOverride } : {}),
          hasGithubAuth: !!credentials.githubToken,
          ...(credentials.githubRepoScopeKey
            ? { githubRepoScopeKey: credentials.githubRepoScopeKey }
            : {}),
          ...(credentials.egressAllowlist
            ? { egressAllowlist: credentials.egressAllowlist }
            : {}),
          // ADR-061 mirror tier is part of the worker signature, so a tier
          // change must be a probe MISS (re-warm) rather than a stale mirror.
          ...(credentials.mirrorTier
            ? { mirrorTier: credentials.mirrorTier }
            : {}),
        });

      // With no GitHub capability, the signature is already final; overlap the
      // cheap probe with the conversation-scoped reads.
      const earlyWorkerProbe = credentials.githubToken ? null : probeWorker();

      const [
        currentResult,
        handoffResult,
        runTokenResult,
        modelsAllowedResult,
        memoryResult,
      ] = await Promise.allSettled([
        conversationService.findByIdVisible({
          id: conversation.id,
          projectId,
          userId,
        }),
        conversationService.getPendingHandoff({
          projectId,
          conversationId: conversation.id,
        }),
        mintedRunToken
          ? Promise.resolve(mintedRunToken)
          : conversationService.getRunToken({
              projectId,
              conversationId: conversation.id,
            }),
        modelOverride
          ? credentialService.getModelsAllowed({
              projectId,
              organizationId: credentials.organizationId,
            })
          : Promise.resolve(null),
        // The conversation's own history. Overlapped with the reads above so
        // remembering costs no extra latency window. A fresh conversation has
        // nothing to read, so it does not pay for the round trip either. The
        // OWNERSHIP gate is already behind us: `ensureConversation` accepted
        // this id only because this user owns it.
        conversation.isNew || !this.deps.messages
          ? Promise.resolve<LangyMessageRow[]>([])
          : this.deps.messages.findAllByConversation({
              conversationId: conversation.id,
              projectId,
            }),
      ]);

      const runToken =
        runTokenResult.status === "fulfilled"
          ? (runTokenResult.value ?? "")
          : "";

      if (modelOverride) {
        if (modelsAllowedResult.status === "rejected") {
          throw modelsAllowedResult.reason;
        }
        const modelsAllowed = modelsAllowedResult.value;
        if (modelsAllowed && !modelsAllowed.includes(modelOverride)) {
          logger.warn(
            { projectId, modelOverride, allowedCount: modelsAllowed.length },
            "modelOverride not in VK allowlist — rejecting",
          );
          throw new LangyModelNotAllowedError(modelOverride);
        }
        // Configured is not the same as runnable: the engine only speaks the
        // OpenAI dialect today, so a configured Anthropic (or other) model
        // would reach the worker with no lane and die as an opaque failure.
        // Refuse it here with the engine-reason card instead.
        if (!langyEngineCanRunModel(modelOverride)) {
          logger.warn(
            { projectId, modelOverride },
            "modelOverride provider not wired into the engine — rejecting",
          );
          throw new LangyModelNotAllowedError(modelOverride, {
            reason: "engine",
          });
        }
      }

      // Projection read is only a rollout/back-compat hint. The Postgres
      // admission claim above is the concurrency authority.
      const current =
        currentResult.status === "fulfilled" ? currentResult.value : null;
      if (currentResult.status === "rejected") {
        logger.warn(
          { error: currentResult.reason, conversationId: conversation.id },
          "busy projection read failed after authoritative admission",
        );
      }
      if (current?.status === LANGY_CONVERSATION_STATUS.RUNNING) {
        throw new LangyTurnInProgressError();
      }

      const permit = credentials.githubToken
        ? await this.deps.reservePermit({ userId })
        : { reserved: false, allowed: true, resetAt: 0 };
      attempt.retainPermit(permit.reserved);
      const capReachedNote = !permit.allowed
        ? [
            "",
            "USER PR CAP REACHED — the user has already opened the per-day maximum",
            "of",
            String(this.deps.perDayPrCap),
            "GitHub pull requests via Langy today.",
            "If the user asks you to open a PR, refuse politely, say the daily cap",
            "is reached, and that it resets at",
            new Date(permit.resetAt).toISOString(),
            "UTC.",
            "Do not call any tool that opens a PR.",
          ].join(" ")
        : "";
      if (!permit.allowed) {
        delete (credentials as { githubToken?: string }).githubToken;
        delete (credentials as { githubLogin?: string }).githubLogin;
      }

      const workerIsLive = await (earlyWorkerProbe ?? probeWorker());

      if (!workerIsLive) {
        const minted = await this.deps.mintSessionKey({
          session,
          projectId,
          organizationId: credentials.organizationId,
        });
        credentials.langwatchApiKey = minted.token;
        credentials.langwatchApiKeyId = minted.apiKeyId;
        attempt.retainSessionKey(minted.apiKeyId);
      }

      // A turn that cannot read its own history still runs — degraded, and said
      // so once in the logs, rather than 500ing over a memory aid.
      if (memoryResult.status === "rejected") {
        logger.warn(
          { error: memoryResult.reason, conversationId: conversation.id },
          "failed to read langy conversation memory — the turn runs without it",
        );
      }
      const conversationMemory = renderLangyConversationMemory(
        extractLangyConversationMemory({
          messages:
            memoryResult.status === "fulfilled" ? memoryResult.value : [],
        }),
      );

      // ORDER IS THE POINT. The two DATA blocks describe what "it" could mean —
      // this conversation's own history, then the user's screen — and the
      // referent policy comes last so "described above" names both of them.
      const system = [
        LANGY_OVERRIDE,
        conversationMemory,
        renderLangyTurnContext(turnContext),
        LANGY_REFERENT_POLICY,
        capReachedNote,
      ]
        .filter((block): block is string => !!block && block.trim().length > 0)
        .join("\n\n");

      if (handoffResult.status === "rejected") {
        logger.warn(
          { error: handoffResult.reason, conversationId: conversation.id },
          "failed to read pending langy handoff — cold-starting",
        );
      }
      const pendingHandoff =
        handoffResult.status === "fulfilled" ? handoffResult.value : null;

      // These Redis writes must precede the durable acceptance because its
      // process intent may dispatch immediately. They are independent, so only
      // one network-latency window enters the critical path.
      try {
        await Promise.all([
          accessStore.grant({
            projectId,
            conversationId: conversation.id,
            turnId,
            userId,
          }),
          handoffStore.stash({
            projectId,
            conversationId: conversation.id,
            turnId,
            actorUserId: userId,
            prompt: userText,
            system,
            ...(modelOverride ? { modelOverride } : {}),
            credentials,
            runToken,
            permitReserved: permit.reserved,
            ...(pendingHandoff ? { resumeToken: pendingHandoff.token } : {}),
          }),
        ]);
      } catch (error) {
        logger.error(
          { error, projectId, conversationId: conversation.id, turnId },
          "failed to prepare the langy turn",
        );
        throw new LangyAgentUnavailableError("Agent request failed");
      }

      try {
        await conversationService.acceptTurn({
          projectId,
          conversationId: conversation.id,
          turnId,
          questionParts,
          ...(conversation.isNew
            ? {
                conversationStart: {
                  userId,
                  title,
                  ...(mintedRunToken ? { runToken: mintedRunToken } : {}),
                },
              }
            : {}),
          ...(!isRetry && lastUserMessage?.role === "user"
            ? {
                userMessage: {
                  userId,
                  messageId: identity.messageId,
                  role: lastUserMessage.role,
                  parts: lastUserMessage.parts,
                  title,
                },
              }
            : {}),
          ...(pendingHandoff
            ? { consumeHandoffTurnId: pendingHandoff.turnId }
            : {}),
        });
      } catch (error) {
        logger.error(
          { error, projectId, conversationId: conversation.id, turnId },
          "failed to commit langy AcceptAgentTurn",
        );
        throw new LangyAgentUnavailableError("Agent request failed");
      }

      // Idempotency wins over the last few milliseconds: do not eagerly launch
      // the worker until the Postgres replay receipt is confirmed. If the commit
      // cannot be confirmed, the already-durable process outbox remains the sole
      // recovery path for this attempt.
      const admissionCommitted = await attempt.commit();
      if (admissionCommitted) {
        // Fast-path dispatch begins at the first safe instant. The process
        // outbox remains the at-least-once recovery path; Go's turnId claim
        // makes its later duplicate a benign no-op.
        void worker
          .dispatch({
            intent: pendingHandoff
              ? "revive"
              : credentials.langwatchApiKey
                ? "create"
                : "continue",
            projectId,
            userId,
            runToken,
            turnId,
            prompt: userText,
            system,
            conversationId: conversation.id,
            credentials,
            ...(modelOverride ? { modelOverride } : {}),
            ...(pendingHandoff ? { resumeToken: pendingHandoff.token } : {}),
          })
          .then((outcome) => {
            if (outcome !== "accepted") {
              logger.warn(
                { outcome, conversationId: conversation.id, turnId },
                "fast-path Langy dispatch was not accepted; outbox will retry",
              );
            }
          })
          .catch((error) => {
            logger.warn(
              { error, conversationId: conversation.id, turnId },
              "fast-path Langy dispatch failed; outbox will retry",
            );
          });
      }

      getLangyTurnsCounter("accepted").inc();
      return { conversationId: conversation.id, turnId };
    } catch (error) {
      getLangyTurnsCounter(
        error instanceof LangyTurnInProgressError
          ? "busy"
          : error instanceof LangyAgentUnavailableError
            ? "rejected"
            : "error",
      ).inc();
      await attempt.abort();
      if (error instanceof LangySessionKeyScopeError) {
        throw new LangyInsufficientScopeError(error.message);
      }
      throw error;
    }
  }
}
