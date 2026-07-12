/**
 * LangyTurnService — the turn-START orchestration, lifted out of
 * `routes/langy.ts` (ADR-046 / LANGY_REWORK_PLAN.md S2 increment C).
 *
 * The Hono route now keeps only Phase 1 (session auth, demo gate, rate limit,
 * body validation, project-permission gate) and maps DomainErrors to HTTP. This
 * service owns everything after the gate: resolve the conversation, model,
 * credentials and egress list; probe-then-mint the per-turn session key; reserve
 * the PR permit; warm the worker; guard against a concurrent turn; stash the
 * live-access grant + the spawn handoff; record the user message; dispatch the
 * turn; consume any resume handoff.
 *
 * The ORDER here is load-bearing and preserved exactly from the route — the
 * parallel batches, the "gate precedence", the message-before-turn invariant,
 * the permit-release-only-on-early-exit, and the mint-only-on-a-probe-miss are
 * all deliberate. This is a relocation, not a redesign.
 *
 * Errors are thrown as DomainErrors (each carries its httpStatus); the route
 * renders them. Infrastructure failures throw and surface generically.
 */
import type { Session } from "~/server/auth";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
import { LangySessionKeyScopeError } from "~/server/services/langy/langyApiKey";
import type { LangyCredentialService } from "~/server/services/langy/LangyCredentialService";
import type { LangyWorkerPort } from "~/server/services/langy/langyWorker";
import type { LangyTurnAccessStore } from "~/server/services/langy/streaming/langyTurnAccess";
import type { LangyTurnHandoffStore } from "~/server/services/langy/streaming/langyTurnHandoff";
import { renderLangyTurnContext } from "~/server/services/langy/langyTurnContext.schema";
import type { LangyTurnContext } from "~/server/services/langy/langyTurnContext.schema";
import { LANGY_CONVERSATION_STATUS } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import {
  LangyAgentUnavailableError,
  LangyEgressMisconfiguredError,
  LangyInsufficientScopeError,
  LangyModelNotAllowedError,
  LangyModelNotConfiguredError,
  LangyTurnInProgressError,
} from "./errors";
import type { LangyConversationService } from "./langy-conversation.service";
import { extractTextFromParts } from "./langy-message.service";
import type { LangyMessagePart } from "~/server/event-sourcing/pipelines/langy-conversation-processing";

const logger = createLogger("langwatch:langy:turn-service");
const tracer = getLangWatchTracer("langwatch.langy.chat");

/** The Langy system-block override — Langy's role, not a code assistant. */
const LANGY_OVERRIDE = [
  "OVERRIDE — you are Langy, the in-product LangWatch assistant.",
  "You are NOT a code/repo assistant. You do not edit files, run shell, or scaffold projects.",
  "Your only job is to read and act on the user's LangWatch project via the available MCP tools",
  "(search_traces, get_trace, get_analytics, list_evaluators, list_prompts, list_datasets,",
  "list_scenarios, list_agents, list_monitors, list_dashboards, list_workflows, list_triggers,",
  "create_*, update_*, run_*).",
  "Call tools immediately — never describe what you would do, never list your capabilities,",
  "never ask which project, never offer 'next actions'. Pick a reasonable default, act, report",
  "the result tersely with a relevant LangWatch UI URL when applicable.",
].join(" ");

export interface LangyChatMessageInput {
  role: "user" | "assistant" | "system";
  parts: LangyMessagePart[];
}

export interface StartConversationTurnInput {
  projectId: string;
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
  worker: LangyWorkerPort | null;
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

    // ── PHASE 2: EVERYTHING THAT NEEDS ONLY THE PROJECT ─────────────────────
    // Four independent round trips — conversation lookup, model resolve, the
    // session-key-less credential resolve, and the egress allow-list. allSettled
    // (not all): each failure maps to a DIFFERENT status.
    const [conversationResult, model, credentialsResult, egressResult] =
      await tracer.withActiveSpan(
        "langy.chat.phase2_dependencies",
        {
          attributes: {
            "tenant.id": projectId,
            "langy.phase": "dependencies",
          },
        },
        async () =>
          Promise.allSettled([
            conversationService.ensureConversation({
              projectId,
              userId,
              conversationId: requestedConversationId ?? null,
            }),
            this.deps.resolveModel({ projectId }),
            // mintSessionKey:false — resolve first, probe second, mint only on a
            // miss (the manager reuses a live worker's key). See the probe below.
            credentialService.getOrProvision({
              projectId,
              session,
              mintSessionKey: false,
            }),
            credentialService.getEgressAllowlist({ projectId }),
          ]),
      );

    if (conversationResult.status === "rejected") {
      throw conversationResult.reason;
    }
    const conversation = conversationResult.value;

    const lastUserMessage = messages[messages.length - 1];

    if (model.status === "rejected") {
      logger.warn(
        { error: model.reason, projectId },
        "getVercelAIModel failed",
      );
      throw new LangyModelNotConfiguredError();
    }

    // On a RETRY the trailing user message is the SAME one the failed turn
    // already persisted — re-recording it would duplicate the question. Kicked
    // off HERE, awaited LATER (just before dispatch): the agent gets the prompt
    // directly, so persisting it is not on the critical path.
    const messageRecorded =
      !isRetry && lastUserMessage?.role === "user"
        ? conversationService.recordUserMessage({
            projectId,
            conversationId: conversation.id,
            userId,
            parts: lastUserMessage.parts,
            title:
              extractTextFromParts(messages[0]?.parts).slice(0, 80) || null,
          })
        : Promise.resolve(null);
    messageRecorded.catch(() => undefined);

    const userText = extractTextFromParts(lastUserMessage?.parts);
    const questionParts = lastUserMessage?.parts ?? [];

    // ── PHASE 3: THE CONVERSATION-SCOPED READS ──────────────────────────────
    const [currentResult, handoffResult] = await Promise.allSettled([
      // findByIdVisible, not getById: absence is a real answer here — a
      // not-yet-projected conversation cannot have a turn running, so "not
      // there" means "not busy".
      conversationService.findByIdVisible({
        id: conversation.id,
        projectId,
        userId,
      }),
      conversationService.getPendingHandoff({
        projectId,
        conversationId: conversation.id,
      }),
    ]);

    if (credentialsResult.status === "rejected") {
      // LangyCredentialResolutionError is a DomainError (409); anything else is
      // infrastructure and surfaces generically. Either way, rethrow.
      throw credentialsResult.reason;
    }
    const credentials = credentialsResult.value;

    // Egress allow-list (ADR-043): presence is the mode. A drift throws in
    // getEgressAllowlist and fails closed here rather than silently disabling.
    if (egressResult.status === "rejected") {
      logger.error(
        { error: egressResult.reason, projectId },
        "failed to resolve Langy egress allow-list",
      );
      throw new LangyEgressMisconfiguredError();
    }
    if (egressResult.value) {
      credentials.egressAllowlist = egressResult.value;
    }

    // Defense in depth: enforce the project's Langy VK allowlist on a
    // modelOverride HERE — don't trust the picker. BEFORE the PR permit so an
    // invalid override doesn't burn a daily slot.
    if (modelOverride) {
      const modelsAllowed = await credentialService.getModelsAllowed({
        projectId,
        organizationId: credentials.organizationId,
      });
      if (modelsAllowed && !modelsAllowed.includes(modelOverride)) {
        logger.warn(
          { projectId, modelOverride, allowedCount: modelsAllowed.length },
          "modelOverride not in VK allowlist — rejecting",
        );
        throw new LangyModelNotAllowedError(modelOverride);
      }
    }

    // ── MINT THE SESSION KEY ONLY IF A WORKER MUST ACTUALLY BE SPAWNED ───────
    // Probe with the OVERRIDE model (never the resolved default) to mirror the
    // manager's signature exactly; fail-open to a mint.
    const workerIsLive = await worker.probe({
      conversationId: conversation.id,
      ...(modelOverride ? { model: modelOverride } : {}),
      hasGithubAuth: !!credentials.githubToken,
      ...(credentials.egressAllowlist
        ? { egressAllowlist: credentials.egressAllowlist }
        : {}),
    });

    if (!workerIsLive) {
      try {
        const minted = await this.deps.mintSessionKey({
          session,
          projectId,
          organizationId: credentials.organizationId,
        });
        credentials.langwatchApiKey = minted.token;
        credentials.langwatchApiKeyId = minted.apiKeyId;
      } catch (error) {
        if (error instanceof LangySessionKeyScopeError) {
          throw new LangyInsufficientScopeError(error.message);
        }
        throw error;
      }
    }

    // Per-user daily PR cap — atomic reserve BEFORE we hand over a GitHub token.
    // Over cap → strip the token so the worker physically cannot `gh pr create`.
    // RELEASE only on an early exit that never starts a turn, and only when
    // reserved (a Redis-down reserve returns reserved:false; DECRing that walks
    // the shared counter negative).
    const permit = await this.deps.reservePermit({ userId });
    const releaseReservedPermit = async () => {
      if (!permit.reserved) return;
      try {
        await this.deps.releasePermit({ userId });
      } catch (error) {
        logger.warn({ error }, "failed to release langy github PR permit");
      }
    };
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

    // ── HIT THE WORKER NOW ───────────────────────────────────────────────────
    // Credentials are final as of this line (model + egress + PR-cap decision
    // settled) — the earliest a warm reuses the worker the turn will use.
    // Fire-and-forget: a failed warm just cold-starts.
    void worker.warm({
      conversationId: conversation.id,
      credentials,
      ...(modelOverride ? { modelOverride } : {}),
    });

    // Busy-guard: one turn in flight per conversation. A failed read must not
    // block a turn.
    const current =
      currentResult.status === "fulfilled" ? currentResult.value : null;
    if (currentResult.status === "rejected") {
      logger.warn(
        { error: currentResult.reason, conversationId: conversation.id },
        "busy-guard read failed — allowing the turn",
      );
    }
    if (current?.status === LANGY_CONVERSATION_STATUS.RUNNING) {
      await releaseReservedPermit();
      throw new LangyTurnInProgressError();
    }

    // Generate the turnId up front so the spawn handoff is stashed BEFORE
    // agent_response_started is dispatched — otherwise the spawn reactor could
    // fire and find no handoff.
    const turnId = crypto.randomUUID();
    const system = [
      LANGY_OVERRIDE,
      renderLangyTurnContext(turnContext),
      capReachedNote,
    ]
      .filter((block): block is string => !!block && block.trim().length > 0)
      .join("\n\n");

    // ADR-048 resume-on-next-worker: thread a prior turn's opaque resume token to
    // the fresh worker, then consume it once the turn has started. A read failure
    // degrades to a cold start; it must never block a new turn.
    if (handoffResult.status === "rejected") {
      logger.warn(
        { error: handoffResult.reason, conversationId: conversation.id },
        "failed to read pending langy handoff — cold-starting",
      );
    }
    const pendingHandoff =
      handoffResult.status === "fulfilled" ? handoffResult.value : null;

    // Who may watch this turn's live streams — written NOW, synchronously,
    // because the browser subscribes the instant it reads the turn-id, and the
    // ClickHouse fold will not exist for seconds yet.
    await accessStore.grant({
      projectId,
      conversationId: conversation.id,
      turnId,
      userId,
    });

    await handoffStore.stash({
      projectId,
      conversationId: conversation.id,
      turnId,
      actorUserId: userId,
      prompt: userText,
      system,
      ...(modelOverride ? { modelOverride } : {}),
      credentials,
      permitReserved: permit.reserved,
      ...(pendingHandoff ? { resumeToken: pendingHandoff.token } : {}),
    });

    // The ordering that MATTERS: the user's message must be on record before the
    // turn that answers it exists. Almost always already-settled by now.
    try {
      await messageRecorded;
    } catch (error) {
      await releaseReservedPermit();
      logger.error({ error }, "failed to record the langy user message");
      throw new LangyAgentUnavailableError("Agent request failed");
    }

    try {
      await conversationService.startTurn({
        projectId,
        conversationId: conversation.id,
        turnId,
        questionParts,
      });
    } catch (error) {
      await releaseReservedPermit();
      logger.error({ error }, "failed to dispatch langy CreateAgentResponse");
      throw new LangyAgentUnavailableError("Agent request failed");
    }

    // ADR-048: the resume token is threaded to the new worker — clear it so it is
    // consumed exactly once. Best-effort (idempotent).
    if (pendingHandoff) {
      await conversationService
        .consumeHandoff({
          projectId,
          conversationId: conversation.id,
          turnId: pendingHandoff.turnId,
        })
        .catch((error) =>
          logger.warn(
            { error, conversationId: conversation.id },
            "failed to consume langy handoff",
          ),
        );
    }

    return { conversationId: conversation.id, turnId };
  }
}
