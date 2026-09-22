/**
 * The local workspace tools: `code_access`, the `local_*` mirrors of pi's
 * built-ins and the credentials call (ADR-129), posted to the app and
 * answered from `langwatch langy --share-control` on a long poll.
 */

import {
  createBashTool,
  type ExtensionAPI,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { callIds, conversationId, type TurnContext } from "./turn-context.js";

export const CODE_ACCESS_TOOL_NAME = "code_access";

/**
 * The shell the model reaches for by its standard name, registered in
 * place of pi's built-in: while the folder is connected a command lands
 * there through local_bash, but `langwatch` still runs here.
 */
export const BASH_TOOL_NAME = "bash";

/**
 * The result details of a call that ran in the developer's folder: the
 * event mapper lifts it onto tool_end as `local: true`, so the GitHub gate
 * and install card stand down (their own credentials ran the call).
 */
export const LOCAL_RESULT_DETAILS = { local: true } as const;

/** Did this pi tool result come from a call that ran in the developer's folder? */
export function ranInFolder(result: unknown): boolean {
  if (typeof result !== "object" || result === null) return false;
  const details = (result as { details?: unknown }).details;
  if (typeof details !== "object" || details === null) return false;
  return (details as { local?: unknown }).local === true;
}

/**
 * Is this command an invocation of the langwatch CLI (leading env
 * assignments skipped, `npx langwatch` counts)? It always runs in the
 * sandbox: its cards and login belong to this conversation.
 */
export function isLangwatchCliCommand(command: string): boolean {
  const words = command.trim().split(/\s+/);
  let index = 0;
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] ?? "")) {
    index += 1;
  }
  const head = words[index];
  const next = words[index + 1] ?? "";
  if (head === "langwatch") return true;
  return head === "npx" && (next === "langwatch" || next.startsWith("langwatch@"));
}

export const LOCAL_TOOL_NAMES = [
  "local_read",
  "local_write",
  "local_edit",
  "local_bash",
  "local_grep",
  "local_find",
  "local_ls",
  "local_langwatch_env",
] as const;
export type LocalToolName = (typeof LOCAL_TOOL_NAMES)[number];

/**
 * pi's own file tools, withdrawn while the folder is connected: a model
 * offered both sets picks the sandbox one often enough. `bash` stays.
 */
export const SANDBOX_FILE_TOOL_NAMES = ["read", "edit", "write", "grep", "find", "ls"] as const;

/**
 * The turn's tool set, given the folder's state: the sandbox file tools are
 * out while a folder is connected and back when none is. Every other tool,
 * `bash` and the `local_*` mirrors included, is kept as it stands.
 */
export function activeToolsFor({
  connected,
  active,
}: {
  connected: boolean;
  active: readonly string[];
}): string[] {
  const sandbox = new Set<string>(SANDBOX_FILE_TOOL_NAMES);
  if (connected) return active.filter((name) => !sandbox.has(name));
  const present = new Set(active);
  return [...active, ...SANDBOX_FILE_TOOL_NAMES.filter((name) => !present.has(name))];
}

/** How long one long poll may take. The app holds each poll up to 20 s. */
const POLL_REQUEST_TIMEOUT_MS = 40_000;

/** How long a plain request may take. */
const REQUEST_TIMEOUT_MS = 20_000;

/** Wait this long after a failed poll before the next one. */
const POLL_RETRY_DELAY_MS = 1_000;

/** Give up on the folder after this many failed polls in a row. */
const MAX_POLL_FAILURES = 3;

/** The longest a single local call may wait for its answer. */
const CALL_MAX_WAIT_MS = 20 * 60 * 1000;

/**
 * What the model reads when the folder is not there; names both ways on,
 * so the user is left with something to do next.
 */
export const OFFLINE_PUSHBACK = [
  "The shared folder is not connected any more, so this call did not run.",
  "Tell the user in one line what is not done, then give them the two ways on:",
  "they can run `npx langwatch@latest langy --share-control` in the folder again,",
  "or they can work through GitHub, which you offer by calling `code_access`.",
  "End your turn with that offer.",
].join(" ");

/**
 * What the model reads when LangWatch lost the call and the folder is
 * still there: a "not found" poll means the app dropped the envelope, not
 * that the machine went away, so re-sharing is not the fix.
 */
export const CALL_LOST_PUSHBACK = [
  "LangWatch lost this call, so it did not run. The shared folder is still connected.",
  "Run the same command one more time.",
  "If it fails the same way again, tell the user in one line what is not done and end your turn.",
].join(" ");

/** What the model reads when a call is stopped. */
export const CANCELLED_PUSHBACK =
  "cancelled: the turn was stopped, so the call on the user's machine was stopped too";

/** What `code_access` says when the app does not answer. */
const STATUS_UNAVAILABLE_PUSHBACK =
  "LangWatch did not answer the code access check. Tell the user in one line and end your turn.";

/**
 * How long the folder-state read waits out a "not found" on the worker's
 * own conversation before the projection folds (`code_access` retries).
 */
export const WORKSPACE_READ_NOT_FOUND_WINDOW_MS = 30_000;
const WORKSPACE_READ_RETRY_MS = 2_000;

/** The bounded wait for the folder-state read, overridable by tests. */
export type WorkspaceReadRetry = { windowMs: number; beatMs: number };
const CODE_ACCESS_READ_RETRY: WorkspaceReadRetry = {
  windowMs: WORKSPACE_READ_NOT_FOUND_WINDOW_MS,
  beatMs: WORKSPACE_READ_RETRY_MS,
};

type BashOutput = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  logPath?: string;
  pid?: number;
  durationMs: number;
};

type PollCallResponse = {
  callId: string;
  state: "pending" | "running" | "awaiting_permission" | "done";
  ok?: boolean;
  text?: string;
  output?: BashOutput;
  error?: { code: string; message: string };
};

type WorkspaceInfo = {
  root: string;
  name: string;
  /** False when the folder is not a git repository; absent when git could not be run. */
  gitRepository?: boolean;
  gitBranch?: string;
  gitRemote?: string;
  gitDirty?: boolean;
  os: string;
  nodeVersion?: string;
  pythonVersion?: string;
  ghAuthenticated?: boolean;
  packageManager?: string;
};

type WorkspaceStatus = {
  connected: boolean;
  workspace?: WorkspaceInfo;
  codeAccessPreference: "github" | null;
  github: { installed: boolean; accountLogin?: string };
  pendingRequest?: { id: string; expiresAt: string };
};

type CreateControlRequestResponse = {
  request: { id: string; expiresAt: string };
  command: string;
};

/** The app did not answer. Each tool turns this into its own pushback, never a stack trace. */
export class AppUnreachableError extends Error {}

/**
 * The app answered, and it does not hold this call any more. A subclass of
 * the one above, so every catch still reads it as a call that did not run.
 */
export class CallLostError extends AppUnreachableError {}

/** The turn was stopped while the call was on the machine. */
export class CallCancelledError extends Error {}

/**
 * The app refused the call before it reached the machine, naming what was
 * wrong with the parameters. The message is the tool result: the model fixes
 * the call, nothing was lost and nothing is retried as it was.
 */
export class CallRejectedError extends Error {}

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    meta?: { issues?: { path?: (string | number)[]; message?: string }[] };
  };
};

/** The refusal's issues, one line each, so the model can see the parameter. */
function rejectionText(body: ApiErrorBody): string {
  const issues = body.error?.meta?.issues ?? [];
  const lines = issues.map(
    (issue) => `${(issue.path ?? []).join(".")}: ${issue.message ?? "invalid"}`,
  );
  const detail = lines.length > 0 ? lines.join("; ") : (body.error?.message ?? "invalid request");
  return `LangWatch refused this call before it reached the machine: ${detail}. Fix the parameters and call the tool again.`;
}

function endpoint(): string {
  return (process.env.LANGWATCH_ENDPOINT ?? "").replace(/\/+$/, "");
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * One request to the app. The session key in LANGWATCH_API_KEY is the whole
 * credential and it names the conversation. Any failure the model cannot act
 * on becomes an AppUnreachableError, so no stack trace reaches the reply.
 */
export async function callApp<T>({
  path,
  method,
  body,
  signal,
  timeoutMs,
}: {
  path: string;
  method: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs: number;
}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${endpoint()}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": process.env.LANGWATCH_API_KEY ?? "",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: combineSignals(signal, timeoutMs),
    });
  } catch {
    if (signal?.aborted) throw new CallCancelledError(CANCELLED_PUSHBACK);
    throw new AppUnreachableError("the LangWatch app did not answer");
  }
  if (response.status === 404) {
    throw new CallLostError("the LangWatch app does not hold this call any more");
  }
  if (response.status === 400) {
    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      body = {};
    }
    if (body.error?.code === "langy_api_request_invalid") {
      throw new CallRejectedError(rejectionText(body));
    }
    throw new AppUnreachableError("the LangWatch app did not answer");
  }
  if (!response.ok) throw new AppUnreachableError("the LangWatch app did not answer");
  try {
    return (await response.json()) as T;
  } catch {
    throw new AppUnreachableError("the LangWatch app did not answer");
  }
}

async function cancelCall(callId: string): Promise<void> {
  try {
    await callApp({
      path: `/api/langy/local/calls/${encodeURIComponent(callId)}/cancel`,
      method: "POST",
      timeoutMs: 5_000,
    });
  } catch {
    // The turn is over. A cancel the app never got changes nothing here.
    return;
  }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(settle, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        settle();
      },
      { once: true },
    );
  });
}

/** The command output as the model reads it. */
export function renderBashOutput(output: BashOutput): string {
  if (typeof output.pid === "number") {
    const lines = [`Started in the background. Process id ${output.pid}.`];
    if (output.logPath) lines.push(`The output goes to ${output.logPath}.`);
    return lines.join("\n");
  }
  const lines = [`exit code: ${output.exitCode === null ? "none" : output.exitCode}`];
  lines.push(`stdout:\n${output.stdout === "" ? "(empty)" : output.stdout}`);
  lines.push(`stderr:\n${output.stderr === "" ? "(empty)" : output.stderr}`);
  if (output.truncated) {
    lines.push(
      output.logPath
        ? `The output is cut at the size limit. The full output is in ${output.logPath}.`
        : "The output is cut at the size limit.",
    );
  }
  return lines.join("\n\n");
}

/** A tri-state flag read as a fact line's value. */
function yesNoUnknown(value: boolean | undefined): string {
  if (value === undefined) return "unknown";
  return value ? "yes" : "no";
}

/**
 * The git facts: one line saying the folder is not a repository, so the
 * skill asks about `git init` instead of walking into a checkout; otherwise
 * the branch, the remote and the dirty flag.
 */
function gitFacts(workspace: WorkspaceInfo): string[] {
  if (workspace.gitRepository === false) return ["git: not a repository"];
  return [
    `git branch: ${workspace.gitBranch ?? "unknown"}`,
    `git remote: ${workspace.gitRemote ?? "none"}`,
    `uncommitted changes: ${yesNoUnknown(workspace.gitDirty)}`,
  ];
}

/** The folder facts `code_access` gives the model when the folder is there. */
export function renderWorkspaceFacts(workspace: WorkspaceInfo): string {
  const lines = [
    `folder: ${workspace.root}`,
    `name: ${workspace.name}`,
    ...gitFacts(workspace),
    `operating system: ${workspace.os}`,
    `node: ${workspace.nodeVersion ?? "not found"}`,
    `python: ${workspace.pythonVersion ?? "not found"}`,
    `GitHub CLI signed in: ${yesNoUnknown(workspace.ghAuthenticated)}`,
    `package manager: ${workspace.packageManager ?? "unknown"}`,
  ];
  return ["The user's folder is connected. Work with the local_* tools.", ...lines].join("\n");
}

/**
 * The folder's state for this worker's own conversation. With `retry`, a
 * "not found" inside the window is read again; any other failure throws.
 */
async function readWorkspaceStatus({
  signal,
  retry,
}: {
  signal?: AbortSignal;
  retry?: WorkspaceReadRetry;
}): Promise<WorkspaceStatus> {
  const path = `/api/langy/local/workspace?conversationId=${encodeURIComponent(conversationId())}`;
  const deadline = retry === undefined ? 0 : Date.now() + retry.windowMs;
  for (;;) {
    try {
      return await callApp<WorkspaceStatus>({
        path,
        method: "GET",
        signal,
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      const notFolded =
        retry !== undefined &&
        error instanceof CallLostError &&
        !signal?.aborted &&
        Date.now() < deadline;
      if (!notFolded) throw error;
      await sleep(retry.beatMs, signal);
    }
  }
}

/**
 * The folder's own state, read from the app. False when the app could not
 * answer at all, so a failed read never claims the folder is there.
 */
async function isWorkspaceConnected({ signal }: { signal?: AbortSignal }): Promise<boolean> {
  try {
    const status = await readWorkspaceStatus({ signal });
    return status.connected === true;
  } catch {
    return false;
  }
}

/**
 * What a local call that did not run tells the model: the folder's own
 * state is read first, since only its going away is fixed by re-sharing.
 */
export async function localCallPushback({ signal }: { signal?: AbortSignal }): Promise<string> {
  return (await isWorkspaceConnected({ signal })) ? CALL_LOST_PUSHBACK : OFFLINE_PUSHBACK;
}

/**
 * Post one call, then long-poll until the machine answers. A refusal from the
 * machine is thrown with its code and its message unchanged, so the model can
 * act on the words the CLI chose.
 */
export async function runLocalCall({
  tool,
  params,
  turnContext,
  toolCallId,
  signal,
  now = () => Date.now(),
}: {
  tool: LocalToolName;
  params: unknown;
  turnContext: TurnContext;
  toolCallId?: string;
  signal?: AbortSignal;
  now?: () => number;
}): Promise<string> {
  const startedAt = now();
  const started = await callApp<{ callId: string }>({
    path: "/api/langy/local/calls",
    method: "POST",
    body: { ...callIds({ turnContext, ...(toolCallId ? { toolCallId } : {}) }), tool, params },
    signal,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  return pollLocalCall({ callId: started.callId, startedAt, signal, now });
}

/** One poll of a local call, retried on failure, until it settles or its budget runs out. */
async function pollOneLocalCall({
  callId,
  signal,
  failures,
}: {
  callId: string;
  signal: AbortSignal | undefined;
  failures: number;
}): Promise<{ poll?: PollCallResponse; failures: number }> {
  try {
    const poll = await callApp<PollCallResponse>({
      path: `/api/langy/local/calls/${encodeURIComponent(callId)}`,
      method: "GET",
      signal,
      timeoutMs: POLL_REQUEST_TIMEOUT_MS,
    });
    return { poll, failures: 0 };
  } catch (error) {
    if (error instanceof CallCancelledError || signal?.aborted) {
      await cancelCall(callId);
      throw new CallCancelledError(CANCELLED_PUSHBACK);
    }
    const nextFailures = failures + 1;
    if (nextFailures >= MAX_POLL_FAILURES) throw error;
    await sleep(POLL_RETRY_DELAY_MS, signal);
    return { failures: nextFailures };
  }
}

/** The done poll's text, or a thrown error naming the machine's refusal. */
function localCallResult(poll: PollCallResponse): string {
  if (poll.ok === false || poll.error) {
    const code = poll.error?.code ?? "exec_failed";
    const message = poll.error?.message ?? "the call did not run";
    throw new Error(`${code}: ${message}`);
  }
  const text = poll.output ? renderBashOutput(poll.output) : (poll.text ?? "");
  return text === "" ? "(no output)" : text;
}

/** Long-polls one local call until it settles, is cancelled, or its budget runs out. */
async function pollLocalCall({
  callId,
  startedAt,
  signal,
  now,
}: {
  callId: string;
  startedAt: number;
  signal: AbortSignal | undefined;
  now: () => number;
}): Promise<string> {
  let failures = 0;
  for (;;) {
    if (signal?.aborted) {
      await cancelCall(callId);
      throw new CallCancelledError(CANCELLED_PUSHBACK);
    }
    if (now() - startedAt > CALL_MAX_WAIT_MS) {
      await cancelCall(callId);
      throw new AppUnreachableError("the LangWatch app did not answer");
    }

    const result = await pollOneLocalCall({ callId, signal, failures });
    failures = result.failures;
    if (!result.poll || result.poll.state !== "done") continue;
    return localCallResult(result.poll);
  }
}

/** What `code_access` returns, in the three states the folder can be in. */
export async function readCodeAccess({
  signal,
  offerDescribe = false,
  retry = CODE_ACCESS_READ_RETRY,
}: {
  signal?: AbortSignal;
  /** The bounded wait for the folder-state read; the default is the window above. */
  retry?: WorkspaceReadRetry;
  /**
   * The card also offers "I'd rather describe it". A skill that asks for it
   * has already said its opener, so the turn ends on the card without a word.
   */
  offerDescribe?: boolean;
}): Promise<string> {
  const conversation = conversationId();
  let status: WorkspaceStatus;
  try {
    status = await readWorkspaceStatus({ signal, retry });
  } catch (error) {
    if (error instanceof CallCancelledError) throw error;
    return STATUS_UNAVAILABLE_PUSHBACK;
  }

  if (status.connected && status.workspace) {
    return renderWorkspaceFacts(status.workspace);
  }
  if (status.codeAccessPreference === "github") {
    return "The user remembered GitHub. Follow the github skill and open a pull request.";
  }

  let created: CreateControlRequestResponse;
  try {
    created = await callApp<CreateControlRequestResponse>({
      path: "/api/langy/local/requests",
      method: "POST",
      body: { conversationId: conversation },
      signal,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof CallCancelledError) throw error;
    return STATUS_UNAVAILABLE_PUSHBACK;
  }

  return [
    "The code access card is shown to the user.",
    `The card shows this command: ${created.command}`,
    offerDescribe
      ? "END YOUR TURN now, without another word: the card already says what happens next."
      : "Say in one line what you will change and that you can do it on their machine or through GitHub, then END YOUR TURN.",
    "Do not list manual steps.",
    offerDescribe
      ? "The next turn starts when the folder connects, when the user picks GitHub, or when they would rather describe the agent."
      : "The next turn starts when the folder connects or when the user picks GitHub.",
  ].join("\n");
}

const MACHINE_NOTE = "Runs on the user's machine, inside the folder they shared.";

const codeAccessParams = Type.Object({
  reason: Type.Optional(
    Type.String({ description: "One short line about the change you want to make." }),
  ),
  offer_describe: Type.Optional(
    Type.Boolean({
      description:
        'Also offer a quiet third way out, "I\'d rather describe it". The pick arrives as the next message. Off unless a skill asks for it.',
    }),
  ),
});

const localReadParams = Type.Object({
  path: Type.String({ description: "File path in the shared folder." }),
  offset: Type.Optional(Type.Number({ description: "First line to read." })),
  limit: Type.Optional(Type.Number({ description: "How many lines to read." })),
});

const localWriteParams = Type.Object({
  path: Type.String({ description: "File path in the shared folder." }),
  content: Type.String({ description: "The full new content of the file." }),
});

const localEditParams = Type.Object({
  path: Type.String({ description: "File path in the shared folder." }),
  edits: Type.Array(
    Type.Union([
      Type.Object({
        oldText: Type.String({
          description: "The text to replace. It must be unique in the file and cannot be empty.",
        }),
        newText: Type.String({ description: "The new text." }),
      }),
      Type.Object({
        append: Type.String({
          description:
            "Text added at the end of the file, on its own line. Use it to add a line at the end instead of an empty oldText. Creates the file when there is none.",
        }),
      }),
    ]),
    { description: "The edits to make, in order: a replacement or an append." },
  ),
});

const localBashParams = Type.Object({
  command: Type.String({ description: "The command to run in the shared folder." }),
  timeout: Type.Optional(Type.Number({ description: "Seconds before the command is stopped." })),
  background: Type.Optional(
    Type.Boolean({
      description: "Start the command and return at once with its process id and log path.",
    }),
  ),
});

const localGrepParams = Type.Object({
  pattern: Type.String({ description: "The regular expression to look for." }),
  path: Type.Optional(Type.String({ description: "Where to search. Default is the folder root." })),
  glob: Type.Optional(Type.String({ description: "Only search files that match this glob." })),
  ignoreCase: Type.Optional(Type.Boolean({ description: "Ignore upper and lower case." })),
  literal: Type.Optional(Type.Boolean({ description: "Read the pattern as plain text." })),
  context: Type.Optional(Type.Number({ description: "Lines to show around each match." })),
  limit: Type.Optional(Type.Number({ description: "The largest number of matches to return." })),
});

const localFindParams = Type.Object({
  pattern: Type.String({ description: "The file name glob to look for." }),
  path: Type.Optional(Type.String({ description: "Where to look. Default is the folder root." })),
  limit: Type.Optional(Type.Number({ description: "The largest number of paths to return." })),
});

const localLsParams = Type.Object({
  path: Type.Optional(
    Type.String({ description: "Directory to list. Default is the folder root." }),
  ),
  limit: Type.Optional(Type.Number({ description: "The largest number of entries to return." })),
});

const localLangwatchEnvParams = Type.Object({
  path: Type.Optional(
    Type.String({
      description: "The env file the app loads, relative to the shared folder. Default is .env.",
    }),
  ),
});

const localToolDescriptions: Record<LocalToolName, string> = {
  local_read: `Read a file on the user's machine. ${MACHINE_NOTE}`,
  local_write: `Write a file on the user's machine. It replaces the whole file. ${MACHINE_NOTE}`,
  local_edit: `Change parts of a file on the user's machine. ${MACHINE_NOTE}`,
  local_bash: `Run a shell command on the user's machine. ${MACHINE_NOTE} The user can be asked for permission first, so this tool can wait for their answer. Use it for the project's own tools: the package manager, the tests, git and gh.`,
  local_grep: `Search file contents on the user's machine. ${MACHINE_NOTE}`,
  local_find: `Find files by name on the user's machine. ${MACHINE_NOTE}`,
  local_ls: `List a directory on the user's machine. ${MACHINE_NOTE}`,
  local_langwatch_env: `Write this project's LangWatch credentials into the app's env file on the user's machine: LANGWATCH_API_KEY and LANGWATCH_ENDPOINT. The command line fetches the key with the user's own login and writes it there; the key never reaches you. Call it once, after the tracing edit, with the env file the app loads (default .env next to the manifest). ${MACHINE_NOTE}`,
};

const localToolLabels: Record<LocalToolName, string> = {
  local_read: "Read on your machine",
  local_write: "Write on your machine",
  local_edit: "Edit on your machine",
  local_bash: "Run on your machine",
  local_grep: "Search on your machine",
  local_find: "Find on your machine",
  local_ls: "List on your machine",
  local_langwatch_env: "LangWatch credentials on your machine",
};

const localToolParams = {
  local_read: localReadParams,
  local_write: localWriteParams,
  local_edit: localEditParams,
  local_bash: localBashParams,
  local_grep: localGrepParams,
  local_find: localFindParams,
  local_ls: localLsParams,
  local_langwatch_env: localLangwatchEnvParams,
} as const;

/** Text result in the shape pi expects. */
function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

/** Text result of a call that ran in the developer's folder, marked as such. */
function localTextResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: LOCAL_RESULT_DETAILS };
}

/** What a failed local call becomes as a tool result: a pushback or a thrown refusal. */
async function localToolFailureResult({
  error,
  signal,
}: {
  error: unknown;
  signal: AbortSignal | undefined;
}) {
  // A call that did not run is a pushback the model acts on, not a
  // failure; a lost call is retried, a folder that is gone is offered
  // the two ways on.
  if (error instanceof AppUnreachableError) {
    return textResult(await localCallPushback({ signal }));
  }
  // A refusal names the parameter, so the model corrects the call. The
  // developer's CLI answered it, so the call did reach their machine.
  if (error instanceof CallRejectedError) {
    return localTextResult(error.message);
  }
  throw error;
}

/** One local call as a tool result, with the pushbacks the model acts on. */
async function runLocalTool({
  tool,
  params,
  turnContext,
  toolCallId,
  signal,
}: {
  tool: LocalToolName;
  params: unknown;
  turnContext: TurnContext;
  toolCallId: string;
  signal?: AbortSignal;
}) {
  try {
    return localTextResult(await runLocalCall({ tool, params, turnContext, toolCallId, signal }));
  } catch (error) {
    return localToolFailureResult({ error, signal });
  }
}

/**
 * The `bash` tool's execute: a command delegates to the developer's folder
 * through `local_bash` when it is connected and the command is not the
 * langwatch CLI itself; otherwise it runs in the sandbox as it always did.
 */
function runBashOrDelegate({
  sandboxBash,
  folder,
  turnContext,
  toolCallId,
  params,
  signal,
  onUpdate,
}: {
  sandboxBash: ReturnType<typeof createBashTool>;
  folder: { connected: boolean };
  turnContext: TurnContext;
  toolCallId: string;
  params: Parameters<ReturnType<typeof createBashTool>["execute"]>[1];
  signal: Parameters<ReturnType<typeof createBashTool>["execute"]>[2];
  onUpdate: Parameters<ReturnType<typeof createBashTool>["execute"]>[3];
}) {
  if (folder.connected && !isLangwatchCliCommand(params.command)) {
    return runLocalTool({
      tool: "local_bash",
      params: {
        command: params.command,
        ...(params.timeout !== undefined ? { timeout: params.timeout } : {}),
      },
      turnContext,
      toolCallId,
      signal,
    });
  }
  return sandboxBash.execute(toolCallId, params, signal, onUpdate);
}

export function createLocalWorkspaceExtension({
  turnContext,
  sandboxCwd,
}: {
  turnContext: TurnContext;
  /** Where the sandbox shell runs when no folder is connected. */
  sandboxCwd: string;
}): InlineExtension {
  return {
    name: "langy-local-workspace",
    factory: (pi: ExtensionAPI) => {
      /** The folder's state as of the start of the turn in flight. */
      const folder = { connected: false };

      // The folder's state is read at the start of every turn, and the turn's
      // tool set follows it. A turn that starts because the folder connected
      // is a new prompt, so it already runs without the sandbox file tools;
      // a folder that goes away mid-turn is answered by the local tools' own
      // pushback until the next turn puts the sandbox tools back.
      pi.on("before_agent_start", async () => {
        folder.connected = await isWorkspaceConnected({});
        pi.setActiveTools(
          activeToolsFor({ connected: folder.connected, active: pi.getActiveTools() }),
        );
      });

      const sandboxBash = createBashTool(sandboxCwd);
      pi.registerTool({
        name: BASH_TOOL_NAME,
        label: sandboxBash.label,
        description: `${sandboxBash.description} While the user's folder is connected the command runs there, on their machine, as local_bash does; a langwatch command runs here either way.`,
        parameters: sandboxBash.parameters,
        execute: (toolCallId, params, signal, onUpdate) =>
          runBashOrDelegate({
            sandboxBash,
            folder,
            turnContext,
            toolCallId,
            params,
            signal,
            onUpdate,
          }),
      });

      pi.registerTool({
        name: CODE_ACCESS_TOOL_NAME,
        label: "Code access",
        description:
          "Ask for a way to reach the user's code before you change their program. Call it once, before the first edit. It answers at once when a folder is already shared or when the user remembered GitHub. If it does not, it shows a card and you must end your turn.",
        parameters: codeAccessParams,
        async execute(_toolCallId, params, signal) {
          try {
            return textResult(
              await readCodeAccess({
                signal,
                offerDescribe: params.offer_describe === true,
              }),
            );
          } catch (error) {
            if (error instanceof CallCancelledError) throw error;
            return textResult(STATUS_UNAVAILABLE_PUSHBACK);
          }
        },
      });

      for (const name of LOCAL_TOOL_NAMES) {
        pi.registerTool({
          name,
          label: localToolLabels[name],
          description: localToolDescriptions[name],
          parameters: localToolParams[name],
          async execute(toolCallId, params, signal) {
            return runLocalTool({ tool: name, params, turnContext, toolCallId, signal });
          },
        });
      }
    },
  };
}
