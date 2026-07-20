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
import type { Session } from "~/server/auth";
import { createLogger } from "@langwatch/observability";
import { trace } from "@opentelemetry/api";
import { getLangyTurnsCounter } from "~/server/metrics";
import { LangySessionKeyScopeError } from "~/server/app-layer/langy/langyApiKey";
import type { LangyCredentialService } from "~/server/app-layer/langy/LangyCredentialService";
import type { LangyWorkerPort } from "~/server/app-layer/langy/langyWorker";
import { mintRunToken } from "~/server/app-layer/langy/streaming/langyFrameAuth";
import type { LangyTurnAccessStore } from "~/server/app-layer/langy/streaming/langyTurnAccess";
import type { LangyTurnHandoffStore } from "~/server/app-layer/langy/streaming/langyTurnHandoff";
import { renderLangyTurnContext } from "~/server/app-layer/langy/langyTurnContext.schema";
import type { LangyTurnContext } from "~/server/app-layer/langy/langyTurnContext.schema";
import { LANGY_TURN_OVERRIDE_FALLBACK } from "~/server/app-layer/langy/langyPromptRegistry";
import { LANGY_CONVERSATION_STATUS } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import {
  LangyAgentUnavailableError,
  LangyInsufficientScopeError,
  LangyModelNotAllowedError,
  LangyTurnInProgressError,
} from "./errors";
import type { LangyConversationService } from "./langy-conversation.service";
import { extractTextFromParts } from "./langy-message.service";
import type { LangyMessagePart } from "~/server/event-sourcing/pipelines/langy-conversation-processing";
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

function turnIdForRequest(requestId: string): string {
  return `langyturn_request-${requestId}`;
}

function messageIdForRequest(requestId: string): string {
  return `langymsg_request-${requestId}`;
}

export interface LangyChatMessageInput {
  role: "user" | "assistant" | "system";
  parts: LangyMessagePart[];
}

export interface StartConversationTurnInput {
  projectId: string;
  /** Stable identity for one logical send, reused by every transport retry. */
  requestId: string;
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
  /** Direct fast-path dispatch plus durable process-effect recovery. */
  worker: Pick<LangyWorkerPort, "probe" | "dispatch"> | null;
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
  revokeSessionKey: (args: { apiKeyId: string }) => Promise<void>;
  admission: LangyTurnAdmissionRepository;
  accessStore: LangyTurnAccessStore | null;
  handoffStore: LangyTurnHandoffStore | null;
}

export class LangyTurnService {
  private constructor(private readonly deps: LangyTurnServiceDeps) {}

  static create(deps: LangyTurnServiceDeps): LangyTurnService {
    return new LangyTurnService(deps);
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
      requestId,
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
      requestId,
      conversationId: speculativeConversation.id,
      turnId: turnIdForRequest(requestId),
    });
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
        requestId,
        conversationId: conversation.id,
        turnId,
        claimToken: admission.claimToken,
      },
      this.deps,
    );

    try {
      const lastUserMessage = messages[messages.length - 1];
      const userText = extractTextFromParts(lastUserMessage?.parts);
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
        });

      // With no GitHub capability, the signature is already final; overlap the
      // cheap probe with the conversation-scoped reads.
      const earlyWorkerProbe = credentials.githubToken ? null : probeWorker();

      const [
        currentResult,
        handoffResult,
        runTokenResult,
        modelsAllowedResult,
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

      const system = [
        LANGY_OVERRIDE,
        renderLangyTurnContext(turnContext),
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
                  messageId: messageIdForRequest(requestId),
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
