/**
 * What the command line says while a call is in flight: it started, it finished, it needs a
 * permission answer, it got one. A frame from a connection that is no longer the current one
 * is ignored rather than acted on — the folder reconnected, and this socket is stale.
 */
import { createLogger } from "@langwatch/observability";
import type { LocalCallDispatcherService } from "./langy-local-call-dispatcher.service.ts";
import type { UserWaitService } from "./langy-local-user-wait.service.ts";
import {
  LangyWaitExpiredError,
  type PermissionAnsweredFrame,
  type PermissionRequiredFrame,
  type ResultFrame,
} from "@langwatch/langy-contract";
import { grantedPatterns } from "../rules/langy-local-session-text.rules.ts";
import type {
  ControlConversations,
  ControlSession,
  ControlSkipGate,
} from "../rules/langy-local-session-contract.rules.ts";

const logger = createLogger("langwatch:langy:local-control:session");

type LocalControlFramesOptions = {
  conversations: () => ControlConversations;
  dispatcher: LocalCallDispatcherService;
  waits: UserWaitService;
  skipGate: ControlSkipGate;
  /** The core's own staleness check, so both seams answer it the same way. */
  isCurrentConnection: (session: ControlSession) => Promise<boolean>;
};

export class LocalControlFramesService {
  static create(deps: LocalControlFramesOptions): LocalControlFramesService {
    return new LocalControlFramesService(deps);
  }

  private constructor(private readonly deps: LocalControlFramesOptions) {}

  /** The command line started the call. */
  async ack(session: ControlSession, callId: string): Promise<void> {
    const call = await this.deps.dispatcher.tryRead(callId);
    if (call?.conversationId !== session.conversationId) {
      return;
    }

    if (!(await this.deps.isCurrentConnection(session))) {
      return;
    }

    await this.deps.dispatcher.ack(callId);
  }

  /**
   * The command line answered the call. A result for a call that already
   * ended is a quiet no-op, not an error — a resend after a dropped socket.
   */
  async result(session: ControlSession, frame: ResultFrame): Promise<void> {
    const call = await this.deps.dispatcher.tryRead(frame.callId);
    if (call?.conversationId !== session.conversationId) {
      return;
    }

    // A folder that was replaced must not answer the folder that replaced it.
    if (!(await this.deps.isCurrentConnection(session))) {
      logger.info(
        { callId: frame.callId, conversationId: session.conversationId },
        "a result arrived from a connection a newer folder replaced, refused",
      );

      return;
    }

    await this.deps.dispatcher.result({ callId: frame.callId, frame });
  }

  /** The command line needs the developer's answer before it runs the call. */
  async permissionRequired(session: ControlSession, frame: PermissionRequiredFrame): Promise<void> {
    const call = await this.deps.dispatcher.tryRead(frame.callId);
    if (!call || call.conversationId !== session.conversationId) {
      return;
    }

    const wait = await this.deps.waits.startPermission({
      projectId: call.projectId,
      conversationId: call.conversationId,
      turnId: call.turnId,
      ...(call.toolCallId ? { toolCallId: call.toolCallId } : {}),
      callId: call.callId,
      summary: frame.summary,
      pattern: frame.pattern,
      patterns: grantedPatterns(frame),
      reason: frame.reason,
      ...(frame.timeoutSeconds === undefined ? {} : { timeoutSeconds: frame.timeoutSeconds }),
      // The command line always offers the switch; whether the card may show
      // it is the platform's answer, and it is the model that decides.
      skipOffered: frame.skipOffered && (await this.maySkip(session)),
      workspaceName: session.workspaceName,
      hostname: session.hostname,
    });
    await this.deps.dispatcher.tryAwaitPermission({
      callId: call.callId,
      waitId: wait.waitId,
    });
  }

  /**
   * The developer answered in the terminal instead of on the card. Only
   * settles the wait — the command line already applied the answer. First
   * answer wins; an already-settled wait ignores this frame.
   */
  async permissionAnswered(session: ControlSession, frame: PermissionAnsweredFrame): Promise<void> {
    const call = await this.deps.dispatcher.tryRead(frame.callId);
    if (!call || call.conversationId !== session.conversationId) {
      return;
    }

    if (!call.waitId) {
      return;
    }

    if (!(await this.deps.isCurrentConnection(session))) {
      return;
    }

    try {
      await this.deps.waits.answer({
        waitId: call.waitId,
        userId: session.userId,
        decision: frame.decision,
        source: "terminal",
        ...(frame.patterns ? { patterns: frame.patterns } : {}),
      });
    } catch (error) {
      if (LangyWaitExpiredError.is(error)) {
        logger.info(
          { callId: frame.callId, conversationId: session.conversationId },
          "the terminal answered a permission card that had already settled",
        );

        return;
      }

      throw error;
    }
  }

  /**
   * Whether the conversation's model is allowed to skip permission cards. An
   * unresolvable model, or no turn run yet, answers no.
   */
  async maySkip(session: ControlSession): Promise<boolean> {
    const conversation = await this.deps.conversations().findByIdVisible({
      id: session.conversationId,
      projectId: session.projectId,
      userId: session.userId,
    });
    const model = conversation?.lastModel;
    if (!model) {
      return false;
    }

    const decision = await this.deps.skipGate({
      projectId: session.projectId,
      model,
    });

    return decision.allowed;
  }

  /** Calls written for this folder while its socket was away. */
}
