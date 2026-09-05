/**
 * The loop of a shared folder: a call arrives, the policy decides, the call
 * runs or the panel is asked, and the answer goes back on the same socket.
 *
 * Everything that decides is somewhere else. This module only sequences:
 * which call is waiting for which answer, which command is still running, and
 * what happens on Ctrl-C.
 */

import {
  LOCAL_CONTROL_PROTOCOL_VERSION,
  type BashOutput,
  type LocalCall,
  type LocalCallErrorCode,
  type LocalControlConversation,
  type LocalToolCall,
  type PermissionDecision,
  type TerminalPermissionDecision,
  type WorkspaceInfo,
} from "../../../agent/local-control-protocol";
import type { AgentTransport, SocketFactory } from "../../../agent/transport";
import {
  approvalCardFor,
  createTerminalApprovals,
  type ApprovalPrompt,
  type TerminalApproval,
} from "./approval";
import { failureCode, failureMessage } from "./errors";
import {
  startCommand,
  timeoutSecondsFor,
  type RunningCommand,
} from "./executor";
import {
  editFile,
  findFiles,
  grep,
  listDirectory,
  readFile,
  writeFile,
} from "./fs-ops";
import { decide } from "./policy";
import { RelayClient } from "./relay-client";
import { conversationLink, createUi, settledLine, type LangyUi } from "./ui";

/** How long a Ctrl-C waits for the running work to end before it exits anyway. */
export const SHUTDOWN_DEADLINE_MS = 5_000;

export interface LangySessionOptions {
  endpoint?: string;
  sessionKey: string;
  workspace: WorkspaceInfo;
  conversation: LocalControlConversation;
  ui?: LangyUi;
  socketFactory?: SocketFactory;
  transport?: AgentTransport;
  backoff?: { baseMs: number; maxMs: number };
  /** True when the folder is not a git repository, so the terminal says so. */
  withoutGit?: boolean;
  /**
   * How a permission ask is put to the developer in this terminal. Null means
   * this screen cannot ask, so the card in the panel is the only way to
   * answer. Left out, it is built from the terminal the UI writes on.
   */
  approvals?: ApprovalPrompt | null;
}

export interface LangySession {
  /** Resolves with the exit code once the session is finished. */
  done: Promise<number>;
  /** One Ctrl-C leaves cleanly; a second one exits at once. */
  requestShutdown: () => void;
  client: RelayClient;
}

/** A call that is waiting for an answer, from this terminal or from the card. */
interface PendingPermission {
  call: LocalCall;
  summary: string;
  /** Every pattern an "allow this pattern" answer grants for this call. */
  patterns: string[];
  /** Closes the selector when the card answered first. */
  closeSelector?: () => void;
}

export function startLangySession(options: LangySessionOptions): LangySession {
  const ui = options.ui ?? createUi();
  const approvals =
    options.approvals === undefined
      ? createTerminalApprovals({ writer: ui.writer })
      : options.approvals;
  const root = options.workspace.root;
  const grants = new Set<string>();
  const running = new Map<string, RunningCommand>();
  /** Every call this session took, so a replayed one is never taken twice. */
  const handled = new Set<string>();
  const pending = new Map<string, PendingPermission>();
  const background: Array<{ pid: number; logPath: string }> = [];
  /** Asks waiting for the selector, which draws one question at a time. */
  const askQueue: Array<{
    call: LocalCall;
    summary: string;
    reason: string;
    patterns: string[];
    timeoutSeconds?: number;
  }> = [];
  let selectorOpen = false;

  let skipPermissions = false;
  let announced = false;
  /** The absolute link the terminal points the developer at. */
  let conversationHref = conversationLink({
    url: options.conversation.url,
    endpoint: options.endpoint,
  });
  let shuttingDown = false;
  let finished = false;
  let settle: (code: number) => void = () => undefined;

  const done = new Promise<number>((resolve) => {
    settle = resolve;
  });

  const finish = (code: number) => {
    if (finished) return;
    finished = true;
    ui.backgroundKept(background);
    settle(code);
  };

  const sendResult = ({
    callId,
    text,
    output,
  }: {
    callId: string;
    text?: string;
    output?: BashOutput;
  }) => {
    client.forgetInFlight(callId);
    client.sendResult({
      type: "result",
      protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
      callId,
      ok: true,
      ...(text === undefined ? {} : { text }),
      ...(output === undefined ? {} : { output }),
    });
  };

  const sendFailure = ({
    callId,
    code,
    message,
  }: {
    callId: string;
    code: LocalCallErrorCode;
    message: string;
  }) => {
    client.forgetInFlight(callId);
    client.sendResult({
      type: "result",
      protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
      callId,
      ok: false,
      error: { code, message },
    });
  };

  /** Runs one call that the policy already allowed. */
  const execute = async (call: LocalCall): Promise<void> => {
    if (call.tool === "local_bash") {
      await executeCommand(call);
      return;
    }
    try {
      const text = runFileTool({ call, root });
      ui.callResult({ call, text });
      sendResult({ callId: call.callId, text });
    } catch (error) {
      ui.callFailed({ call, message: failureMessage(error) });
      sendFailure({
        callId: call.callId,
        code: failureCode(error),
        message: failureMessage(error),
      });
    }
  };

  const executeCommand = async (call: LocalCall): Promise<void> => {
    if (call.tool !== "local_bash") return;
    let command: RunningCommand;
    try {
      command = startCommand({
        command: call.params.command,
        root,
        callId: call.callId,
        ...(call.params.timeout === undefined
          ? {}
          : { timeout: call.params.timeout }),
        ...(call.params.background === true ? { background: true } : {}),
      });
    } catch (error) {
      ui.callFailed({ call, message: failureMessage(error) });
      sendFailure({
        callId: call.callId,
        code: failureCode(error),
        message: failureMessage(error),
      });
      return;
    }
    running.set(call.callId, command);
    const stopSpinner = ui.startRunning();
    try {
      const output = await command.result;
      if (call.params.background === true && output.pid !== undefined) {
        background.push({ pid: output.pid, logPath: output.logPath ?? "" });
      }
      stopSpinner();
      ui.callOutcome({ call, output });
      sendResult({ callId: call.callId, output });
    } catch (error) {
      stopSpinner();
      ui.callFailed({ call, message: failureMessage(error) });
      sendFailure({
        callId: call.callId,
        code: failureCode(error),
        message: failureMessage(error),
      });
    } finally {
      running.delete(call.callId);
    }
  };

  const onCall = (call: LocalCall): void => {
    // The platform replays the calls it has no answer for after a reconnect.
    // A call this session already took is running here or has already run, so
    // taking it again would run the same command a second time.
    if (handled.has(call.callId)) return;
    handled.add(call.callId);
    client.noteInFlight(call.callId);
    const decision = decide({
      call: call as LocalToolCall,
      root,
      grants,
      skipPermissions,
    });
    ui.call(call);
    if (decision.kind === "refuse") {
      ui.callRefused({ call, message: decision.message });
      sendFailure({
        callId: call.callId,
        code: decision.code,
        message: decision.message,
      });
      return;
    }
    if (decision.kind === "ask") {
      const timeoutSeconds =
        call.tool === "local_bash"
          ? timeoutSecondsFor(call.params.timeout)
          : undefined;
      pending.set(call.callId, {
        call,
        summary: decision.summary,
        patterns: decision.patterns,
      });
      client.send({
        type: "permission_required",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        callId: call.callId,
        summary: decision.summary,
        pattern: decision.pattern,
        reason: decision.reason,
        skipOffered: true,
        ...(decision.segments === undefined
          ? {}
          : { segments: decision.segments }),
        // Only a command runs under a time limit, so only a command carries one.
        ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
      });
      askInTerminal({
        call,
        summary: decision.summary,
        reason: decision.reason,
        patterns: decision.patterns,
        ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
      });
      return;
    }
    void execute(call);
  };

  /**
   * Puts the ask to this terminal as well as to the card.
   *
   * The transcript is held while the selector owns the bottom of the screen,
   * so a call that answers itself in the meantime does not scroll the box
   * away; the held lines are printed the moment the question is gone. Two
   * calls that both need an answer wait their turn rather than drawing two
   * boxes over each other, and one the card settled first never opens.
   */
  const askInTerminal = (ask: {
    call: LocalCall;
    summary: string;
    reason: string;
    patterns: string[];
    timeoutSeconds?: number;
  }): void => {
    if (!approvals) {
      ui.permissionAsked({ summary: ask.summary });
      return;
    }
    askQueue.push(ask);
    openNextAsk();
  };

  const openNextAsk = (): void => {
    if (selectorOpen || !approvals) return;
    const ask = askQueue.shift();
    if (!ask) return;
    const waiting = pending.get(ask.call.callId);
    if (!waiting) {
      openNextAsk();
      return;
    }
    selectorOpen = true;
    const open = approvals(
      approvalCardFor({
        call: ask.call,
        workspaceName: options.workspace.name,
        summary: ask.summary,
        reason: ask.reason,
        patterns: ask.patterns,
        ...(ask.timeoutSeconds === undefined
          ? {}
          : { timeoutSeconds: ask.timeoutSeconds }),
      }),
    );
    waiting.closeSelector = open.close;
    ui.hold();
    void open.answer.then((answer) => {
      selectorOpen = false;
      ui.release();
      // A null answer is the card getting there first: `onPermission` has
      // already settled the call.
      if (answer) applyTerminalAnswer({ callId: ask.call.callId, answer });
      openNextAsk();
    });
  };

  /** The developer answered here, so the call is settled here and the platform told. */
  const applyTerminalAnswer = ({
    callId,
    answer,
  }: {
    callId: string;
    answer: TerminalApproval;
  }): void => {
    const waiting = pending.get(callId);
    if (!waiting) return;
    pending.delete(callId);
    const decision: TerminalPermissionDecision = answer.decision;
    client.send({
      type: "permission_answered",
      protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
      callId,
      decision,
      ...(decision === "allow_pattern" ? { patterns: waiting.patterns } : {}),
    });
    ui.permissionSettled({
      call: waiting.call,
      text: settledLine({
        decision,
        patterns: waiting.patterns,
        source: "terminal",
        ...(answer.reason === undefined ? {} : { reason: answer.reason }),
      }),
    });
    if (decision === "allow_pattern") {
      for (const pattern of waiting.patterns) grants.add(pattern);
    }
    if (decision === "allow_once" || decision === "allow_pattern") {
      void execute(waiting.call);
      return;
    }
    sendFailure({
      callId,
      code: "permission_denied",
      message: denialMessage({
        summary: waiting.summary,
        ...(answer.reason === undefined ? {} : { reason: answer.reason }),
      }),
    });
  };

  const onPermission = ({
    callId,
    decision,
  }: {
    callId: string;
    decision: string;
  }): void => {
    const waiting = pending.get(callId);
    // The terminal already answered, so the call has run or been refused and
    // the card is only reporting what it settled on.
    if (!waiting) return;
    pending.delete(callId);
    waiting.closeSelector?.();
    ui.release();
    ui.permissionSettled({
      call: waiting.call,
      text: settledLine({
        decision: decision as PermissionDecision,
        patterns: waiting.patterns,
        source: "panel",
      }),
    });
    if (decision === "allow_pattern") {
      for (const pattern of waiting.patterns) grants.add(pattern);
    }
    if (decision === "allow_once" || decision === "allow_pattern") {
      void execute(waiting.call);
      return;
    }
    sendFailure({
      callId,
      code: decision === "expired" ? "permission_expired" : "permission_denied",
      message:
        decision === "expired"
          ? `No answer arrived for ${waiting.summary}. Say what you need and end the turn; the next message will ask again.`
          : denialMessage({ summary: waiting.summary }),
    });
  };

  /**
   * Everything this session is holding, let go of: the questions on the
   * screen, the questions waiting for one, and the commands still running in
   * the folder.
   *
   * A folder stops being shared in four ways, and only Ctrl-C used to clear
   * the work. A disconnect from the panel closed the socket and left the
   * commands it had started running, writing files and reaching the network
   * long after the panel said the folder was gone.
   */
  const stopEverything = (): void => {
    askQueue.length = 0;
    for (const [callId, waiting] of pending) {
      waiting.closeSelector?.();
      ui.permissionSettled({
        call: waiting.call,
        text: "The folder stopped being shared, so this question was dropped.",
      });
      client.forgetInFlight(callId);
    }
    pending.clear();
    ui.release();
    for (const command of running.values()) command.cancel();
    running.clear();
  };

  const onCancel = (callId: string): void => {
    const command = running.get(callId);
    if (command) {
      command.cancel();
      running.delete(callId);
    }
    pending.get(callId)?.closeSelector?.();
    pending.delete(callId);
    client.forgetInFlight(callId);
  };

  const client = new RelayClient({
    ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
    sessionKey: options.sessionKey,
    workspace: options.workspace,
    ...(options.transport === undefined ? {} : { transport: options.transport }),
    ...(options.socketFactory === undefined
      ? {}
      : { socketFactory: options.socketFactory }),
    ...(options.backoff === undefined ? {} : { backoff: options.backoff }),
    handlers: {
      onRegistered: (frame) => {
        skipPermissions = frame.policy.skipPermissions;
        if (announced) {
          ui.reconnected();
          return;
        }
        announced = true;
        conversationHref = conversationLink({
          url: frame.conversation.url || options.conversation.url,
          endpoint: options.endpoint,
        });
        ui.connected({
          root,
          conversationTitle:
            frame.conversation.title || options.conversation.title,
          conversationUrl: conversationHref,
        });
        if (options.withoutGit === true) ui.noGitRepository();
      },
      onCall,
      onCancel,
      onPermission,
      onPolicy: ({ skipPermissions: next }) => {
        skipPermissions = next;
        ui.policyChanged({ skipPermissions: next });
      },
      onDisconnect: ({ reason }) => {
        stopEverything();
        ui.disconnected({ reason });
        client.stopNow();
        finish(0);
      },
      onRefused: (frame) => {
        stopEverything();
        ui.note(frame.message);
        finish(1);
      },
      onGaveUp: ({ reason }) => {
        stopEverything();
        ui.note(reason);
        finish(1);
      },
      onConnectionLost: ({ message }) => ui.connectionLost({ message }),
    },
  });

  /**
   * The first Ctrl-C tells the platform, stops the commands it started in the
   * foreground and exits inside the deadline. A second one exits at once.
   */
  const requestShutdown = (): void => {
    if (shuttingDown) {
      finish(130);
      return;
    }
    shuttingDown = true;
    stopEverything();
    ui.leaving();
    const deadline = setTimeout(() => finish(0), SHUTDOWN_DEADLINE_MS);
    deadline.unref();
    void client.stop().then(() => {
      clearTimeout(deadline);
      finish(0);
    });
  };

  client.start();
  return { done, requestShutdown, client };
}

/**
 * What Langy is told when the developer says no.
 *
 * The frame carries no reason, so the reason travels in the call result the
 * CLI writes itself. With nothing typed, the refusal still says who refused.
 */
function denialMessage({
  summary,
  reason,
}: {
  summary: string;
  reason?: string;
}): string {
  if (reason === undefined || reason === "") {
    return `The developer denied ${summary}. Do not run it again in this turn; say what you needed it for.`;
  }
  return `The developer denied ${summary} and said: ${reason}. Do that instead, and do not run the command again in this turn.`;
}

/** One file tool, as its text answer. */
function runFileTool({
  call,
  root,
}: {
  call: LocalCall;
  root: string;
}): string {
  switch (call.tool) {
    case "local_read":
      return readFile({ params: call.params, root });
    case "local_write":
      return writeFile({ params: call.params, root });
    case "local_edit":
      return editFile({ params: call.params, root });
    case "local_grep":
      return grep({ params: call.params, root });
    case "local_find":
      return findFiles({ params: call.params, root });
    case "local_ls":
      return listDirectory({ params: call.params, root });
    case "local_bash":
      throw new Error("a command is not a file tool");
  }
}
