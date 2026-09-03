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
  type WorkspaceInfo,
} from "../../../agent/local-control-protocol";
import type { AgentTransport, SocketFactory } from "../../../agent/transport";
import { failureCode, failureMessage } from "./errors";
import { startCommand, type RunningCommand } from "./executor";
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
import {
  conversationLink,
  commandOutcome,
  createUi,
  type LangyUi,
} from "./ui";

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
}

export interface LangySession {
  /** Resolves with the exit code once the session is finished. */
  done: Promise<number>;
  /** One Ctrl-C leaves cleanly; a second one exits at once. */
  requestShutdown: () => void;
  client: RelayClient;
}

/** A call the panel is being asked about. */
interface PendingPermission {
  call: LocalCall;
  summary: string;
  pattern: string;
}

export function startLangySession(options: LangySessionOptions): LangySession {
  const ui = options.ui ?? createUi();
  const root = options.workspace.root;
  const grants = new Set<string>();
  const running = new Map<string, RunningCommand>();
  const pending = new Map<string, PendingPermission>();
  const background: Array<{ pid: number; logPath: string }> = [];

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
    client.send({
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
    client.send({
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
      ui.call(call);
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
    try {
      const output = await command.result;
      if (call.params.background === true && output.pid !== undefined) {
        background.push({ pid: output.pid, logPath: output.logPath ?? "" });
      }
      ui.callOutcome({ call, outcome: commandOutcome(output) });
      sendResult({ callId: call.callId, output });
    } catch (error) {
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
    client.noteInFlight(call.callId);
    const decision = decide({
      call: call as LocalToolCall,
      root,
      grants,
      skipPermissions,
    });
    if (decision.kind === "refuse") {
      ui.callFailed({ call, message: decision.message });
      sendFailure({
        callId: call.callId,
        code: decision.code,
        message: decision.message,
      });
      return;
    }
    if (decision.kind === "ask") {
      pending.set(call.callId, {
        call,
        summary: decision.summary,
        pattern: decision.pattern,
      });
      client.send({
        type: "permission_required",
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        callId: call.callId,
        summary: decision.summary,
        pattern: decision.pattern,
        reason: decision.reason,
        skipOffered: true,
      });
      ui.permissionAsked({
        summary: decision.summary,
        conversationUrl: conversationHref,
      });
      return;
    }
    void execute(call);
  };

  const onPermission = ({
    callId,
    decision,
  }: {
    callId: string;
    decision: string;
  }): void => {
    const waiting = pending.get(callId);
    if (!waiting) return;
    pending.delete(callId);
    ui.permissionAnswered({
      summary: waiting.summary,
      decision: decision as PermissionDecision,
    });
    if (decision === "allow_pattern") grants.add(waiting.pattern);
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
          : `The developer denied ${waiting.summary}. Do not run it again in this turn; say what you needed it for.`,
    });
  };

  const onCancel = (callId: string): void => {
    const command = running.get(callId);
    if (command) {
      command.cancel();
      running.delete(callId);
    }
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
        ui.disconnected({ reason });
        client.stopNow();
        finish(0);
      },
      onRefused: (frame) => {
        ui.note(frame.message);
        finish(1);
      },
      onGaveUp: ({ reason }) => {
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
    ui.leaving();
    for (const command of running.values()) command.cancel();
    running.clear();
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
