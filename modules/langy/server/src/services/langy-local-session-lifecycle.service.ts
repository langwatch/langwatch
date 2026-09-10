/**
 * The folder's comings and goings: announcing it when it registers, retiring it when it goes,
 * and reacting to what another pod says about it. Retiring fails the calls it was working on,
 * so the worker's poll answers at once rather than at the deadline.
 */
import { createLogger } from "@langwatch/observability";
import { LOCAL_CONTROL_PROTOCOL_VERSION, type PlatformFrame } from "@langwatch/langy-contract";
import { disconnectMessage } from "../rules/langy-local-session-text.rules.ts";
import { workspaceNudgeSchema } from "../rules/langy-local-call-record.rules.ts";

/** A nudge from another pod, or null when it is not one this build understands. */
function safeNudge(raw: string) {
  try {
    const parsed = workspaceNudgeSchema.safeParse(JSON.parse(raw));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
import type { LangyLocalPresence } from "../repositories/langy-local-presence.repository.ts";
import type { LocalCallDispatcherService } from "./langy-local-call-dispatcher.service.ts";
import type { ControlRequestService } from "./langy-local-control-request.service.ts";
import type {
  ControlBuffer,
  ControlConversations,
  ControlEvents,
  ControlSession,
} from "../rules/langy-local-session-contract.rules.ts";

const logger = createLogger("langwatch:langy:local-control:session");

type LocalControlLifecycleOptions = {
  buffer: () => ControlBuffer;
  conversations: () => ControlConversations;
  events: () => ControlEvents;
  dispatcher: LocalCallDispatcherService;
  presence: LangyLocalPresence;
  requests: ControlRequestService;
  now: () => number;
  /** The core's own staleness check, so both seams answer it the same way. */
  isCurrentConnection: (session: ControlSession) => Promise<boolean>;
};

export class LocalControlLifecycleService {
  static create(deps: LocalControlLifecycleOptions): LocalControlLifecycleService {
    return new LocalControlLifecycleService(deps);
  }

  private constructor(private readonly deps: LocalControlLifecycleOptions) {}

  /**
   * The folder is gone. Clears presence, records it, and fails the calls it was
   * working on so the worker's poll answers at once instead of at the deadline.
   */
  async retire(
    session: ControlSession,
    reason: "cli_exit" | "panel" | "presence_lost",
  ): Promise<void> {
    // Read before the deregister, so the line written below can name the
    // folder that is going rather than whatever answers afterwards.
    const workspace = await this.deps.presence.read(session.conversationId);
    const cleared = await this.deps.presence.deregister({
      conversationId: session.conversationId,
      instanceId: session.instanceId,
    });
    // A socket replaced by a newer share clears nothing, and must not cancel
    // the calls the new folder is already running.
    if (!cleared) {
      return;
    }

    for (const call of await this.deps.dispatcher.listPendingForConversation(
      session.conversationId,
    )) {
      await this.deps.dispatcher.tryCancel({
        callId: call.callId,
        code: "cancelled",
        message: "The shared folder disconnected, so the command did not finish.",
      });
    }

    await this.deps.events().disconnectLocalWorkspace({
      tenantId: session.projectId,
      occurredAt: this.deps.now(),
      conversationId: session.conversationId,
      instanceId: session.instanceId,
      reason,
    });
    await this.deps.requests.revokeKeyBinding(session.apiKeyId);
    await this.announceWorkspace(session, "disconnected");
    await this.recordDisconnect(session, workspace?.workspace);
  }

  /**
   * Says in the chat that the folder is gone (the connect is already a
   * transcript line; Ctrl-C was not). Recorded with the `system` role: starts
   * no turn, renders as a plain notice.
   */
  private async recordDisconnect(
    session: ControlSession,
    workspace: { name: string; root: string } | undefined,
  ): Promise<void> {
    try {
      await this.deps.conversations().recordUserMessage({
        projectId: session.projectId,
        conversationId: session.conversationId,
        userId: session.userId,
        role: "system",
        parts: [
          {
            type: "text",
            text: disconnectMessage(
              workspace ?? { name: session.workspaceName, root: "" },
              session.hostname,
            ),
          },
        ],
      });
    } catch (error) {
      // The folder is already gone and its key already revoked; a line that
      // could not be written must not turn a clean exit into a failure.
      logger.warn(
        { conversationId: session.conversationId, error },
        "could not write the folder disconnect into the transcript",
      );
    }
  }

  /** Puts the folder's connect or disconnect on the live edge of a running turn. */
  async announceWorkspace(
    session: ControlSession,
    state: "connected" | "disconnected",
  ): Promise<void> {
    const conversation = await this.deps.conversations().findByIdVisible({
      id: session.conversationId,
      projectId: session.projectId,
      userId: session.userId,
    });
    const turnId = conversation?.currentTurnId;
    if (!turnId) {
      return;
    }

    const workspace = await this.deps.presence.read(session.conversationId);
    await this.deps.buffer().appendLocalWorkspace({
      conversationId: session.conversationId,
      turnId,
      entry: {
        state,
        name: workspace?.workspace.name ?? session.workspaceName,
        root: workspace?.workspace.root ?? "",
        hostname: session.hostname,
        ...(workspace?.workspace.gitBranch ? { gitBranch: workspace.workspace.gitBranch } : {}),
      },
    });
  }

  async onNudge(
    session: ControlSession,
    raw: string,
    send: (frame: PlatformFrame) => void,
  ): Promise<void> {
    const parsed = safeNudge(raw);
    if (!parsed) {
      return;
    }

    if ("call" in parsed) {
      const call = await this.deps.dispatcher.tryRead(parsed.call);
      if (!call || call.conversationId !== session.conversationId) {
        return;
      }

      // The channel is the conversation's, not this connection's, so a folder
      // that a newer one replaced still hears every call written for it.
      if (!(await this.deps.isCurrentConnection(session))) {
        return;
      }

      send({
        type: "call",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        call: this.deps.dispatcher.envelopeOf(call),
      });

      return;
    }

    if ("cancel" in parsed) {
      send({
        type: "cancel",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        callId: parsed.cancel,
      });

      return;
    }

    if ("permission" in parsed) {
      send({
        type: "permission",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        callId: parsed.permission.callId,
        decision: parsed.permission.decision,
      });

      return;
    }

    if ("policy" in parsed) {
      send({
        type: "policy",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        skipPermissions: parsed.policy.skipPermissions,
      });

      return;
    }

    send({
      type: "disconnect",
      protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
      reason: parsed.disconnect.reason,
    });
  }
}
