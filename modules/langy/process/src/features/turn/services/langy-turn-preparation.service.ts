import {
  LANGY_CONVERSATION_STATUS,
  LangyAgentUnavailableError,
  LangyModelNotAllowedError,
  LangyTurnInProgressError,
  stripGithubCredentials,
  type LangyCredentials,
  type LangyMessageRow,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { trace } from "@opentelemetry/api";

import { langyPrCapReachedNote } from "../../../rules/langy-ci-follow-up.rules.ts";
import {
  extractLangyConversationMemory,
  LANGY_REFERENT_POLICY,
  renderLangyConversationMemory,
  renderLangyConversationTranscript,
} from "../../../rules/langy-conversation-memory.rules.ts";
import {
  placeholderTitleOf,
  startsWithGuidedKickoff,
} from "../../../rules/langy-conversation-title.rules.ts";
import { mintRunToken } from "../../../rules/langy-frame-auth.rules.ts";
import { langyDispatchIntentOf } from "../../../rules/langy-worker-runtime.rules.ts";
import { LangyEndedTurnService } from "./langy-ended-turn.service.ts";
import type { LangyTurnAttemptService } from "./langy-turn-attempt.service.ts";
import { LangyTurnOverrideService } from "./langy-turn-override.service.ts";
import {
  LANGY_OVERRIDE,
  LANGY_USER_MESSAGE_LABEL,
  type LangyTurnServiceDependencies,
  type StartConversationTurnInput,
  LangyTurnSharedService,
} from "./langy-turn-shared.service.ts";

/** The shared turn helpers. Stateless: one instance for the module. */
const LANGY_TURN_SHARED = LangyTurnSharedService.create();

const logger = createLogger("langwatch:langy:turn-start");

export class LangyTurnPreparationService {
  private readonly override: LangyTurnOverrideService;

  private readonly endedTurns: LangyEndedTurnService;

  private constructor(private readonly deps: LangyTurnServiceDependencies) {
    this.endedTurns = LangyEndedTurnService.create({
      tokenBuffer: deps.tokenBuffer,
      ...deps.endedTurnWait,
    });
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
    /** Keeps the unattended ceiling: an allowlisted key, no GitHub token, no UI action. */
    readOnly: boolean;
    unattended?: Pick<NonNullable<StartConversationTurnInput["unattended"]>, "title">;
    ciFollowUp?: Omit<NonNullable<StartConversationTurnInput["ciFollowUp"]>, "countTurn">;
    worker: NonNullable<LangyTurnServiceDependencies["worker"]>;
    accessStore: LangyTurnServiceDependencies["accessStore"];
    handoffStore: LangyTurnServiceDependencies["handoffStore"];
    credentials: LangyCredentials;
    turnModel: string;
    conversation: { id: string; isNew: boolean };
    turnId: string;
    attempt: LangyTurnAttemptService;
  }): Promise<{ conversationId: string; turnId: string }> {
    const mintedRunToken = args.conversation.isNew ? mintRunToken() : null;
    // Started before the probe so the probe can carry it: the disabled skills are
    // part of the worker signature. Never rejects (a flag error reads as gated off).
    const disabledSkillsPromise = this.deps.skillGates.resolveDisabled({
      userId: args.userId,
      projectId: args.projectId,
      organizationId: args.credentials.organizationId,
    });
    const needsOwnKey = Boolean(args.credentials.githubToken) || args.readOnly;
    const earlyWorkerProbe = needsOwnKey ? null : this.probeWorker(args, disabledSkillsPromise);
    const read = await this.readPreparation(args, mintedRunToken);
    const results = await this.settleEndedTurnFold(args, read);
    const disabledSkills = await disabledSkillsPromise;
    if (disabledSkills.length > 0) {
      args.credentials.disabledSkillIds = disabledSkills;
    }
    const runToken = this.requireRunnableTurn(args, results);
    const capReachedNote = await this.checkPrCap(args);
    const lateProbe = () => earlyWorkerProbe ?? this.probeWorker(args, disabledSkills);
    await this.ensureWorkerAccess(args, lateProbe);
    const prepared = this.buildPreparedTurn(args, results, capReachedNote);
    await this.stashPreparedTurn({ args, prepared, runToken });
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
        : this.deps.conversations.findByIdVisible({
            id: conversation.id,
            projectId,
            userId,
          }),
      conversation.isNew
        ? Promise.resolve(null)
        : this.deps.conversations.findPendingHandoff({
            projectId,
            conversationId: conversation.id,
          }),
      mintedRunToken
        ? Promise.resolve(mintedRunToken)
        : this.deps.conversations.findRunToken({
            projectId,
            conversationId: conversation.id,
          }),
      this.deps.credentials.findModelsAllowed({
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
      // The live UI-action channel is flagged (`release_langy_ui_actions`), and the turn block
      // may only advertise it while the dispatch route would answer.
      this.deps.uiActionSurface.resolve({
        userId,
        projectId,
        organizationId: credentials.organizationId,
      }),
    ]);
  }

  /** A RUNNING read for a turn whose live edge already ended waits for its fold. */
  private async settleEndedTurnFold(
    args: Parameters<LangyTurnPreparationService["prepareAndDispatch"]>[0],
    results: Awaited<ReturnType<LangyTurnPreparationService["readPreparation"]>>,
  ): Promise<Awaited<ReturnType<LangyTurnPreparationService["readPreparation"]>>> {
    const [current, ...rest] = results;
    if (current.status !== "fulfilled") return results;
    const { conversation, projectId, userId, turnId } = args;
    const value = await this.endedTurns.settleHeldRead({
      conversationId: conversation.id,
      admittedTurnId: turnId,
      read: current.value,
      reread: () =>
        this.deps.conversations.findByIdVisible({ id: conversation.id, projectId, userId }),
    });
    return [{ status: "fulfilled", value }, ...rest];
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

  /** Reads today's opened pull requests; only one that opened counts (the PR count subscriber). */
  private async checkPrCap(
    args: Parameters<LangyTurnPreparationService["prepareAndDispatch"]>[0],
  ): Promise<string> {
    if (!args.credentials.githubToken) return "";
    const permit = await this.deps.permits.check({ userId: args.userId });
    if (permit.allowed) return "";
    stripGithubCredentials(args.credentials);
    return langyPrCapReachedNote({ perDayPrCap: this.deps.perDayPrCap, resetAt: permit.resetAt });
  }

  private async probeWorker(
    args: Parameters<LangyTurnPreparationService["prepareAndDispatch"]>[0],
    disabledSkillIds: Promise<string[]> | string[],
  ): Promise<boolean> {
    return args.worker.probe(
      LANGY_TURN_SHARED.buildWorkerProbeArgs({
        projectId: args.projectId,
        actorUserId: args.userId,
        conversationId: args.conversation.id,
        model: args.turnModel,
        credentials: args.credentials,
        disabledSkillIds: await disabledSkillIds,
      }),
    );
  }

  private async ensureWorkerAccess(
    args: Parameters<LangyTurnPreparationService["prepareAndDispatch"]>[0],
    probeWorker: () => Promise<boolean>,
  ) {
    // A read-only turn never borrows a running worker's key, which may hold writes.
    if (!args.readOnly && (await probeWorker())) return;

    const minted = await this.deps.sessionKeys.mint({
      session: args.session,
      projectId: args.projectId,
      organizationId: args.credentials.organizationId,
      ...(args.readOnly ? { ceiling: "unattended" as const } : {}),
      conversation: { id: args.conversation.id, turnId: args.turnId },
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
    const transcript = renderLangyConversationTranscript({
      messages: durableMessages,
      currentPrompt: args.userText,
      segmenter: new Intl.Segmenter(),
    });
    const memory = renderLangyConversationMemory(
      extractLangyConversationMemory({ messages: durableMessages }),
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
    // A rejected slot means the batch failed; closed is what the resolver would have answered.
    // A read-only turn is offered none either way: a run has no page, and its history is unvetted.
    const isUiActionSurfaceOpen =
      !args.readOnly && uiActionsOpenResult.status === "fulfilled" && uiActionsOpenResult.value;
    const { prompt, labelled } = LANGY_TURN_SHARED.composeLangyTurnPrompt({
      viewer: args.session.user,
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

  private async stashPreparedTurn({
    args,
    prepared,
    runToken,
  }: {
    args: Parameters<LangyTurnPreparationService["prepareAndDispatch"]>[0];
    prepared: ReturnType<LangyTurnPreparationService["buildPreparedTurn"]>;
    runToken: string;
  }) {
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
    const firstUserParts = args.messages.find((message) => message.role === "user")?.parts;
    const title = placeholderTitleOf(firstUserParts) || null;
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
                title:
                  args.unattended?.title ??
                  (startsWithGuidedKickoff(firstUserParts) ? title : null),
                ...(mintedRunToken ? { runToken: mintedRunToken } : {}),
                ...(args.unattended ? { origin: "run" as const } : {}),
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
                ...(args.ciFollowUp ? { ciFollowUp: args.ciFollowUp } : {}),
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
        intent: langyDispatchIntentOf({
          resumable: Boolean(prepared.pendingHandoff),
          hasApiKey: Boolean(args.credentials.langwatchApiKey),
        }),
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
