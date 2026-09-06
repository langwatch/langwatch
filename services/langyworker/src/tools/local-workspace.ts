/**
 * The local workspace tools: `code_access`, the seven `local_*` mirrors of
 * pi's built-ins and the credentials call (ADR-129).
 *
 * A `local_*` call does not run in the worker. It is posted to the app, which
 * hands it to `langwatch langy --share-control` on the developer's machine and
 * gives the answer back on a long poll. The parameter names mirror the
 * built-in each tool stands in for, so the model keeps one habit.
 *
 * The worker's stderr goes to /dev/null (the manager sets cmd.Stderr = nil), so
 * a tool cannot log. Everything the model or the user must know travels in the
 * tool result.
 */

import { Type } from "typebox";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { callIds, conversationId, type TurnContext } from "./turn-context.js";

export const CODE_ACCESS_TOOL_NAME = "code_access";

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
 * What the model reads when the folder is not there.
 *
 * It names both ways on, because a reply that only reports the folder is gone
 * leaves the user with nothing to do next.
 */
export const OFFLINE_PUSHBACK = [
  "The shared folder is not connected any more, so this call did not run.",
  "Tell the user in one line what is not done, then give them the two ways on:",
  "they can run `npx langwatch@latest langy --share-control` in the folder again,",
  "or they can work through GitHub, which you offer by calling `code_access`.",
  "End your turn with that offer.",
].join(" ");

/**
 * What the model reads when LangWatch lost the call and the folder is still
 * there.
 *
 * A poll that answers "not found" says the app dropped the envelope, which is
 * a different thing from the machine going away. Sending the user to share
 * their folder again, while their command line sits connected, is advice they
 * cannot act on.
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
 * How long the folder-state read waits out a "not found" on the worker's own
 * conversation.
 *
 * The conversation this worker runs on was accepted before the worker was
 * created, but the app answers its reads from a projection that is folded
 * asynchronously, so in the first seconds of a conversation the row may not
 * be there yet and the read says "not found". Under load that fold has taken
 * over ten seconds. A "not found" on this worker's own conversation inside
 * this window means "not yet", never "no such conversation", so `code_access`
 * repeats the read, and only that read: a 404 on a call envelope still means
 * the app lost the call, and the folder check behind a lost call is
 * mid-conversation, long after the fold. After the window the answer is the
 * usual pushback.
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
 * The app answered, and it does not hold this call any more.
 *
 * A subclass of the one above, so every existing catch still reads it as a
 * call that did not run; the tools that can act on the difference test for
 * this one first.
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
  }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
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

/** The folder facts `code_access` gives the model when the folder is there. */
export function renderWorkspaceFacts(workspace: WorkspaceInfo): string {
  const lines = [
    `folder: ${workspace.root}`,
    `name: ${workspace.name}`,
    `git branch: ${workspace.gitBranch ?? "unknown"}`,
    `git remote: ${workspace.gitRemote ?? "none"}`,
    `uncommitted changes: ${workspace.gitDirty === undefined ? "unknown" : workspace.gitDirty ? "yes" : "no"}`,
    `operating system: ${workspace.os}`,
    `node: ${workspace.nodeVersion ?? "not found"}`,
    `python: ${workspace.pythonVersion ?? "not found"}`,
    `GitHub CLI signed in: ${workspace.ghAuthenticated === undefined ? "unknown" : workspace.ghAuthenticated ? "yes" : "no"}`,
    `package manager: ${workspace.packageManager ?? "unknown"}`,
  ];
  return [
    "The user's folder is connected. Work with the local_* tools.",
    ...lines,
  ].join("\n");
}

/**
 * The folder's state for this worker's own conversation. With `retry`, a
 * "not found" inside the window is read again, see
 * `WORKSPACE_READ_NOT_FOUND_WINDOW_MS`; without it, and for any other failure,
 * the error is thrown as it is.
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
async function isWorkspaceConnected({
  signal,
}: {
  signal?: AbortSignal;
}): Promise<boolean> {
  try {
    const status = await readWorkspaceStatus({ signal });
    return status.connected === true;
  } catch {
    return false;
  }
}

/**
 * What a local call that did not run tells the model.
 *
 * The folder going away and the app losing the call are different things, and
 * only the first one is fixed by sharing the folder again, so the folder's own
 * state is read before either is said.
 */
export async function localCallPushback({
  signal,
}: {
  signal?: AbortSignal;
}): Promise<string> {
  return (await isWorkspaceConnected({ signal }))
    ? CALL_LOST_PUSHBACK
    : OFFLINE_PUSHBACK;
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

  let failures = 0;
  for (;;) {
    if (signal?.aborted) {
      await cancelCall(started.callId);
      throw new CallCancelledError(CANCELLED_PUSHBACK);
    }
    if (now() - startedAt > CALL_MAX_WAIT_MS) {
      await cancelCall(started.callId);
      throw new AppUnreachableError("the LangWatch app did not answer");
    }

    let poll: PollCallResponse;
    try {
      poll = await callApp<PollCallResponse>({
        path: `/api/langy/local/calls/${encodeURIComponent(started.callId)}`,
        method: "GET",
        signal,
        timeoutMs: POLL_REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      if (error instanceof CallCancelledError || signal?.aborted) {
        await cancelCall(started.callId);
        throw new CallCancelledError(CANCELLED_PUSHBACK);
      }
      failures += 1;
      if (failures >= MAX_POLL_FAILURES) throw error;
      await sleep(POLL_RETRY_DELAY_MS, signal);
      continue;
    }
    failures = 0;

    if (poll.state !== "done") continue;

    if (poll.ok === false || poll.error) {
      const code = poll.error?.code ?? "exec_failed";
      const message = poll.error?.message ?? "the call did not run";
      throw new Error(`${code}: ${message}`);
    }
    const text = poll.output ? renderBashOutput(poll.output) : (poll.text ?? "");
    return text === "" ? "(no output)" : text;
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
        "Also offer a quiet third way out, \"I'd rather describe it\". The pick arrives as the next message. Off unless a skill asks for it.",
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
  path: Type.Optional(Type.String({ description: "Directory to list. Default is the folder root." })),
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

export function createLocalWorkspaceExtension({
  turnContext,
}: {
  turnContext: TurnContext;
}): InlineExtension {
  return {
    name: "langy-local-workspace",
    factory: (pi: ExtensionAPI) => {
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
            try {
              return textResult(
                await runLocalCall({ tool: name, params, turnContext, toolCallId, signal }),
              );
            } catch (error) {
              // A call that did not run is a pushback the model acts on, not a
              // failure. Which pushback depends on the folder, which is read
              // rather than guessed: a lost call is retried, a folder that is
              // gone is offered the two ways on.
              if (error instanceof AppUnreachableError) {
                return textResult(await localCallPushback({ signal }));
              }
              // A refusal names the parameter, so the model corrects the call.
              if (error instanceof CallRejectedError) {
                return textResult(error.message);
              }
              throw error;
            }
          },
        });
      }
    },
  };
}
