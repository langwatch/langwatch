import chalk from "chalk";

import { getEndpoint } from "../../utils/endpoint";
import { commandValidationError } from "../../utils/errorOutput";
import {
  createPkcePair,
  describeMachine,
  forgetPendingRequest,
  listPendingRequests,
  type OpsProject,
  type OpsSession,
  opsProjectSchema,
  pickSessionProject,
  readOpsSession,
  removeOpsSession,
  saveOpsSession,
  storePendingRequest,
  takePendingRequest,
} from "../../utils/opsSession";
import type { CommandResult } from "../../utils/output";
import { printFacts } from "../management/_shared";
import { opsAuthError, requireRequesterKey, staffAccessFetch } from "./_shared";
import { type ListedFunction, suggestOpsCall } from "./call-hint";

/** How often a waiting request asks whether it was decided. */
export const OPS_POLL_INTERVAL_MS = 2_000;

interface CreatedRequest {
  requestId: string;
  approvalUrl: string;
  expiresAt: string;
}

interface RequestStatus {
  status: string;
  expiresAt?: string;
}

interface Redeemed {
  apiKey?: string;
  opsToken?: string;
  organizationId?: string;
  projects?: OpsProject[];
  scopes: string[];
  functions?: string[];
  expiresAt: string;
}

const validationError = (message: string): Error =>
  Object.assign(new Error(message), commandValidationError(message));

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** What every session-bearing command reports: never a key or a token. */
const describeSession = ({ session, file }: { session: OpsSession; file: string }) => {
  const defaultProject = pickSessionProject({ session });
  return {
    requestId: session.requestId,
    endpoint: session.endpoint,
    sessionFile: file,
    organizationId: session.organizationId ?? null,
    scopes: session.scopes,
    functions: session.functions ?? [],
    projects: session.projects,
    defaultProject: defaultProject?.slug ?? null,
    hasApiKey: Boolean(session.apiKey),
    hasOpsToken: Boolean(session.opsToken),
    expiresAt: session.expiresAt,
  };
};

const sessionTable = (summary: ReturnType<typeof describeSession>): void => {
  printFacts([
    ["Request", chalk.gray(summary.requestId)],
    ["Organization", summary.organizationId ?? chalk.gray("none")],
    ["Scopes", summary.scopes.join(", ")],
    ["Functions", summary.functions.length > 0 ? summary.functions.join(", ") : chalk.gray("none")],
    ["Default project", summary.defaultProject ?? chalk.gray("none")],
    ["Expires", new Date(summary.expiresAt).toLocaleString()],
    ["Session file", summary.sessionFile],
  ]);
};

/** What a redeemed session prints: the command to start with, then the session. */
const printRedeemed = ({
  summary,
  suggestedCall,
}: {
  summary: ReturnType<typeof describeSession>;
  suggestedCall: string | null;
}): void => {
  if (summary.hasApiKey) {
    console.log(
      chalk.green("Access granted. Run a normal command on it with --ops-session, e.g.:"),
    );
    console.log(chalk.cyan("  langwatch trace search --ops-session"));
  } else if (suggestedCall) {
    console.log(chalk.green("Access granted. Call an approved function, e.g.:"));
    console.log(chalk.cyan(`  ${suggestedCall}`));
  } else {
    console.log(
      chalk.green("Access granted. Each function's input: langwatch ops functions -o json"),
    );
  }
  sessionTable(summary);
};

/** A first `ops call` line built from the server's input schemas; null when it can't be read. */
const suggestFirstCall = async ({ session }: { session: OpsSession }): Promise<string | null> => {
  const approved = session.functions ?? [];
  if (!session.opsToken || approved.length === 0) return null;
  try {
    const page = await staffAccessFetch<{ items: ListedFunction[] }>({
      method: "GET",
      path: "/api/staff-access/functions",
      bearer: session.opsToken,
      endpoint: session.endpoint,
    });
    return suggestOpsCall({ approved, listing: page.items, now: new Date() }) ?? null;
  } catch {
    return null;
  }
};

/** Redeems an approved request and writes the session file. */
const redeemInto = async ({
  requestId,
  codeVerifier,
  endpoint,
  requesterKey,
  project,
}: {
  requestId: string;
  codeVerifier: string;
  endpoint: string;
  requesterKey: string;
  project?: string;
}): Promise<CommandResult> => {
  const redeemed = await staffAccessFetch<Redeemed>({
    method: "POST",
    path: `/api/staff-access/requests/${encodeURIComponent(requestId)}/redeem`,
    bearer: requesterKey,
    body: { codeVerifier },
    endpoint,
  });
  const projects = (redeemed.projects ?? []).flatMap((entry) => {
    const parsed = opsProjectSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  const session: OpsSession = {
    version: 1,
    endpoint,
    requestId,
    ...(redeemed.apiKey ? { apiKey: redeemed.apiKey } : {}),
    ...(redeemed.opsToken ? { opsToken: redeemed.opsToken } : {}),
    ...(redeemed.organizationId ? { organizationId: redeemed.organizationId } : {}),
    projects,
    scopes: redeemed.scopes,
    ...(redeemed.functions && redeemed.functions.length > 0
      ? { functions: redeemed.functions }
      : {}),
    expiresAt: redeemed.expiresAt,
    createdAt: new Date().toISOString(),
  };
  const chosen = pickSessionProject({ session, selector: project });
  if (project && !chosen) {
    console.error(
      chalk.yellow(`Project "${project}" is not in this session; using the first project instead.`),
    );
  }
  const defaultProject = chosen ?? projects[0];
  if (defaultProject) session.defaultProjectId = defaultProject.id;
  const file = saveOpsSession(session);
  forgetPendingRequest({ requestId });
  const summary = describeSession({ session, file });
  const suggestedCall = session.apiKey ? null : await suggestFirstCall({ session });
  return {
    data: { status: "redeemed", ...summary, suggestedCall },
    table: () => printRedeemed({ summary, suggestedCall }),
  };
};

/** Polls the request until it is decided or its approval window closes. */
const waitForDecision = async ({
  requestId,
  endpoint,
  requesterKey,
  expiresAt,
}: {
  requestId: string;
  endpoint: string;
  requesterKey: string;
  expiresAt: string;
}): Promise<string> => {
  const deadline = Date.parse(expiresAt);
  for (;;) {
    const current = await staffAccessFetch<RequestStatus>({
      method: "GET",
      path: `/api/staff-access/requests/${encodeURIComponent(requestId)}`,
      bearer: requesterKey,
      endpoint,
    });
    if (current.status !== "pending") return current.status;
    if (Number.isFinite(deadline) && Date.now() >= deadline) return "expired";
    await sleep(OPS_POLL_INTERVAL_MS);
  }
};

const refuseUndecided = ({ requestId, status }: { requestId: string; status: string }): never => {
  forgetPendingRequest({ requestId });
  if (status === "denied") throw opsAuthError(`Request ${requestId} was denied.`);
  if (status === "expired") {
    throw opsAuthError(`Request ${requestId} expired before it was approved. Request again.`);
  }
  throw opsAuthError(`Request ${requestId} is ${status}; it cannot be redeemed.`);
};

/**
 * `langwatch ops access request`: answers at once with the request id; `--wait` polls until it
 * is decided. A request waits two hours; `ops access redeem <id>` finishes it later.
 */
export const opsAccessRequestCommand = async ({
  scope = [],
  fn = [],
  org,
  reason,
  project,
  wait = false,
}: {
  scope?: string[];
  fn?: string[];
  org?: string;
  reason?: string;
  project?: string;
  wait?: boolean;
}): Promise<CommandResult> => {
  const scopes = [...new Set(scope.map((value) => value.trim()).filter(Boolean))];
  const functions = [...new Set(fn.map((value) => value.trim()).filter(Boolean))];
  if (scopes.length === 0) throw validationError("Pass at least one --scope.");
  const why = reason?.trim();
  if (!why) throw validationError("Pass --reason with why this access is needed.");
  if (why.length > 500) throw validationError("--reason is limited to 500 characters.");

  const requesterKey = requireRequesterKey();
  const endpoint = getEndpoint();
  const { codeVerifier, codeChallenge } = createPkcePair();
  const created = await staffAccessFetch<CreatedRequest>({
    method: "POST",
    path: "/api/staff-access/requests",
    bearer: requesterKey,
    body: {
      scopes,
      ...(org?.trim() ? { organization: org.trim() } : {}),
      reason: why,
      codeChallenge,
      codeChallengeMethod: "S256",
      machine: describeMachine(),
      ...(functions.length > 0 ? { functions } : {}),
    },
    endpoint,
  });
  storePendingRequest({
    requestId: created.requestId,
    pending: {
      endpoint,
      codeVerifier,
      approvalUrl: created.approvalUrl,
      expiresAt: created.expiresAt,
      ...(project ? { project } : {}),
    },
  });

  console.error(chalk.bold("Approve this request with your passkey:"));
  console.error(`  ${chalk.cyan(created.approvalUrl)}`);
  const redeemHint = `langwatch ops access redeem ${created.requestId}`;
  const statusHint = `langwatch ops access status ${created.requestId}`;

  if (!wait) {
    return {
      data: {
        status: "pending",
        requestId: created.requestId,
        approvalUrl: created.approvalUrl,
        expiresAt: created.expiresAt,
        next: redeemHint,
        check: statusHint,
      },
      table: () => {
        console.log(chalk.gray(`Request ${created.requestId} waits until ${created.expiresAt}.`));
        console.log(chalk.gray(`Check it: ${statusHint}`));
        console.log(chalk.gray(`After approval, run: ${redeemHint}`));
      },
    };
  }

  console.error(
    chalk.gray(`Waiting for approval until ${new Date(created.expiresAt).toLocaleTimeString()}...`),
  );
  const status = await waitForDecision({
    requestId: created.requestId,
    endpoint,
    requesterKey,
    expiresAt: created.expiresAt,
  });
  if (status !== "approved") refuseUndecided({ requestId: created.requestId, status });
  return redeemInto({
    requestId: created.requestId,
    codeVerifier,
    endpoint,
    requesterKey,
    project,
  });
};

/** `langwatch ops access redeem <id>`: finishes a request once it is approved. */
export const opsAccessRedeemCommand = async ({
  requestId,
  project,
}: {
  requestId: string;
  project?: string;
}): Promise<CommandResult> => {
  const pending = takePendingRequest({ requestId });
  if (!pending) {
    throw validationError(
      `No pending request ${requestId} on this machine, or its approval window closed.`,
    );
  }
  const requesterKey = requireRequesterKey();
  const current = await staffAccessFetch<RequestStatus>({
    method: "GET",
    path: `/api/staff-access/requests/${encodeURIComponent(requestId)}`,
    bearer: requesterKey,
    endpoint: pending.endpoint,
  });
  if (current.status === "pending") {
    throw validationError(
      `Request ${requestId} is still waiting for approval at ${pending.approvalUrl}`,
    );
  }
  if (current.status !== "approved") refuseUndecided({ requestId, status: current.status });
  return redeemInto({
    requestId,
    codeVerifier: pending.codeVerifier,
    endpoint: pending.endpoint,
    requesterKey,
    project: project ?? pending.project,
  });
};

/** `langwatch ops access status <id>`: where one request stands on the server. */
const requestStatus = async ({ requestId }: { requestId: string }): Promise<CommandResult> => {
  const pending = takePendingRequest({ requestId });
  const current = await staffAccessFetch<RequestStatus>({
    method: "GET",
    path: `/api/staff-access/requests/${encodeURIComponent(requestId)}`,
    bearer: requireRequesterKey(),
    ...(pending ? { endpoint: pending.endpoint } : {}),
  });
  const next = nextStepOf({ status: current.status, requestId, approvalUrl: pending?.approvalUrl });
  return {
    data: { requestId, ...current, next },
    table: () => {
      printFacts([
        ["Request", chalk.gray(requestId)],
        ["Status", current.status],
        ["Waits until", current.expiresAt ?? chalk.gray("-")],
        ["Next", next ?? chalk.gray("nothing; request again if still needed")],
      ]);
    },
  };
};

/**
 * `langwatch ops access status [id]`: with an id, that request on the server; without, the
 * local session, how long it has left, and the requests still waiting on this machine.
 */
export const opsAccessStatusCommand = async ({
  requestId,
}: { requestId?: string } = {}): Promise<CommandResult> => {
  if (requestId) return requestStatus({ requestId });
  const state = readOpsSession();
  const waiting = Object.entries(listPendingRequests()).map(([id, entry]) => ({
    requestId: id,
    approvalUrl: entry.approvalUrl,
    expiresAt: entry.expiresAt,
  }));
  const printWaiting = () => {
    for (const entry of waiting) {
      console.log(chalk.gray(`Waiting: ${entry.requestId} until ${entry.expiresAt}`));
    }
  };
  if (state.kind === "none") {
    return {
      data: { status: "none", pending: waiting },
      table: () => {
        console.log(chalk.gray("No ops session on this machine."));
        printWaiting();
      },
    };
  }
  if (state.kind === "invalid") {
    return {
      data: { status: "invalid", sessionFile: state.file },
      table: () =>
        console.log(chalk.yellow(`The ops session file ${state.file} could not be read.`)),
    };
  }
  const summary = describeSession({ session: state.session, file: state.file });
  const secondsLeft = Math.max(
    0,
    Math.floor((Date.parse(state.session.expiresAt) - Date.now()) / 1000),
  );
  return {
    data: { status: state.kind, ...summary, expiresInSeconds: secondsLeft, pending: waiting },
    table: () => {
      printWaiting();
      console.log(
        state.kind === "live"
          ? chalk.green(`Ops session live, ${Math.ceil(secondsLeft / 60)} min left.`)
          : chalk.yellow("Ops session expired."),
      );
      sessionTable(summary);
    },
  };
};

/** `langwatch ops access end`: revokes the session server side, then removes the file. */
export const opsAccessEndCommand = async (): Promise<CommandResult> => {
  const state = readOpsSession();
  if (state.kind === "none") throw validationError("There is no ops session to end.");
  if (state.kind === "invalid") {
    removeOpsSession();
    return {
      data: { status: "removed", sessionFile: state.file },
      table: () => console.log(chalk.gray(`Removed unreadable session file ${state.file}.`)),
    };
  }
  const requesterKey = requireRequesterKey();
  try {
    await staffAccessFetch<unknown>({
      method: "POST",
      path: `/api/staff-access/requests/${encodeURIComponent(state.session.requestId)}/end`,
      bearer: requesterKey,
      endpoint: state.session.endpoint,
    });
  } catch (error) {
    // An expired session has nothing left to revoke; a live one keeps its file so `end` can retry.
    if (state.kind === "live") throw error;
  }
  removeOpsSession();
  return {
    data: { status: "ended", requestId: state.session.requestId, sessionFile: state.file },
    table: () => {
      console.log(
        chalk.green(`Ops session ${state.session.requestId} ended; ${state.file} removed.`),
      );
    },
  };
};

/** `langwatch ops access withdraw <id>`: takes back a request nobody decided yet. */
export const opsAccessWithdrawCommand = async ({
  requestId,
}: {
  requestId: string;
}): Promise<CommandResult> => {
  const pending = takePendingRequest({ requestId });
  await staffAccessFetch<unknown>({
    method: "POST",
    path: `/api/staff-access/requests/${encodeURIComponent(requestId)}/withdraw`,
    bearer: requireRequesterKey(),
    body: {},
    ...(pending ? { endpoint: pending.endpoint } : {}),
  });
  forgetPendingRequest({ requestId });
  return {
    data: { status: "withdrawn", requestId },
    table: () => console.log(chalk.green(`Request ${requestId} withdrawn.`)),
  };
};

function nextStepOf({
  status,
  requestId,
  approvalUrl,
}: {
  status: string;
  requestId: string;
  approvalUrl: string | undefined;
}): string | null {
  if (status === "approved") return `langwatch ops access redeem ${requestId}`;
  if (status === "pending") return `approve at ${approvalUrl ?? "the approval URL"}`;
  return null;
}
