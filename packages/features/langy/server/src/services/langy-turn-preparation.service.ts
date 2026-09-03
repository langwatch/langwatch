import {
  LANGY_CONVERSATION_STATUS,
  LangyAgentUnavailableError,
  LangyModelNotAllowedError,
  LangyTurnInProgressError,
  extractLangyTextFromParts,
  stripGithubCredentials,
  type LangyCredentials,
  type LangyMessageRow,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { trace } from "@opentelemetry/api";
import {
  LANGY_REFERENT_POLICY,
  LangyConversationMemoryService,
} from "./langy-conversation-memory.service";
import { LangyTurnAttemptService } from "./langy-turn-attempt.service";
import { LangyTurnOverrideService } from "./langy-turn-override.service";
import {
  buildWorkerProbeArgs,
  composeLangyTurnPrompt,
  LANGY_OVERRIDE,
  LANGY_USER_MESSAGE_LABEL,
  type LangyTurnServiceDependencies,
  type StartConversationTurnInput,
} from "./langy-turn.shared";
import { mintRunToken } from "../ports/langy-frame-auth.port";

const logger = createLogger("langwatch:langy:turn-start");

export class LangyTurnPreparationService {
  private readonly override: LangyTurnOverrideService;

  private constructor(private readonly deps: LangyTurnServiceDependencies) {
    this.override = LangyTurnOverrideService.create({
      prompts: deps.prompts,
      projectId: deps.promptProjectId,
    });
  }

  static create(deps: LangyTurnServiceDependencies): LangyTurnPreparationService {
    return new LangyTurnPreparationService(deps);
  }

  async prepareAndDispatch(args: {
    projectId: string;
    userId: string;
    session: StartConversationTurnInput["session"];
    messages: StartConversationTurnInput["messages"];
    lastUserMessage: StartConversationTurnInput["messages"][number] | undefined;
    userText: string;
    identity: { messageId: string };
    isRetry: boolean;
    turnContext: object;
    worker: NonNullable<LangyTurnServiceDependencies["worker"]>;
    accessStore: NonNullable<LangyTurnServiceDependencies["accessStore"]>;
    handoffStore: NonNullable<LangyTurnServiceDependencies["handoffStore"]>;
    credentials: LangyCredentials;
    turnModel: string;
    conversation: { id: string; isNew: boolean };
    turnId: string;
    attempt: LangyTurnAttemptService;
  }): Promise<{ conversationId: string; turnId: string }> {
    const mintedRunToken = args.conversation.isNew ? mintRunToken() : null;
    const earlyWorkerProbe = args.credentials.githubToken
      ? null
      : args.worker.probe(
          buildWorkerProbeArgs({
            projectId: args.projectId,
            actorUserId: args.userId,
            conversationId: args.conversation.id,
            model: args.turnModel,
            credentials: args.credentials,
          }),
        );
    const results = await this.readPreparation(args, mintedRunToken);
    const runToken = this.requireRunnableTurn(args, results);
    const permit = await this.reservePermit(args);
    await this.ensureWorkerAccess(args, earlyWorkerProbe);
    const prepared = this.buildPreparedTurn(args, results, permit.capReachedNote);
    await this.stashPreparedTurn(args, prepared, runToken, permit.reserved);
    await this.acceptPreparedTurn(args, prepared, mintedRunToken);
    await this.dispatchPreparedTurn(args, prepared, runToken);
    this.deps.metrics.count({ outcome: "accepted" });
    return { conversationId: args.conversation.id, turnId: args.turnId };
  }

  private readPreparation(
    args: Parameters<LangyTurnPreparationService["prepareAndDispatch"]>[0],
    mintedRunToken: string | null,
  ) {
    const { conversation, projectId, userId, credentials } = args;
    return Promise.allSettled([
      conversation.isNew
        ? Promise.resolve(null)
        : this.deps.conversations.tryFindByIdVisible({
            id: conversation.id,
            projectId,
            userId,
          }),
      conversation.isNew
        ? Promise.resolve(null)
        : this.deps.conversations.tryGetPendingHandoff({
            projectId,
            conversationId: conversation.id,
          }),
      mintedRunToken
        ? Promise.resolve(mintedRunToken)
        : this.deps.conversations.tryGetRunToken({
            projectId,
            conversationId: conversation.id,
          }),
      this.deps.credentials.tryGetModelsAllowed({
        projectId,
        organizationId: credentials.organizationId,
      }),
      conversation.isNew || !this.deps.messages
        ? Promise.resolve<LangyMessageRow[]>([])
        : this.deps.messages.findAllByConversation({
            conversationId: conversation.id,
            projectId,
          }),
      this.override.resolve(),
      // The live UI-action channel is flagged (`release_langy_ui_actions`), and
      // the turn block may only advertise it while the dispatch route would
      // answer.
      this.deps.uiActionSurface.resolve({
        userId,
        projectId,
        organizationId: credentials.organizationId,
      }),
    ]);
  }

  private requireRunnableTurn(
    args: Parameters<LangyTurnPreparationService["prepareAndDispatch"]>[0],
    [currentResult, , runTokenResult, modelsAllowedResult]: Awaited<
      ReturnType<LangyTurnPreparationService["readPreparation"]>
    >,
  ): string {
    if (runTokenResult.status === "rejected" || !runTokenResult.value) {
      logger.error(
        {
          error: runTokenResult.status === "rejected" ? runTokenResult.reason : undefined,
          projectId: args.projectId,
          conversationId: args.conversation.id,
          turnId: args.turnId,
        },
        "could not read langy runToken; refusing unsignable turn",
      );
      throw new LangyAgentUnavailableError("Agent request failed");
    }
    if (modelsAllowedResult.status === "rejected") {
      throw modelsAllowedResult.reason;
    }
    if (modelsAllowedResult.value && !modelsAllowedResult.value.includes(args.turnModel)) {
      logger.warn(
        {
          projectId: args.projectId,
          turnModel: args.turnModel,
          allowedCount: modelsAllowedResult.value.length,
        },
        "turn model not allowed",
      );
      throw new LangyModelNotAllowedError(args.turnModel);
    }
    if (currentResult.status === "rejected") {
      logger.warn(
        { error: currentResult.reason, conversationId: args.conversation.id },
        "busy projection read failed after admission",
      );
    }
    if (
      currentResult.status === "fulfilled" &&
      currentResult.value?.status === LANGY_CONVERSATION_STATUS.RUNNING
    ) {
      throw new LangyTurnInProgressError();
    }
    return runTokenResult.value;
  }

  private async reservePermit(
    args: Parameters<LangyTurnPreparationService["prepareAndDispatch"]>[0],
  ) {
    const permit = args.credentials.githubToken
      ? await this.deps.permits.reserve({ userId: args.userId })
      : { reserved: false, allowed: true, resetAt: 0 };
    args.attempt.retainPermit(permit.reserved);
    const capReachedNote = permit.allowed
      ? ""
      : [
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
        ].join(" ");
    if (!permit.allowed) {
      stripGithubCredentials(args.credentials);
    }
    return { reserved: permit.reserved, capReachedNote };
  }

  private async ensureWorkerAccess(
    args: Parameters<LangyTurnPreparationService["prepareAndDispatch"]>[0],
    earlyWorkerProbe: ReturnType<
      NonNullable<LangyTurnServiceDependencies["worker"]>["probe"]
    > | null,
  ) {
    const workerAvailable = await (earlyWorkerProbe ??
      args.worker.probe(
        buildWorkerProbeArgs({
          projectId: args.projectId,
          actorUserId: args.userId,
          conversationId: args.conversation.id,
          model: args.turnModel,
          credentials: args.credentials,
        }),
      ));
    if (workerAvailable) {
      return;
    }
    const minted = await this.deps.sessionKeys.mint({
      session: args.session,
      projectId: args.projectId,
      organizationId: args.credentials.organizationId,
    });
    args.credentials.langwatchApiKey = minted.token;
    args.credentials.langwatchApiKeyId = minted.apiKeyId;
    args.attempt.retainSessionKey(minted.apiKeyId);
  }

  private buildPreparedTurn(
    args: Parameters<LangyTurnPreparationService["prepareAndDispatch"]>[0],
    [, handoffResult, , , memoryResult, overrideResult, uiActionsOpenResult]: Awaited<
      ReturnType<LangyTurnPreparationService["readPreparation"]>
    >,
    capReachedNote: string,
  ) {
    if (memoryResult.status === "rejected") {
      logger.warn(
        { error: memoryResult.reason, conversationId: args.conversation.id },
        "failed to read langy conversation memory",
      );
    }
    const durableMessages = memoryResult.status === "fulfilled" ? memoryResult.value : [];
    const transcript = LangyConversationMemoryService.tryRenderTranscript({
      messages: durableMessages,
      currentPrompt: args.userText,
    });
    const memory = LangyConversationMemoryService.tryRender(
      LangyConversationMemoryService.extract({ messages: durableMessages }),
    );
    const override =
      overrideResult.status === "fulfilled"
        ? overrideResult.value
        : { text: LANGY_OVERRIDE, source: "fallback" as const };
    if (overrideResult.status === "rejected") {
      logger.warn(
        { error: overrideResult.reason, conversationId: args.conversation.id },
        "langy override resolution failed",
      );
    }
    trace.getActiveSpan()?.setAttribute("langy.prompt.override.source", override.source);
    const seedBlocks = [transcript, memory].filter(
      (block): block is string => !!block && block.trim().length > 0,
    );
    // The resolver never rejects on its own — it fails closed internally — so
    // a rejected slot can only mean the batch itself failed; closed is the
    // same answer the resolver would have given.
    const isUiActionSurfaceOpen =
      uiActionsOpenResult.status === "fulfilled" ? uiActionsOpenResult.value : false;
    const { prompt, labelled } = composeLangyTurnPrompt({
      contextBlock: this.deps.context.render({
        context: args.turnContext,
        isUiActionSurfaceOpen,
      }),
      capNote: capReachedNote,
      userText: args.userText,
    });
    if (handoffResult.status === "rejected") {
      logger.warn(
        { error: handoffResult.reason, conversationId: args.conversation.id },
        "failed to read pending handoff",
      );
    }
    return {
      prompt,
      system: [override.text, LANGY_REFERENT_POLICY].join("\n\n"),
      historySeed:
        seedBlocks.length > 0
          ? [...seedBlocks, ...(labelled ? [] : [LANGY_USER_MESSAGE_LABEL])].join("\n\n")
          : "",
      pendingHandoff: handoffResult.status === "fulfilled" ? handoffResult.value : null,
    };
  }

  private async stashPreparedTurn(
    args: Parameters<LangyTurnPreparationService["prepareAndDispatch"]>[0],
    prepared: ReturnType<LangyTurnPreparationService["buildPreparedTurn"]>,
    runToken: string,
    permitReserved: boolean,
  ) {
    try {
      await Promise.all([
        args.accessStore.grant({
          projectId: args.projectId,
          conversationId: args.conversation.id,
          turnId: args.turnId,
          userId: args.userId,
        }),
        args.handoffStore.stash({
          projectId: args.projectId,
          conversationId: args.conversation.id,
          turnId: args.turnId,
          actorUserId: args.userId,
          prompt: prepared.prompt,
          system: prepared.system,
          ...(prepared.historySeed ? { historySeed: prepared.historySeed } : {}),
          modelOverride: args.turnModel,
          credentials: args.credentials,
          runToken,
          permitReserved,
          ...(prepared.pendingHandoff ? { resumeToken: prepared.pendingHandoff.token } : {}),
        }),
      ]);
    } catch (error) {
      logger.warn(
        {
          error,
          projectId: args.projectId,
          conversationId: args.conversation.id,
          turnId: args.turnId,
        },
        "failed to prepare langy turn",
      );
      throw new LangyAgentUnavailableError("Agent request failed");
    }
  }

  private async acceptPreparedTurn(
    args: Parameters<LangyTurnPreparationService["prepareAndDispatch"]>[0],
    prepared: ReturnType<LangyTurnPreparationService["buildPreparedTurn"]>,
    mintedRunToken: string | null,
  ) {
    const title =
      extractLangyTextFromParts(
        args.messages.find((message) => message.role === "user")?.parts,
      ).slice(0, 80) || null;
    try {
      await this.deps.conversations.acceptTurn({
        projectId: args.projectId,
        conversationId: args.conversation.id,
        turnId: args.turnId,
        questionParts: args.lastUserMessage?.parts ?? [],
        model: args.turnModel,
        ...(args.conversation.isNew
          ? {
              conversationStart: {
                userId: args.userId,
                title,
                ...(mintedRunToken ? { runToken: mintedRunToken } : {}),
              },
            }
          : {}),
        ...(!args.isRetry && args.lastUserMessage?.role === "user"
          ? {
              userMessage: {
                userId: args.userId,
                messageId: args.identity.messageId,
                role: args.lastUserMessage.role,
                parts: args.lastUserMessage.parts,
                title,
              },
            }
          : {}),
        ...(prepared.pendingHandoff
          ? { consumeHandoffTurnId: prepared.pendingHandoff.turnId }
          : {}),
      });
    } catch (error) {
      logger.warn(
        {
          error,
          projectId: args.projectId,
          conversationId: args.conversation.id,
          turnId: args.turnId,
        },
        "failed to commit AcceptAgentTurn",
      );
      throw new LangyAgentUnavailableError("Agent request failed");
    }
  }

  private async dispatchPreparedTurn(
    args: Parameters<LangyTurnPreparationService["prepareAndDispatch"]>[0],
    prepared: ReturnType<LangyTurnPreparationService["buildPreparedTurn"]>,
    runToken: string,
  ) {
    if (!(await args.attempt.commit())) {
      return;
    }
    void args.worker
      .dispatch({
        intent: prepared.pendingHandoff
          ? "revive"
          : args.credentials.langwatchApiKey
            ? "create"
            : "continue",
        projectId: args.projectId,
        userId: args.userId,
        runToken,
        turnId: args.turnId,
        prompt: prepared.prompt,
        system: prepared.system,
        ...(prepared.historySeed ? { historySeed: prepared.historySeed } : {}),
        conversationId: args.conversation.id,
        credentials: args.credentials,
        modelOverride: args.turnModel,
        ...(prepared.pendingHandoff ? { resumeToken: prepared.pendingHandoff.token } : {}),
      })
      .then((outcome) => {
        if (outcome !== "accepted") {
          logger.warn(
            { outcome, conversationId: args.conversation.id, turnId: args.turnId },
            "fast-path dispatch was not accepted; outbox retries",
          );
        }
      })
      .catch((error) => {
        logger.warn(
          { error, conversationId: args.conversation.id, turnId: args.turnId },
          "fast-path dispatch failed; outbox retries",
        );
      });
  }
}
