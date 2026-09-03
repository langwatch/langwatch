/**
 * Finding the Langy conversation that asked for this folder, and approving it.
 *
 * The CLI signs in with the device session, lists the control requests the
 * user has open, and asks in the terminal. Approving posts what the CLI knows
 * about the folder and receives the Langy session key the socket connects
 * with. With nothing open it waits, so the order of the two steps, the ask in
 * the chat and the command here, does not matter.
 *
 * @see specs/typescript-sdk/cli-langy-share-control.feature
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import chalk from "chalk";
import prompts from "prompts";
import type { WorkspaceInfo } from "../../../agent/local-control-protocol";
import { buildAuthHeaders } from "../../../internal/api/auth";
import { LANGWATCH_SDK_VERSION } from "../../../internal/constants";
import { resolveCredentials } from "../../utils/apiKey";
import { isLoggedIn, loadConfig } from "../../utils/governance/config";
import { LocalCallFailure } from "./errors";

/** How often the CLI looks again while it waits for a request. */
export const REQUEST_POLL_INTERVAL_MS = 5_000;

/** One control request as the CLI lists it. */
export interface ControlRequest {
  id: string;
  conversationId: string;
  conversationTitle: string;
  conversationUrl: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  expiresAt: string;
}

export interface ApprovedControl {
  sessionKey: string;
  endpoint: string;
  conversation: { id: string; title: string; url: string };
}

export class ShareControlError extends Error {}

// ---------------------------------------------------------------------------
// The folder
// ---------------------------------------------------------------------------

/**
 * The folder to share: the current directory, as its real path, so a
 * directory reached through a symlink shares the place the files live and
 * every later call is measured against that same path.
 */
export function resolveShareRoot({
  cwd = process.cwd(),
  homedir = os.homedir(),
}: { cwd?: string; homedir?: string } = {}): string {
  let root: string;
  try {
    root = fs.realpathSync(cwd);
  } catch {
    root = path.resolve(cwd);
  }
  const home = path.resolve(homedir);
  if (root === path.parse(root).root) {
    throw new ShareControlError(
      "This is the filesystem root. Run the command from the project folder you want Langy to work in.",
    );
  }
  if (root === home) {
    throw new ShareControlError(
      "This is your home directory. Run the command from the project folder you want Langy to work in.",
    );
  }
  return root;
}

const quiet = (command: string, args: string[], cwd: string): string | null => {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    }).trim();
  } catch {
    return null;
  }
};

/** The lockfile that says which package manager the folder uses. */
export function packageManagerOf(root: string): string | undefined {
  const lockfiles: Array<[string, string]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
    ["package-lock.json", "npm"],
    ["uv.lock", "uv"],
    ["poetry.lock", "poetry"],
    ["Pipfile.lock", "pipenv"],
    ["requirements.txt", "pip"],
    ["go.sum", "go"],
    ["Cargo.lock", "cargo"],
  ];
  for (const [file, manager] of lockfiles) {
    if (fs.existsSync(path.join(root, file))) return manager;
  }
  return undefined;
}

/**
 * What the CLI knows about the folder at register time. Everything past the
 * root is best effort: a machine with no git, no python and no `gh` still
 * shares its folder, the skill just learns less about it.
 */
export function describeWorkspace(root: string): WorkspaceInfo {
  const inside = quiet("git", ["rev-parse", "--is-inside-work-tree"], root);
  const isRepository = inside === "true";
  const branch = isRepository
    ? quiet("git", ["rev-parse", "--abbrev-ref", "HEAD"], root)
    : null;
  const remote = isRepository
    ? quiet("git", ["remote", "get-url", "origin"], root)
    : null;
  const status = isRepository
    ? quiet("git", ["status", "--porcelain"], root)
    : null;
  const python =
    quiet("python3", ["--version"], root) ?? quiet("python", ["--version"], root);
  const manager = packageManagerOf(root);
  return {
    root,
    name: path.basename(root),
    ...(branch ? { gitBranch: branch } : {}),
    ...(remote ? { gitRemote: remote } : {}),
    ...(status === null ? {} : { gitDirty: status !== "" }),
    os: `${os.platform()} ${os.release()}`,
    nodeVersion: process.version,
    ...(python ? { pythonVersion: python } : {}),
    ghAuthenticated: quiet("gh", ["auth", "status"], root) !== null,
    ...(manager ? { packageManager: manager } : {}),
  };
}

/** True when the folder is a git repository, so Langy can open a pull request. */
export function isGitRepository(root: string): boolean {
  return quiet("git", ["rev-parse", "--is-inside-work-tree"], root) === "true";
}

// ---------------------------------------------------------------------------
// Talking to the platform
// ---------------------------------------------------------------------------

export interface ControlApi {
  list: () => Promise<ControlRequest[]>;
  approve: (input: {
    requestId: string;
    workspace: WorkspaceInfo;
  }) => Promise<ApprovedControl>;
  cancel: (input: { requestId: string }) => Promise<void>;
}

const REQUESTS_PATH = "/api/v1/langy/control/requests";

/** The control routes, over the credentials the command resolved. */
export function createControlApi({
  endpoint,
  apiKey,
  projectId,
  fetchImpl = fetch,
}: {
  endpoint: string;
  apiKey: string;
  projectId?: string;
  fetchImpl?: typeof fetch;
}): ControlApi {
  const headers = {
    ...buildAuthHeaders({
      apiKey,
      ...(projectId === undefined ? {} : { projectId }),
    }),
    "Content-Type": "application/json",
    "User-Agent": `langwatch-cli/${LANGWATCH_SDK_VERSION}`,
  };

  const call = async (
    urlPath: string,
    init: { method: string; body?: string },
  ): Promise<unknown> => {
    const response = await fetchImpl(`${endpoint}${urlPath}`, {
      method: init.method,
      headers,
      ...(init.body === undefined ? {} : { body: init.body }),
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text === "" ? null : JSON.parse(text);
    } catch {
      body = null;
    }
    if (!response.ok) {
      throw new ShareControlError(
        refusalText(body) ?? `LangWatch answered ${response.status} for ${urlPath}`,
      );
    }
    return body;
  };

  return {
    list: async () => {
      const body = (await call(REQUESTS_PATH, { method: "GET" })) as {
        requests?: ControlRequest[];
      } | null;
      return Array.isArray(body?.requests) ? body.requests : [];
    },
    approve: async ({ requestId, workspace }) =>
      (await call(`${REQUESTS_PATH}/${encodeURIComponent(requestId)}/approve`, {
        method: "POST",
        body: JSON.stringify({ workspace }),
      })) as ApprovedControl,
    cancel: async ({ requestId }) => {
      await call(`${REQUESTS_PATH}/${encodeURIComponent(requestId)}/cancel`, {
        method: "POST",
      });
    },
  };
}

// ---------------------------------------------------------------------------
// The terminal
// ---------------------------------------------------------------------------

/** True when this machine has a device session the command can run on. */
export function hasDeviceSession(): boolean {
  try {
    return isLoggedIn(loadConfig());
  } catch {
    return false;
  }
}

/**
 * Signs in when the machine has no device session, then resolves the
 * credentials. The login is the standard flow, called rather than repeated.
 */
export async function ensureSignedIn({
  login,
}: {
  login: (options: { device: boolean }) => Promise<void>;
}): Promise<{ apiKey: string; endpoint: string; projectId?: string }> {
  if (!hasDeviceSession() && !process.env.LANGWATCH_API_KEY?.trim()) {
    console.log(
      chalk.gray("No login on this machine yet. Signing in first."),
    );
    await login({ device: true });
  }
  const credentials = await resolveCredentials();
  return {
    apiKey: credentials.apiKey,
    endpoint: credentials.endpoint,
    ...(credentials.projectId === undefined
      ? {}
      : { projectId: credentials.projectId }),
  };
}

const requestTitle = (request: ControlRequest, root: string): string =>
  `Langy session "${request.conversationTitle}" (project ${request.projectName}) is requesting control over ${root}`;

/** What the user chose in the terminal. */
export type RequestChoice =
  | { action: "approve"; request: ControlRequest }
  | { action: "cancel"; request: ControlRequest }
  | { action: "quit" };

/**
 * Shows the open requests and asks what to do. One request offers Approve and
 * Cancel; several become a picker over their titles and projects first.
 */
export async function chooseRequest({
  requests,
  root,
  ask = prompts,
}: {
  requests: ControlRequest[];
  root: string;
  ask?: typeof prompts;
}): Promise<RequestChoice> {
  let request = requests[0];
  if (requests.length > 1) {
    const picked = await ask({
      type: "select",
      name: "requestId",
      message: "Which Langy session should get this folder?",
      choices: requests.map((entry) => ({
        title: entry.conversationTitle,
        description: `project ${entry.projectName}`,
        value: entry.id,
      })),
      initial: 0,
    });
    request = requests.find((entry) => entry.id === picked.requestId);
  }
  if (!request) return { action: "quit" };

  console.log("");
  console.log(requestTitle(request, root));
  const answer = await ask({
    type: "select",
    name: "action",
    message: "Share this folder?",
    choices: [
      { title: "Approve", value: "approve" },
      { title: "Cancel", value: "cancel" },
    ],
    initial: 0,
  });
  if (answer.action === "approve") return { action: "approve", request };
  if (answer.action === "cancel") return { action: "cancel", request };
  return { action: "quit" };
}

/**
 * The open requests, waiting until one appears. The wait prints once and then
 * looks again on every interval, so a request recorded later is picked up
 * without restarting the command.
 */
export async function waitForRequests({
  api,
  intervalMs = REQUEST_POLL_INTERVAL_MS,
  onWaiting,
  sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms).unref();
    }),
  attempts = Number.POSITIVE_INFINITY,
}: {
  api: ControlApi;
  intervalMs?: number;
  onWaiting?: () => void;
  sleep?: (ms: number) => Promise<void>;
  /** For tests: how many times the list is read before giving up. */
  attempts?: number;
}): Promise<ControlRequest[]> {
  let announced = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const requests = await api.list();
    if (requests.length > 0) return requests;
    if (!announced) {
      announced = true;
      onWaiting?.();
    }
    await sleep(intervalMs);
  }
  return [];
}

/** The failure a refused approval becomes, so the caller prints one line. */
export const asShareControlError = (error: unknown): ShareControlError =>
  error instanceof ShareControlError
    ? error
    : new ShareControlError(
        error instanceof LocalCallFailure || error instanceof Error
          ? error.message
          : String(error),
      );

/**
 * The words of a refusal. The v1 envelope carries the customer-facing
 * sentences in `tips` and repeats the error code in `message`, so the tips
 * come first and a bare code is never printed on its own.
 */
function refusalText(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const { tips, message, code } = body as {
    tips?: unknown;
    message?: unknown;
    code?: unknown;
  };
  if (Array.isArray(tips)) {
    const lines = tips.filter((t): t is string => typeof t === "string" && t !== "");
    if (lines.length > 0) return lines.join(" ");
  }
  if (typeof message === "string" && message !== "" && message !== code) {
    return message;
  }
  if (typeof code === "string" && code !== "") return `LangWatch refused: ${code}`;
  return undefined;
}
