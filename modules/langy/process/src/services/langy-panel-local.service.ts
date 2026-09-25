import { HandledError } from "@langwatch/handled-error";
import {
  LangyConversationNotFoundError,
  LangyLocalSkipModelNotAllowedError,
  LangyWaitExpiredError,
  SHARE_CONTROL_COMMAND,
  type LangyConversationDetail,
  type LangyLocalRecord,
  type LangyPanelCall,
  type LangyPanelCaller,
  type langyLocalWorkspaceStatusSchema,
  type langyAnswerLocalPermissionInputSchema,
  type langyAnswerQuestionInputSchema,
  type langyPanelConversationInputSchema,
  type langyProjectInputSchema,
  type langySetLocalPolicyInputSchema,
} from "@langwatch/langy-contract";
import { ProjectNotFoundError, type ProjectApi } from "@langwatch/project-contract";
import { nowInstant, Temporal } from "@langwatch/time";
import type { z } from "zod";

import type { LangyConversationCommands } from "../app/langy.members.ts";
import type { ConnectedWorkspace } from "../repositories/langy-local-presence.repository.ts";
import type { LocalControlRuntime } from "../repositories/redis/redis.langy-local-control-runtime.repository.ts";
import { workspaceChannel } from "../rules/langy-local-control-keys.rules.ts";
import { conversationTitle, conversationUrl } from "../rules/langy-local-session-text.rules.ts";
import { reconcileSkipPolicy } from "../rules/langy-local-skip-policy.rules.ts";
import { ControlRequestService } from "./langy-local-control-request.service.ts";
import type { LangyLocalWorkspaceService } from "./langy-local-workspace.service.ts";
import type { LangyPanelAccessService } from "./langy-panel-access.service.ts";
import type { LangyService } from "./langy.service.ts";

type WorkspaceStatus = z.infer<typeof langyLocalWorkspaceStatusSchema>;

export type LangyPanelLocalMembers = Readonly<{
  access: LangyPanelAccessService;
  conversations: Pick<LangyService, "findByIdVisible" | "getLocalRecord">;
  runtime: LocalControlRuntime;
  commands: Pick<
    LangyConversationCommands,
    "changeLocalPolicy" | "disconnectLocalWorkspace" | "requestLocalControl"
  >;
  workspace: Pick<
    LangyLocalWorkspaceService,
    "getCodeAccessPreference" | "canSkipPermissions" | "getSkipPermissionsDecision"
  >;
  projects: Pick<ProjectApi, "findIdentity">;
  baseHost: string | undefined;
}>;

/**
 * The developer's own folder as the panel drives it (ADR-129): each operation one of main's
 * `langy.*` handlers moved here unchanged behind the panel gate.
 * Spec: modules/langy/specs/langy-panel-trpc.feature
 */
export class LangyPanelLocalService {
  static create(members: LangyPanelLocalMembers): LangyPanelLocalService {
    return new LangyPanelLocalService(members);
  }

  private constructor(private readonly members: LangyPanelLocalMembers) {}

  async getPanelLocalRecord(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<LangyLocalRecord> {
    await this.members.access.assertPanelAccess(input);
    return this.members.conversations.getLocalRecord({
      projectId: input.projectId,
      conversationId: input.conversationId,
      userId: input.caller.userId,
    });
  }

  /** What the panel chip, the code access card and the settings page read. */
  async getPanelLocalWorkspace(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<WorkspaceStatus> {
    await this.members.access.assertPanelAccess(input);
    const conversation = await this.getVisible(input);
    const { runtime, workspace } = this.members;
    const [connected] = await this.findConnectedWorkspaces(input.conversationId);
    const [pendingRequest] = await runtime.requests.findOpenForConversation({
      projectId: input.projectId,
      userId: input.caller.userId,
      conversationId: input.conversationId,
    });
    const { preference } = await workspace.getCodeAccessPreference(input.caller.userId);
    const skipAllowed = conversation.lastModel
      ? (
          await workspace.canSkipPermissions({
            projectId: input.projectId,
            model: conversation.lastModel,
          })
        ).allowed
      : false;
    return {
      connected: connected !== undefined,
      workspace: connected ? { ...connected.workspace, hostname: connected.hostname } : null,
      skipAllowed,
      skipPermissions: await reconcileSkipPolicy({
        runtime,
        projectId: input.projectId,
        conversationId: input.conversationId,
        model: conversation.lastModel,
        skipGate: (gate) => workspace.canSkipPermissions(gate),
        changePolicy: (args) => this.recordPolicy({ ...args, projectId: input.projectId }),
      }),
      pendingRequest: pendingRequest ? ControlRequestService.toWire(pendingRequest) : null,
      codeAccessPreference: preference,
    };
  }

  async getCodeAccessPreference(
    input: LangyPanelCall<typeof langyProjectInputSchema>,
  ): Promise<{ preference: "github" | null }> {
    await this.members.access.assertPanelAccess(input);
    return this.members.workspace.getCodeAccessPreference(input.caller.userId);
  }

  /** A card that already settled refuses `langy_wait_expired`; the panel then sends a message. */
  async answerLocalPermission(
    input: LangyPanelCall<typeof langyAnswerLocalPermissionInputSchema>,
  ): Promise<{ answered: true }> {
    await this.members.access.assertPanelAccess(input);
    await this.assertOwnWait(input);
    await this.members.runtime.waits.answer({
      waitId: input.waitId,
      userId: input.caller.userId,
      decision: input.decision,
    });
    return { answered: true };
  }

  async answerLocalQuestion(
    input: LangyPanelCall<typeof langyAnswerQuestionInputSchema>,
  ): Promise<{ answered: true }> {
    await this.members.access.assertPanelAccess(input);
    await this.assertOwnWait(input);
    await this.members.runtime.waits.answer({
      waitId: input.waitId,
      userId: input.caller.userId,
      answers: input.answers.map((answer) => ({
        question: answer.question,
        selected: answer.selected,
        ...(answer.other !== undefined ? { other: answer.other } : {}),
      })),
    });
    return { answered: true };
  }

  /** The server owns only whether the model may skip; the command line keeps its own boundary. */
  async setLocalPolicy(
    input: LangyPanelCall<typeof langySetLocalPolicyInputSchema>,
  ): Promise<{ skipPermissions: boolean }> {
    await this.members.access.assertPanelAccess(input);
    const conversation = await this.getOwn(input);
    const { runtime } = this.members;
    let model = conversation.lastModel ?? "";
    if (input.skipPermissions) {
      const decision = await this.members.workspace.getSkipPermissionsDecision({
        projectId: input.projectId,
        model,
      });
      if (!decision.allowed) {
        throw new LangyLocalSkipModelNotAllowedError({
          model: decision.modelId || model,
          provider: decision.provider,
        });
      }
      model = `${decision.provider}/${decision.modelId}`;
    }
    await runtime.presence.writePolicy({
      conversationId: input.conversationId,
      skipPermissions: input.skipPermissions,
    });
    await this.recordPolicy({
      projectId: input.projectId,
      conversationId: input.conversationId,
      userId: input.caller.userId,
      skipPermissions: input.skipPermissions,
      model,
    });
    await runtime.store.publish(
      workspaceChannel(input.conversationId),
      JSON.stringify({ policy: { skipPermissions: input.skipPermissions } }),
    );
    return { skipPermissions: input.skipPermissions };
  }

  /** Revokes first, whether or not a folder is there, so a reconnect cannot outlive it. */
  async disconnectLocalWorkspace(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<{ disconnected: boolean }> {
    await this.members.access.assertPanelAccess(input);
    await this.getOwn(input);
    const { runtime } = this.members;
    const [workspace] = await this.findConnectedWorkspaces(input.conversationId);

    await runtime.requests.revokeConversationBindings(input.conversationId);
    await runtime.store.publish(
      workspaceChannel(input.conversationId),
      JSON.stringify({ disconnect: { reason: "Disconnected from the LangWatch panel." } }),
    );
    await runtime.presence.deregister({ conversationId: input.conversationId });
    for (const call of await runtime.dispatcher.listPendingForConversation(input.conversationId)) {
      await runtime.dispatcher.cancel({
        callId: call.callId,
        message: "The shared folder was disconnected, so the command did not finish.",
      });
    }
    if (!workspace) return { disconnected: false };
    await this.members.commands.disconnectLocalWorkspace({
      tenantId: input.projectId,
      occurredAt: nowInstant().epochMilliseconds,
      conversationId: input.conversationId,
      instanceId: workspace.instanceId,
      reason: "panel",
    });
    return { disconnected: true };
  }

  /** A fresh request to share a folder; nothing is sent in the person's name, no turn starts. */
  async renewLocalControlRequest(
    input: LangyPanelCall<typeof langyPanelConversationInputSchema>,
  ): Promise<{ expiresAt: string }> {
    await this.members.access.assertPanelAccess(input);
    const conversation = await this.getOwn(input);
    const project = await this.members.projects.findIdentity(input.projectId);
    if (!project) throw new ProjectNotFoundError();
    const request = await this.members.runtime.requests.create({
      projectId: project.id,
      projectName: project.name,
      userId: input.caller.userId,
      conversationId: conversation.id,
      conversationTitle: conversationTitle(conversation.title),
      conversationUrl: conversationUrl(conversation.id, this.members.baseHost, project.slug),
    });
    await this.members.commands.requestLocalControl({
      tenantId: project.id,
      occurredAt: nowInstant().epochMilliseconds,
      conversationId: conversation.id,
      requestId: request.id,
      userId: input.caller.userId,
      expiresAt: request.expiresAt,
      command: SHARE_CONTROL_COMMAND,
    });
    return {
      expiresAt: Temporal.Instant.fromEpochMilliseconds(request.expiresAt).toString({
        fractionalSecondDigits: 3,
      }),
    };
  }

  /** The folder connected to this conversation, or none while it is offline. */
  private async findConnectedWorkspaces(conversationId: string): Promise<ConnectedWorkspace[]> {
    try {
      return [await this.members.runtime.presence.getByConversationId(conversationId)];
    } catch (error) {
      if (HandledError.isHandled(error) && error.code === "langy_local_workspace_offline") {
        return [];
      }
      throw error;
    }
  }

  private async recordPolicy(input: {
    projectId: string;
    conversationId: string;
    userId: string;
    skipPermissions: boolean;
    model: string;
  }): Promise<void> {
    await this.members.commands.changeLocalPolicy({
      tenantId: input.projectId,
      occurredAt: nowInstant().epochMilliseconds,
      conversationId: input.conversationId,
      userId: input.userId,
      skipPermissions: input.skipPermissions,
      ...(input.model ? { model: input.model } : {}),
    });
  }

  /** The wait names its own conversation and project, so an id from another chat refuses. */
  private async assertOwnWait(input: {
    caller: LangyPanelCaller;
    projectId: string;
    conversationId: string;
    waitId: string;
  }): Promise<void> {
    await this.getOwn(input);
    const wait = await this.members.runtime.waits.getWait(input.waitId).catch((error: unknown) => {
      if (HandledError.isHandled(error) && error.code === "langy_local_record_not_found") {
        return null;
      }
      throw error;
    });
    if (
      !wait ||
      wait.projectId !== input.projectId ||
      wait.conversationId !== input.conversationId
    ) {
      throw new LangyWaitExpiredError({ waitId: input.waitId });
    }
  }

  private async getVisible(input: {
    caller: LangyPanelCaller;
    projectId: string;
    conversationId: string;
  }): Promise<LangyConversationDetail> {
    const conversation = await this.members.conversations.findByIdVisible({
      id: input.conversationId,
      projectId: input.projectId,
      userId: input.caller.userId,
    });
    if (!conversation) throw new LangyConversationNotFoundError(input.conversationId);
    return conversation;
  }

  /** A teammate's shared conversation gets the not-found a foreign id gets. */
  private async getOwn(input: {
    caller: LangyPanelCaller;
    projectId: string;
    conversationId: string;
  }): Promise<LangyConversationDetail> {
    const conversation = await this.getVisible(input);
    if (!conversation.isOwn) throw new LangyConversationNotFoundError(input.conversationId);
    return conversation;
  }
}
