/**
 * The loop of a shared folder: a call arrives, the policy decides, the call
 * runs or the panel is asked, and the answer goes back on the same socket.
 * Everything that decides is elsewhere — this module only sequences.
 */

import {
  LOCAL_CONTROL_PROTOCOL_VERSION,
  type BashOutput,
  type LocalCall,
  type LocalCallErrorCode,
  type LocalControlConversation,
  type LocalRegisteredFrame,
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
import { failureCode, failureMessage, LocalCallFailure } from "./errors";
import { startCommand, timeoutSecondsFor, type RunningCommand } from "./executor";
import {
  editFile,
  findFiles,
  grep,
  listDirectory,
  readFile,
  writeFile,
  writeLangwatchEnv,
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
  /** The project the conversation belongs to, named in the credentials call. */
  project?: { id: string; name: string };
  /**
   * Fetches the project's ingest key with the developer's own login, so the
   * write is gated on what this person may do, never on what Langy may. A
   * rejection carrying a 401 or 403 status is reported as `key_refused`.
   */
  readProjectApiKey?: (projectId: string) => Promise<string>;
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
  const session = new SharedFolderSession(options);
  session.client.start();
  return {
    done: session.done,
    requestShutdown: () => session.requestShutdown(),
    client: session.client,
  };
}

/** An ask waiting for the selector, which draws one question at a time. */
interface TerminalAsk {
  call: LocalCall;
  summary: string;
  reason: string;
  patterns: string[];
  timeoutSeconds?: number;
}

/** One shared folder's loop: the calls it took, the asks it holds, the commands it runs. */
class SharedFolderSession {
  readonly client: RelayClient;
  readonly done: Promise<number>;
  private readonly options: LangySessionOptions;
  private readonly ui: LangyUi;
  private readonly approvals: ApprovalPrompt | null;
  private readonly root: string;
  private readonly grants = new Set<string>();
  private readonly running = new Map<string, RunningCommand>();
  /** Every call this session took, so a replayed one is never taken twice. */
  private readonly handled = new Set<string>();
  private readonly pending = new Map<string, PendingPermission>();
  private readonly background: { pid: number; logPath: string }[] = [];
  private readonly askQueue: TerminalAsk[] = [];
  private selectorOpen = false;
  private skipPermissions = false;
  private announced = false;
  /** The absolute link the terminal points the developer at. */
  private conversationHref: string;
  private shuttingDown = false;
  private finished = false;
  private settle: (code: number) => void = () => undefined;

  constructor(options: LangySessionOptions) {
    this.options = options;
    this.ui = options.ui ?? createUi();
    this.approvals =
      options.approvals === undefined
        ? createTerminalApprovals({ writer: this.ui.writer })
        : options.approvals;
    this.root = options.workspace.root;
    this.conversationHref = conversationLink({
      url: options.conversation.url,
      endpoint: options.endpoint,
    });
    this.done = new Promise<number>((resolve) => {
      this.settle = resolve;
    });
    this.client = new RelayClient({
      ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
      sessionKey: options.sessionKey,
      workspace: options.workspace,
      ...(options.transport === undefined ? {} : { transport: options.transport }),
      ...(options.socketFactory === undefined ? {} : { socketFactory: options.socketFactory }),
      ...(options.backoff === undefined ? {} : { backoff: options.backoff }),
      handlers: {
        onRegistered: (frame) => this.onRegistered(frame),
        onCall: (call) => this.onCall(call),
        onCancel: (callId) => this.onCancel(callId),
        onPermission: (frame) => this.onPermission(frame),
        onPolicy: ({ skipPermissions: next }) => {
          this.skipPermissions = next;
          this.ui.policyChanged({ skipPermissions: next });
        },
        onDisconnect: ({ reason }) => {
          this.stopEverything();
          this.ui.disconnected({ reason });
          this.client.stopNow();
          this.finish(0);
        },
        onRefused: (frame) => this.stopAndFinish({ note: frame.message, code: 1 }),
        onGaveUp: ({ reason }) => this.stopAndFinish({ note: reason, code: 1 }),
        onConnectionLost: ({ message }) => this.ui.connectionLost({ message }),
      },
    });
  }

  /**
   * The first Ctrl-C tells the platform, stops the commands it started in the
   * foreground and exits inside the deadline. A second one exits at once.
   */
  requestShutdown(): void {
    if (this.shuttingDown) {
      this.finish(130);
      return;
    }
    this.shuttingDown = true;
    this.stopEverything();
    this.ui.leaving();
    const deadline = setTimeout(() => this.finish(0), SHUTDOWN_DEADLINE_MS);
    deadline.unref();
    void this.client.stop().then(() => {
      clearTimeout(deadline);
      this.finish(0);
    });
  }

  private finish(code: number): void {
    if (this.finished) return;
    this.finished = true;
    this.ui.backgroundKept(this.background);
    this.settle(code);
  }

  private stopAndFinish({ note, code }: { note: string; code: number }): void {
    this.stopEverything();
    this.ui.note(note);
    this.finish(code);
  }

  private onRegistered(frame: LocalRegisteredFrame): void {
    this.skipPermissions = frame.policy.skipPermissions;
    if (this.announced) {
      this.ui.reconnected();
      return;
    }
    this.announced = true;
    const { options } = this;
    this.conversationHref = conversationLink({
      url: frame.conversation.url || options.conversation.url,
      endpoint: options.endpoint,
    });
    this.ui.connected({
      root: this.root,
      conversationTitle: frame.conversation.title || options.conversation.title,
      conversationUrl: this.conversationHref,
    });
    if (options.withoutGit === true) this.ui.noGitRepository();
  }

  private sendResult({
    callId,
    text,
    output,
  }: {
    callId: string;
    text?: string;
    output?: BashOutput;
  }): void {
    this.client.forgetInFlight(callId);
    this.client.sendResult({
      type: "result",
      protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
      callId,
      ok: true,
      ...(text === undefined ? {} : { text }),
      ...(output === undefined ? {} : { output }),
    });
  }

  private sendFailure({
    callId,
    code,
    message,
  }: {
    callId: string;
    code: LocalCallErrorCode;
    message: string;
  }): void {
    this.client.forgetInFlight(callId);
    this.client.sendResult({
      type: "result",
      protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
      callId,
      ok: false,
      error: { code, message },
    });
  }

  /** A call that threw, shown here and answered as failed. */
  private failCall(call: LocalCall, error: unknown): void {
    this.ui.callFailed({ call, message: failureMessage(error) });
    this.sendFailure({
      callId: call.callId,
      code: failureCode(error),
      message: failureMessage(error),
    });
  }

  /** Runs one call that the policy already allowed. */
  private async execute(call: LocalCall): Promise<void> {
    if (call.tool === "local_bash") {
      await this.executeCommand(call);
      return;
    }
    try {
      const text =
        call.tool === "local_langwatch_env"
          ? await this.writeCredentials(call)
          : runFileTool({ call, root: this.root });
      this.ui.callResult({ call, text });
      this.sendResult({ callId: call.callId, text });
    } catch (error) {
      this.failCall(call, error);
    }
  }

  /**
   * The project's key, fetched here and written here. It goes into the file
   * and nowhere else: not the result, not the terminal, not the panel.
   */
  private async writeCredentials(call: LocalCall): Promise<string> {
    if (call.tool !== "local_langwatch_env") return "";
    const { project, readProjectApiKey, endpoint } = this.options;
    const file = call.params.path ?? ".env";
    if (!project || !readProjectApiKey || !endpoint) {
      throw new LocalCallFailure({
        code: "exec_failed",
        message: `This terminal cannot fetch the project's key. Tell the user in one line that LANGWATCH_API_KEY and LANGWATCH_ENDPOINT must be added to ${file} by hand, from the project's settings page, and end your turn.`,
      });
    }
    const apiKey = await readKeyOrRefuse({ readProjectApiKey, project, file });
    return writeLangwatchEnv({
      params: call.params,
      root: this.root,
      apiKey,
      endpoint,
      projectName: project.name,
    });
  }

  private async executeCommand(call: LocalCall): Promise<void> {
    if (call.tool !== "local_bash") return;
    let command: RunningCommand;
    try {
      command = startCommand({
        command: call.params.command,
        root: this.root,
        callId: call.callId,
        ...(call.params.timeout === undefined ? {} : { timeout: call.params.timeout }),
        ...(call.params.background === true ? { background: true } : {}),
      });
    } catch (error) {
      this.failCall(call, error);
      return;
    }
    this.running.set(call.callId, command);
    const stopSpinner = this.ui.startRunning();
    try {
      const output = await command.result;
      if (call.params.background === true && output.pid !== undefined) {
        this.background.push({ pid: output.pid, logPath: output.logPath ?? "" });
      }
      stopSpinner();
      this.ui.callOutcome({ call, output });
      this.sendResult({ callId: call.callId, output });
    } catch (error) {
      stopSpinner();
      this.failCall(call, error);
    } finally {
      this.running.delete(call.callId);
    }
  }

  private onCall(call: LocalCall): void {
    // The platform replays the calls it has no answer for after a reconnect.
    // A call this session already took is running here or has already run;
    // one that ran is answered again, since its answer may have been lost.
    if (this.handled.has(call.callId)) {
      this.client.resendResult(call.callId);
      return;
    }
    this.handled.add(call.callId);
    this.client.noteInFlight(call.callId);
    const decision = decide({
      call: call as LocalToolCall,
      root: this.root,
      grants: this.grants,
      skipPermissions: this.skipPermissions,
    });
    this.ui.call(call);
    if (decision.kind === "refuse") {
      this.ui.callRefused({ call, message: decision.message });
      this.sendFailure({ callId: call.callId, code: decision.code, message: decision.message });
      return;
    }
    if (decision.kind === "ask") {
      this.askPermission({ call, decision });
      return;
    }
    void this.execute(call);
  }

  private askPermission({
    call,
    decision,
  }: {
    call: LocalCall;
    decision: Extract<ReturnType<typeof decide>, { kind: "ask" }>;
  }): void {
    const timeoutSeconds =
      call.tool === "local_bash" ? timeoutSecondsFor(call.params.timeout) : undefined;
    this.pending.set(call.callId, {
      call,
      summary: decision.summary,
      patterns: decision.patterns,
    });
    this.client.send({
      type: "permission_required",
      protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
      callId: call.callId,
      summary: decision.summary,
      pattern: decision.pattern,
      reason: decision.reason,
      skipOffered: true,
      ...(decision.segments === undefined ? {} : { segments: decision.segments }),
      // Only a command runs under a time limit, so only a command carries one.
      ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
    });
    this.askInTerminal({
      call,
      summary: decision.summary,
      reason: decision.reason,
      patterns: decision.patterns,
      ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
    });
  }

  /**
   * Puts the ask to this terminal as well as to the card. The transcript is
   * held while the selector owns the screen so it isn't scrolled away; two
   * calls needing an answer wait their turn rather than drawing two boxes.
   */
  private askInTerminal(ask: TerminalAsk): void {
    if (!this.approvals) {
      this.ui.permissionAsked({ summary: ask.summary });
      return;
    }
    this.askQueue.push(ask);
    this.openNextAsk();
  }

  private openNextAsk(): void {
    if (this.selectorOpen || !this.approvals) return;
    const ask = this.askQueue.shift();
    if (!ask) return;
    const waiting = this.pending.get(ask.call.callId);
    if (!waiting) {
      this.openNextAsk();
      return;
    }
    this.selectorOpen = true;
    const open = this.approvals(
      approvalCardFor({
        call: ask.call,
        workspaceName: this.options.workspace.name,
        summary: ask.summary,
        reason: ask.reason,
        patterns: ask.patterns,
        ...(ask.timeoutSeconds === undefined ? {} : { timeoutSeconds: ask.timeoutSeconds }),
      }),
    );
    waiting.closeSelector = open.close;
    this.ui.hold();
    void open.answer.then((answer) => {
      this.selectorOpen = false;
      this.ui.release();
      // A null answer is the card getting there first: `onPermission` has
      // already settled the call.
      if (answer) this.applyTerminalAnswer({ callId: ask.call.callId, answer });
      this.openNextAsk();
    });
  }

  /** The developer answered here, so the call is settled here and the platform told. */
  private applyTerminalAnswer({
    callId,
    answer,
  }: {
    callId: string;
    answer: TerminalApproval;
  }): void {
    const waiting = this.pending.get(callId);
    if (!waiting) return;
    this.pending.delete(callId);
    const decision: TerminalPermissionDecision = answer.decision;
    this.client.send({
      type: "permission_answered",
      protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
      callId,
      decision,
      ...(decision === "allow_pattern" ? { patterns: waiting.patterns } : {}),
    });
    this.ui.permissionSettled({
      call: waiting.call,
      text: settledLine({
        decision,
        patterns: waiting.patterns,
        source: "terminal",
        ...(answer.reason === undefined ? {} : { reason: answer.reason }),
      }),
    });
    if (this.runIfAllowed({ waiting, decision })) return;
    this.sendFailure({
      callId,
      code: "permission_denied",
      message: denialMessage({
        summary: waiting.summary,
        ...(answer.reason === undefined ? {} : { reason: answer.reason }),
      }),
    });
  }

  private onPermission({ callId, decision }: { callId: string; decision: string }): void {
    const waiting = this.pending.get(callId);
    // The terminal already answered, so the call has run or been refused and
    // the card is only reporting what it settled on.
    if (!waiting) return;
    this.pending.delete(callId);
    waiting.closeSelector?.();
    this.ui.release();
    this.ui.permissionSettled({
      call: waiting.call,
      text: settledLine({
        decision: decision as PermissionDecision,
        patterns: waiting.patterns,
        source: "panel",
      }),
    });
    if (this.runIfAllowed({ waiting, decision })) return;
    this.sendFailure({
      callId,
      code: decision === "expired" ? "permission_expired" : "permission_denied",
      message:
        decision === "expired"
          ? `No answer arrived for ${waiting.summary}. Say what you need and end the turn; the next message will ask again.`
          : denialMessage({ summary: waiting.summary }),
    });
  }

  /** Whether the answer allowed the call; an allowed one is granted and run. */
  private runIfAllowed({
    waiting,
    decision,
  }: {
    waiting: PendingPermission;
    decision: string;
  }): boolean {
    if (decision === "allow_pattern") {
      for (const pattern of waiting.patterns) this.grants.add(pattern);
    }
    if (decision !== "allow_once" && decision !== "allow_pattern") return false;
    void this.execute(waiting.call);
    return true;
  }

  /**
   * Everything this session is holding, let go of: the questions on the
   * screen, the questions waiting for one, and the commands still running
   * in the folder. A folder stops being shared in four ways, all of them.
   */
  private stopEverything(): void {
    this.askQueue.length = 0;
    for (const [callId, waiting] of this.pending) {
      waiting.closeSelector?.();
      this.ui.permissionSettled({
        call: waiting.call,
        text: "The folder stopped being shared, so this question was dropped.",
      });
      this.client.forgetInFlight(callId);
    }
    this.pending.clear();
    this.ui.release();
    for (const command of this.running.values()) command.cancel();
    this.running.clear();
  }

  private onCancel(callId: string): void {
    const command = this.running.get(callId);
    if (command) {
      command.cancel();
      this.running.delete(callId);
    }
    this.pending.get(callId)?.closeSelector?.();
    this.pending.delete(callId);
    this.client.forgetInFlight(callId);
  }
}

/** The project's key with the developer's own login; a 401 or 403 is `key_refused`. */
async function readKeyOrRefuse({
  readProjectApiKey,
  project,
  file,
}: {
  readProjectApiKey: (projectId: string) => Promise<string>;
  project: { id: string; name: string };
  file: string;
}): Promise<string> {
  try {
    return await readProjectApiKey(project.id);
  } catch (error) {
    const status = refusalStatus(error);
    if (status === 401 || status === 403) {
      throw new LocalCallFailure({
        code: "key_refused",
        message: `LangWatch did not hand out the project's key to this login: it needs project:update on ${project.name}. Tell the user in one line that LANGWATCH_API_KEY and LANGWATCH_ENDPOINT must be added to ${file} by hand, from the project's settings page, and end your turn.`,
      });
    }
    throw new LocalCallFailure({
      code: "exec_failed",
      message: `LangWatch did not answer the request for the project's key. Tell the user in one line that LANGWATCH_API_KEY and LANGWATCH_ENDPOINT must be added to ${file} by hand, from the project's settings page, and end your turn.`,
    });
  }
}

/**
 * What Langy is told when the developer says no. The frame carries no
 * reason, so it travels in the call result the CLI writes itself.
 */
function denialMessage({ summary, reason }: { summary: string; reason?: string }): string {
  if (reason === undefined || reason === "") {
    return `The developer denied ${summary}. Do not run it again in this turn; say what you needed it for.`;
  }
  return `The developer denied ${summary} and said: ${reason}. Do that instead, and do not run the command again in this turn.`;
}

/** One file tool, as its text answer. */
function runFileTool({ call, root }: { call: LocalCall; root: string }): string {
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
    case "local_langwatch_env":
      throw new Error("the credentials call is not a file tool");
    case "local_bash":
      throw new Error("a command is not a file tool");
  }
}

/** The HTTP status a rejected key request carries, whichever client threw it. */
function refusalStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { status, httpStatus } = error as {
    status?: unknown;
    httpStatus?: unknown;
  };
  if (typeof status === "number") return status;
  if (typeof httpStatus === "number") return httpStatus;
  return undefined;
}
