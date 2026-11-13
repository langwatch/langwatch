import chalk from "chalk";

import { getEndpoint } from "../../utils/endpoint";
import { commandValidationError } from "../../utils/errorOutput";
import {
  createPkcePair,
  describeMachine,
  forgetPendingRequest,
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
    ["Default project", summary.defaultProject ?? chalk.gray("none")],
    ["Expires", new Date(summary.expiresAt).toLocaleString()],
    ["Session file", summary.sessionFile],
  ]);
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
  return {
    data: { status: "redeemed", ...summary },
    table: () => {
      console.log(
        chalk.green("Access granted. Run a normal command on it with --ops-session, e.g.:"),
      );
      console.log(chalk.cyan("  langwatch trace search --ops-session"));
      sessionTable(summary);
    },
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

/** `langwatch ops access request`. */
export const opsAccessRequestCommand = async ({
  scope = [],
  org,
  reason,
  project,
  wait = true,
}: {
  scope?: string[];
  org?: string;
  reason?: string;
  project?: string;
  wait?: boolean;
}): Promise<CommandResult> => {
  const scopes = [...new Set(scope.map((value) => value.trim()).filter(Boolean))];
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

  if (!wait) {
    return {
      data: {
        status: "pending",
        requestId: created.requestId,
        approvalUrl: created.approvalUrl,
        expiresAt: created.expiresAt,
        next: redeemHint,
      },
      table: () => {
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

/** `langwatch ops access redeem <id>`: finishes a `--no-wait` request. */
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

/** `langwatch ops access status`: the local session and how long it has left. */
export const opsAccessStatusCommand = (): CommandResult => {
  const state = readOpsSession();
  if (state.kind === "none") {
    return {
      data: { status: "none" },
      table: () => console.log(chalk.gray("No ops session on this machine.")),
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
    data: { status: state.kind, ...summary, expiresInSeconds: secondsLeft },
    table: () => {
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
