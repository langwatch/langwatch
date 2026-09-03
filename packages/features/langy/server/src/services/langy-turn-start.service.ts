import {
  LangyAgentUnavailableError,
  LangyEmptyMessageError,
  LangyIdempotencyMismatchError,
  LangyInsufficientScopeError,
  LangyModelNotAllowedError,
  LangyModelNotConfiguredError,
  LangyTurnInProgressError,
  extractLangyTextFromParts,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { trace } from "@opentelemetry/api";
import { LangyTurnAttemptService } from "./langy-turn-attempt.service";
import { LangyTurnBaseDependenciesService } from "./langy-turn-base-dependencies.service";
import { LangyTurnPreparationService } from "./langy-turn-preparation.service";
import {
  langyTurnIdentity,
  type LangyTurnServiceDependencies,
  type StartConversationTurnInput,
} from "./langy-turn.shared";
import { LangySessionKeyScopeError } from "../ports/langy-turn-runtime.port";

const logger = createLogger("langwatch:langy:turn-start");
type ClaimedTurn = {
  conversation: { id: string; isNew: boolean };
  turnId: string;
  claimToken: string;
};

/** Private collaborator for admission, preparation, and fast-path dispatch. */
export class LangyTurnStartService {
  private readonly preparation: LangyTurnPreparationService;

  private constructor(private readonly deps: LangyTurnServiceDependencies) {
    this.preparation = LangyTurnPreparationService.create(deps);
  }

  static create(deps: LangyTurnServiceDependencies): LangyTurnStartService {
    return new LangyTurnStartService(deps);
  }

  async startConversationTurn(
    input: StartConversationTurnInput,
  ): Promise<{ conversationId: string; turnId: string }> {
    const runtime = this.requireRuntime();
    const request = this.prepareRequest(input);
    const { speculativeConversation, credentials, resolvedModel } =
      await LangyTurnBaseDependenciesService.create().resolve({
        deps: this.deps,
        projectId: input.projectId,
        userId: request.userId,
        session: input.session,
        requestedConversationId: input.requestedConversationId,
        ...(input.adoptConversationId ? { adoptConversationId: true } : {}),
        ...(input.modelOverride ? { modelOverride: input.modelOverride } : {}),
      });
    const turnModel = this.requireTurnModel(input.modelOverride, resolvedModel);
    const admission = await this.deps.admission.claim({
      projectId: input.projectId,
      userId: request.userId,
      idempotencyKey: input.idempotencyKey,
      conversationId: speculativeConversation.id,
      turnId: request.identity.turnId,
    });
    const claimed = this.resolveAdmission({
      admission,
      projectId: input.projectId,
      userId: request.userId,
      speculativeConversation,
    });
    if ("conversationId" in claimed) {
      return claimed;
    }
    return this.runClaimedTurn({
      input,
      request,
      runtime,
      credentials,
      turnModel,
      claimed,
    });
  }

  private requireRuntime() {
    const { worker, accessStore, handoffStore } = this.deps;
    if (!worker) {
      throw new LangyAgentUnavailableError("Agent not configured");
    }
    if (!accessStore || !handoffStore) {
      throw new LangyAgentUnavailableError();
    }
    return { worker, accessStore, handoffStore };
  }

  private prepareRequest(input: StartConversationTurnInput) {
    const userId = input.session.user.id;
    const lastUserMessage = input.messages[input.messages.length - 1];
    const userText = extractLangyTextFromParts(lastUserMessage?.parts);
    if (!userText.trim()) {
      this.deps.metrics.count({ outcome: "rejected" });
      throw new LangyEmptyMessageError();
    }
    return {
      userId,
      lastUserMessage,
      userText,
      identity: langyTurnIdentity({
        userId,
        idempotencyKey: input.idempotencyKey,
        messages: input.messages,
        ...(input.modelOverride ? { modelOverride: input.modelOverride } : {}),
      }),
    };
  }

  private requireTurnModel(modelOverride: string | undefined, resolvedModel: string | null) {
    const turnModel = modelOverride ?? resolvedModel;
    if (!turnModel) {
      throw new LangyModelNotConfiguredError();
    }
    return turnModel;
  }

  private resolveAdmission({
    admission,
    projectId,
    userId,
    speculativeConversation,
  }: {
    admission: Awaited<ReturnType<LangyTurnServiceDependencies["admission"]["claim"]>>;
    projectId: string;
    userId: string;
    speculativeConversation: { id: string; isNew: boolean };
  }): ClaimedTurn | { conversationId: string; turnId: string } {
    if (admission.kind === "mismatch") {
      this.deps.metrics.count({ outcome: "mismatch" });
      throw new LangyIdempotencyMismatchError();
    }
    if (admission.kind === "replay") {
      this.deps.metrics.count({ outcome: "replay" });
      return { conversationId: admission.conversationId, turnId: admission.turnId };
    }
    if (admission.kind === "pending") {
      this.deps.metrics.count({ outcome: "rejected" });
      throw new LangyAgentUnavailableError(
        "This turn is already being prepared. Please retry shortly.",
      );
    }
    if (admission.kind === "busy") {
      this.deps.metrics.count({ outcome: "busy" });
      throw new LangyTurnInProgressError();
    }
    trace.getActiveSpan()?.setAttributes({
      "tenant.id": projectId,
      "langy.conversation.id": admission.conversationId,
      "langy.turn.id": admission.turnId,
      "user.id": userId,
    });
    return {
      conversation: {
        id: admission.conversationId,
        isNew:
          speculativeConversation.isNew || speculativeConversation.id !== admission.conversationId,
      },
      turnId: admission.turnId,
      claimToken: admission.claimToken,
    };
  }

  private async runClaimedTurn({
    input,
    request,
    runtime,
    credentials,
    turnModel,
    claimed,
  }: {
    input: StartConversationTurnInput;
    request: ReturnType<LangyTurnStartService["prepareRequest"]>;
    runtime: ReturnType<LangyTurnStartService["requireRuntime"]>;
    credentials: Awaited<ReturnType<LangyTurnBaseDependenciesService["resolve"]>>["credentials"];
    turnModel: string;
    claimed: ClaimedTurn;
  }): Promise<{ conversationId: string; turnId: string }> {
    const attempt = LangyTurnAttemptService.create(
      {
        projectId: input.projectId,
        userId: request.userId,
        idempotencyKey: input.idempotencyKey,
        conversationId: claimed.conversation.id,
        turnId: claimed.turnId,
        claimToken: claimed.claimToken,
      },
      this.deps,
    );
    try {
      return await this.preparation.prepareAndDispatch({
        projectId: input.projectId,
        userId: request.userId,
        session: input.session,
        messages: input.messages,
        lastUserMessage: request.lastUserMessage,
        userText: request.userText,
        identity: request.identity,
        isRetry: input.isRetry,
        turnContext: input.turnContext,
        ...runtime,
        credentials,
        turnModel,
        conversation: claimed.conversation,
        turnId: claimed.turnId,
        attempt,
      });
    } catch (error) {
      this.deps.metrics.count({
        outcome:
          error instanceof LangyTurnInProgressError
            ? "busy"
            : error instanceof LangyAgentUnavailableError
              ? "rejected"
              : "failed",
      });
      await attempt.abort();
      if (error instanceof LangySessionKeyScopeError) {
        throw new LangyInsufficientScopeError(error.message);
      }
      throw error;
    }
  }
}
