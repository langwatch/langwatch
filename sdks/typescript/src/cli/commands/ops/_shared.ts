import { langwatchFetch } from "@/internal/http/langwatchFetch";

import { formatApiErrorMessage } from "../../../client-sdk/services/_shared/format-api-error";
import { handledErrorFrom } from "../../../internal/api/errors";
import { getEndpoint } from "../../utils/endpoint";
import { commandAuthError } from "../../utils/errorOutput";
import { printOpsSessionNotice } from "../../utils/identityNotice";
import { loadRequesterKey, OPS_REQUESTER_KEY_ENV, readOpsSession } from "../../utils/opsSession";

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
}: {
  method: "GET" | "POST";
  path: string;
  bearer: string;
  body?: unknown;
  endpoint?: string;
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
