import { HandledError } from "@langwatch/handled-error";
import {
  BASH_DEFAULT_TIMEOUT_MS,
  CALL_POLL_HOLD_MS,
  createControlRequestResponseSchema,
  LangyConversationNotFoundError,
  LangyLocalRecordNotFoundError,
  SHARE_CONTROL_COMMAND,
  startCallResponseSchema,
  startWaitResponseSchema,
  workspaceStatusSchema,
  type CreateControlRequestResponse,
  type LangyConversationDetail,
  type LangyLocalCallCancelled,
  type LangyLocalCallInput,
  type LangyLocalCaller,
  type LangyKeyCaller,
  type LangyLocalConversationInput,
  type LangyLocalStartCallInput,
  type LangyLocalStartWaitInput,
  type LangyLocalWaitInput,
  type PollCallResponse,
  type PollWaitResponse,
  type StartCallResponse,
  type StartWaitResponse,
  type WorkspaceStatus,
} from "@langwatch/langy-contract";
import { nowInstant } from "@langwatch/time";

import type { LangyConversationCommands } from "../app/langy.members.ts";
import type { LocalControlRuntime } from "../repositories/redis/redis.langy-local-control-runtime.repository.ts";
import { conversationTitle, conversationUrl } from "../rules/langy-local-session-text.rules.ts";
import { reconcileSkipPolicy } from "../rules/langy-local-skip-policy.rules.ts";
import { ControlRequestService } from "./langy-local-control-request.service.ts";
import type { LangyLocalWorkspaceService } from "./langy-local-workspace.service.ts";
import type { LangyRestCallerService } from "./langy-rest-caller.service.ts";
import type { LangyService } from "./langy.service.ts";

/**
 * What the local worker's door answers (ADR-129), each operation one handler's
 * branch moved out of `transport/langy-local.rest.ts` unchanged.
 * @see specs/langy/langy-local-permissions.feature
 */
export class LangyLocalWorkerService {
  readonly #runtime: LocalControlRuntime;
  readonly #commands: Pick<LangyConversationCommands, "requestLocalControl" | "changeLocalPolicy">;
  readonly #workspace: Pick<
    LangyLocalWorkspaceService,
    "getCodeAccessPreference" | "getGithubInstallation" | "canSkipPermissions"
  >;
  readonly #callers: Pick<LangyRestCallerService, "getLocalCaller">;
  readonly #conversations: Pick<LangyService, "findByIdVisible">;
  readonly #baseHost: string | undefined;

  private constructor(options: LangyLocalWorkerOptions) {
    this.#runtime = options.runtime;
    this.#commands = options.commands;
    this.#workspace = options.workspace;
    this.#callers = options.callers;
    this.#conversations = options.conversations;
    this.#baseHost = options.baseHost;
  }

  static create(options: LangyLocalWorkerOptions): LangyLocalWorkerService {
    return new LangyLocalWorkerService(options);
  }

  async getWorkspace(input: LangyLocalConversationInput): Promise<WorkspaceStatus> {
    const { caller } = await this.#ownConversation(input);
    const connected = await this.#runtime.presence
      .getByConversationId(input.conversationId)
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "langy_local_workspace_offline") {
          return null;
        }
        throw error;
      });
    const [pendingRequest] = await this.#runtime.requests.findOpenForConversation({
      projectId: caller.projectId,
      userId: caller.userId,
      conversationId: input.conversationId,
    });
    const { preference } = await this.#workspace.getCodeAccessPreference(caller.userId);
    const github = await this.#workspace.getGithubInstallation(caller.projectId);

    return workspaceStatusSchema.parse({
      connected: connected !== null,
      ...(connected ? { workspace: connected.workspace } : {}),
      codeAccessPreference: preference,
      github,
      ...(pendingRequest ? { pendingRequest: ControlRequestService.toWire(pendingRequest) } : {}),
    });
  }

  async createControlRequest(
    input: LangyLocalConversationInput,
  ): Promise<CreateControlRequestResponse> {
    const { caller, conversation } = await this.#ownConversation(input);
    const localRequest = await this.#runtime.requests.create({
      projectId: caller.projectId,
      projectName: caller.projectName,
      userId: caller.userId,
      conversationId: conversation.id,
      conversationTitle: conversationTitle(conversation.title),
      conversationUrl: conversationUrl(conversation.id, this.#baseHost, caller.projectSlug),
    });
    await this.#commands.requestLocalControl({
      tenantId: caller.projectId,
      occurredAt: nowInstant().epochMilliseconds,
      conversationId: conversation.id,
      requestId: localRequest.id,
      userId: caller.userId,
      expiresAt: localRequest.expiresAt,
      command: SHARE_CONTROL_COMMAND,
    });

    return createControlRequestResponseSchema.parse({
      request: ControlRequestService.toWire(localRequest),
      command: SHARE_CONTROL_COMMAND,
    });
  }

  /** The skip choice is re-read here: the conversation's model can change between two calls. */
  async startCall(input: LangyLocalStartCallInput): Promise<StartCallResponse> {
    const { conversationId, turnId, toolCallId, ...call } = input.call;
    const { caller, conversation } = await this.#ownConversation({
      actor: input.actor,
      projectId: input.projectId,
      conversationId,
    });
    await reconcileSkipPolicy({
      runtime: this.#runtime,
      projectId: caller.projectId,
      conversationId,
      model: conversation.lastModel,
      skipGate: (gate) => this.#workspace.canSkipPermissions(gate),
      changePolicy: async (args) => {
        await this.#commands.changeLocalPolicy({
          tenantId: caller.projectId,
          occurredAt: nowInstant().epochMilliseconds,
          ...args,
        });
      },
    });

    const timeoutMs =
      call.tool === "local_bash" && call.params.timeout
        ? call.params.timeout * 1000
        : BASH_DEFAULT_TIMEOUT_MS;
    const started = await this.#runtime.dispatcher.start({
      projectId: caller.projectId,
      conversationId,
      turnId,
      ...(toolCallId ? { toolCallId } : {}),
      call,
      timeoutMs,
    });
    return startCallResponseSchema.parse({ callId: started.callId });
  }

  /** The call's answer; not found while the record is gone, which the worker reads as pending. */
  async getCallAnswer(input: LangyLocalCallInput): Promise<PollCallResponse> {
    const call = await this.#ownCall(input);
    const poll = await this.#runtime.dispatcher.poll({
      callId: call.callId,
      holdMs: CALL_POLL_HOLD_MS,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (poll.outcome === "gone") throw new LangyLocalRecordNotFoundError();
    return poll.answer;
  }

  async cancelCall(input: LangyLocalCallInput): Promise<LangyLocalCallCancelled> {
    const call = await this.#ownCall(input);
    await this.#runtime.dispatcher.cancel({ callId: call.callId });
    await this.#runtime.waits.cancelTurn({
      conversationId: call.conversationId,
      turnId: call.turnId,
    });
    return { callId: call.callId, cancelled: true };
  }

  async startWait(input: LangyLocalStartWaitInput): Promise<StartWaitResponse> {
    const { wait: body } = input;
    const { caller } = await this.#ownConversation({
      actor: input.actor,
      projectId: input.projectId,
      conversationId: body.conversationId,
    });
    const wait = await this.#runtime.waits.startQuestion({
      projectId: caller.projectId,
      conversationId: body.conversationId,
      turnId: body.turnId,
      ...(body.toolCallId ? { toolCallId: body.toolCallId } : {}),
      questions: body.questions,
    });
    return startWaitResponseSchema.parse({ waitId: wait.waitId });
  }

  async getWaitAnswer(input: LangyLocalWaitInput): Promise<PollWaitResponse> {
    const caller = await this.#callers.getLocalCaller(input);
    const wait = await this.#runtime.waits.getWait(input.waitId);
    if (wait.projectId !== caller.projectId) throw new LangyLocalRecordNotFoundError();
    await this.#visibleOwn({ caller, conversationId: wait.conversationId });

    const poll = await this.#runtime.waits.poll({
      waitId: wait.waitId,
      holdMs: CALL_POLL_HOLD_MS,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (poll.outcome === "gone") throw new LangyLocalRecordNotFoundError();
    return poll.answer;
  }

  async #ownCall(input: LangyKeyCaller & { callId: string }) {
    const caller = await this.#callers.getLocalCaller(input);
    const lookup = await this.#runtime.dispatcher.read(input.callId);
    if (lookup.kind === "miss" || lookup.call.projectId !== caller.projectId) {
      throw new LangyLocalRecordNotFoundError();
    }
    const { call } = lookup;
    await this.#visibleOwn({ caller, conversationId: call.conversationId });
    return call;
  }

  async #ownConversation(input: LangyKeyCaller & { conversationId: string }): Promise<{
    caller: LangyLocalCaller;
    conversation: LangyConversationDetail;
  }> {
    const caller = await this.#callers.getLocalCaller(input);
    const conversation = await this.#visibleOwn({ caller, conversationId: input.conversationId });
    return { caller, conversation };
  }

  /** A teammate's shared conversation gets the not-found a foreign id gets. */
  async #visibleOwn(input: {
    caller: LangyLocalCaller;
    conversationId: string;
  }): Promise<LangyConversationDetail> {
    const conversation = await this.#conversations.findByIdVisible({
      id: input.conversationId,
      projectId: input.caller.projectId,
      userId: input.caller.userId,
    });
    if (!conversation?.isOwn) throw new LangyConversationNotFoundError(input.conversationId);
    return conversation;
  }
}

export type LangyLocalWorkerOptions = Readonly<{
  runtime: LocalControlRuntime;
  commands: Pick<LangyConversationCommands, "requestLocalControl" | "changeLocalPolicy">;
  workspace: Pick<
    LangyLocalWorkspaceService,
    "getCodeAccessPreference" | "getGithubInstallation" | "canSkipPermissions"
  >;
  callers: Pick<LangyRestCallerService, "getLocalCaller">;
  conversations: Pick<LangyService, "findByIdVisible">;
  baseHost: string | undefined;
}>;
