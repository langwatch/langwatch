/**
 * The local workspace tools: `code_access` and the seven `local_*` mirrors of
 * pi's built-ins (ADR-129).
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

export const CODE_ACCESS_TOOL_NAME = "code_access";

export const LOCAL_TOOL_NAMES = [
  "local_read",
  "local_write",
  "local_edit",
  "local_bash",
  "local_grep",
  "local_find",
  "local_ls",
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

/** What the model reads when the folder is not there. */
export const OFFLINE_PUSHBACK =
  "the shared folder is not connected; ask the user to run `npx langwatch@latest langy --share-control` again or continue without it";

/** What the model reads when a call is stopped. */
export const CANCELLED_PUSHBACK =
  "cancelled: the turn was stopped, so the call on the user's machine was stopped too";

/** What `code_access` says when the app does not answer. */
const STATUS_UNAVAILABLE_PUSHBACK =
  "LangWatch did not answer the code access check. Tell the user in one line and end your turn.";

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

/** The turn was stopped while the call was on the machine. */
export class CallCancelledError extends Error {}

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
 * Post one call, then long-poll until the machine answers. A refusal from the
 * machine is thrown with its code and its message unchanged, so the model can
 * act on the words the CLI chose.
 */
export async function runLocalCall({
  tool,
  params,
  signal,
  now = () => Date.now(),
}: {
  tool: LocalToolName;
  params: unknown;
  signal?: AbortSignal;
  now?: () => number;
}): Promise<string> {
  const startedAt = now();
  const started = await callApp<{ callId: string }>({
    path: "/api/langy/local/calls",
    method: "POST",
    body: { tool, params },
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
}: {
  signal?: AbortSignal;
}): Promise<string> {
  let status: WorkspaceStatus;
  try {
    status = await callApp<WorkspaceStatus>({
      path: "/api/langy/local/workspace",
      method: "GET",
      signal,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
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
    "Say in one line what you will change and that you can do it on their machine or through GitHub, then END YOUR TURN.",
    "Do not list manual steps.",
    "The next turn starts when the folder connects or when the user picks GitHub.",
  ].join("\n");
}

const MACHINE_NOTE = "Runs on the user's machine, inside the folder they shared.";

const codeAccessParams = Type.Object({
  reason: Type.Optional(
    Type.String({ description: "One short line about the change you want to make." }),
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
    Type.Object({
      oldText: Type.String({ description: "The text to replace. It must be unique in the file." }),
      newText: Type.String({ description: "The new text." }),
    }),
    { description: "The replacements to make, in order." },
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

const localToolDescriptions: Record<LocalToolName, string> = {
  local_read: `Read a file on the user's machine. ${MACHINE_NOTE}`,
  local_write: `Write a file on the user's machine. It replaces the whole file. ${MACHINE_NOTE}`,
  local_edit: `Change parts of a file on the user's machine. ${MACHINE_NOTE}`,
  local_bash: `Run a shell command on the user's machine. ${MACHINE_NOTE} The user can be asked for permission first, so this tool can wait for their answer. Use it for the project's own tools: the package manager, the tests, git and gh.`,
  local_grep: `Search file contents on the user's machine. ${MACHINE_NOTE}`,
  local_find: `Find files by name on the user's machine. ${MACHINE_NOTE}`,
  local_ls: `List a directory on the user's machine. ${MACHINE_NOTE}`,
};

const localToolLabels: Record<LocalToolName, string> = {
  local_read: "Read on your machine",
  local_write: "Write on your machine",
  local_edit: "Edit on your machine",
  local_bash: "Run on your machine",
  local_grep: "Search on your machine",
  local_find: "Find on your machine",
  local_ls: "List on your machine",
};

const localToolParams = {
  local_read: localReadParams,
  local_write: localWriteParams,
  local_edit: localEditParams,
  local_bash: localBashParams,
  local_grep: localGrepParams,
  local_find: localFindParams,
  local_ls: localLsParams,
} as const;

/** Text result in the shape pi expects. */
function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

export function createLocalWorkspaceExtension(): InlineExtension {
  return {
    name: "langy-local-workspace",
    factory: (pi: ExtensionAPI) => {
      pi.registerTool({
        name: CODE_ACCESS_TOOL_NAME,
        label: "Code access",
        description:
          "Ask for a way to reach the user's code before you change their program. Call it once, before the first edit. It answers at once when a folder is already shared or when the user remembered GitHub. If it does not, it shows a card and you must end your turn.",
        parameters: codeAccessParams,
        async execute(_toolCallId, _params, signal) {
          try {
            return textResult(await readCodeAccess({ signal }));
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
          async execute(_toolCallId, params, signal) {
            try {
              return textResult(await runLocalCall({ tool: name, params, signal }));
            } catch (error) {
              // A folder that is not there is a pushback the model acts on,
              // not a failure: it asks for code access instead of retrying.
              if (error instanceof AppUnreachableError) {
                return textResult(OFFLINE_PUSHBACK);
              }
              throw error;
            }
          },
        });
      }
    },
  };
}
