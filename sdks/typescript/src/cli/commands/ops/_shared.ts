import chalk from "chalk";

import { langwatchFetch } from "@/internal/http/langwatchFetch";

import { formatApiErrorMessage } from "../../../client-sdk/services/_shared/format-api-error";
import { handledErrorFrom, isLangWatchHandledError } from "../../../internal/api/errors";
import { getEndpoint } from "../../utils/endpoint";
import { commandAuthError } from "../../utils/errorOutput";
import { printOpsSessionNotice } from "../../utils/identityNotice";
import {
  forgetPendingRequest,
  loadRequesterKey,
  OPS_REQUESTER_KEY_ENV,
  readOpsSession,
} from "../../utils/opsSession";

/** A local "not authorised yet" refusal, thrown as an Error so stacks and catches keep working. */
export const opsAuthError = (message: string): Error =>
  Object.assign(new Error(message), commandAuthError(message));

/** The requester key from `ops setup`, or the environment; refuses when neither holds one. */
export const requireRequesterKey = (): string => {
  const key = loadRequesterKey() ?? process.env[OPS_REQUESTER_KEY_ENV]?.trim();
  if (key) return key;
  throw opsAuthError(
    `No ops requester key. Copy it from the Ops agents page and run \`pbpaste | langwatch ops setup\`, or set ${OPS_REQUESTER_KEY_ENV}.`,
  );
};

/** The live session's ops token, for the `ops:read` routes. */
export const requireOpsToken = (): { opsToken: string; endpoint: string } => {
  const state = readOpsSession();
  if (state.kind === "live" && state.session.opsToken) {
    printOpsSessionNotice({
      requestId: state.session.requestId,
      organizationId: state.session.organizationId,
      expiresAt: state.session.expiresAt,
    });
    return { opsToken: state.session.opsToken, endpoint: state.session.endpoint };
  }
  const reasons: Record<typeof state.kind, string> = {
    expired: "The ops session expired.",
    live: "The ops session was not granted the ops:read scope.",
    none: "There is no ops session.",
    invalid: "The ops session file could not be read.",
  };
  const why = reasons[state.kind];
  throw opsAuthError(
    `${why} Run \`langwatch ops access request --scope ops:read --reason "<why>"\` first.`,
  );
};

/** Calls a staff-access route and answers its JSON, throwing the platform's own error. */
export const staffAccessFetch = async <T>({
  method,
  path,
  bearer,
  body,
  endpoint = getEndpoint(),
  signal,
}: {
  method: "GET" | "POST";
  path: string;
  bearer: string;
  body?: unknown;
  endpoint?: string;
  signal?: AbortSignal;
}): Promise<T> => {
  const url = `${endpoint.replace(/\/+$/, "")}${path}`;
  const response = await langwatchFetch(url, {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });
  const raw = await response.text();
  let parsed: unknown = raw;
  try {
    parsed = raw === "" ? {} : (JSON.parse(raw) as unknown);
  } catch {
    parsed = raw;
  }
  if (response.ok) return parsed as T;
  const message = formatApiErrorMessage({
    error: parsed,
    options: { status: response.status },
  });
  throw (
    handledErrorFrom({
      operation: `${method} ${path}`,
      body: parsed,
      status: response.status,
      message,
    }) ?? new Error(`${method} ${path} failed: ${message}`)
  );
};

/** How often a waiting request asks whether it was decided. */
export const OPS_POLL_INTERVAL_MS = 2_000;

export interface RequestStatus {
  status: string;
  expiresAt?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls the request until it is decided or its approval window closes. A failed read keeps it
 * polling, and each distinct failure is said once on stderr so an outage is never silent.
 */
export const waitForDecision = async ({
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
  let lastFailure: string | undefined;
  for (;;) {
    const current = await pollStatus({ requestId, endpoint, requesterKey });
    if ("failure" in current) {
      if (current.failure !== lastFailure) {
        console.error(
          chalk.yellow(`Could not read request ${requestId} (${current.failure}); still waiting.`),
        );
      }
      lastFailure = current.failure;
    } else if (current.status !== "pending") {
      return current.status;
    }
    if (Number.isFinite(deadline) && Date.now() >= deadline) return "expired";
    await sleep(OPS_POLL_INTERVAL_MS);
  }
};

/** One status read; a failed read the platform did not refuse by name answers its failure. */
const pollStatus = async ({
  requestId,
  endpoint,
  requesterKey,
}: {
  requestId: string;
  endpoint: string;
  requesterKey: string;
}): Promise<RequestStatus | { failure: string }> => {
  try {
    return await staffAccessFetch<RequestStatus>({
      method: "GET",
      path: `/api/staff-access/requests/${encodeURIComponent(requestId)}`,
      bearer: requesterKey,
      endpoint,
    });
  } catch (error) {
    if (isLangWatchHandledError(error) && error.httpStatus < 500) throw error;
    return { failure: error instanceof Error ? error.message : String(error) };
  }
};

export const refuseUndecided = ({
  requestId,
  status,
}: {
  requestId: string;
  status: string;
}): never => {
  forgetPendingRequest({ requestId });
  if (status === "denied") throw opsAuthError(`Request ${requestId} was denied.`);
  if (status === "expired") {
    throw opsAuthError(`Request ${requestId} expired before it was approved. Request again.`);
  }
  throw opsAuthError(`Request ${requestId} is ${status}; it cannot be redeemed.`);
};
