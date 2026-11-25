import type { Ora } from "ora";

import { buildRequestHeaders } from "@/internal/api/request-headers";
import { langwatchFetch } from "@/internal/http/langwatchFetch";

import { commandValidationError } from "../../utils/errorOutput";
import { failSpinnerFromResponse } from "../../utils/failFromResponse.ts";
import { pickByReference, ReferenceNotResolvedError } from "../../utils/pickByReference";
import { failSpinner } from "../../utils/spinnerError";

export interface MonitorRow {
  id: string;
  name: string;
  slug: string;
}

// Same shape the platform sends, with only the message replaced. A plain Error would be
// read as `network_error` at status 0.
const monitorNotFoundError = (message: string): Error =>
  Object.assign(new Error(message), {
    isLangWatchHandledError: true,
    code: "monitor_not_found",
    kind: "monitor_not_found",
    httpStatus: 404,
    meta: {},
    isHandled: true,
    retryable: false,
  });

/**
 * The monitor a reference names: the platform's id lookup first, then, on a 404, the
 * project's monitors by slug or display name. `delete`/`update` take an id only
 * (failMonitorResponse). A miss or an ambiguous name throws a command error.
 */
export const findMonitor = async <Monitor extends MonitorRow>({
  endpoint,
  apiKey,
  reference,
}: {
  endpoint: string;
  apiKey: string;
  reference: string;
}): Promise<{ monitor: Monitor } | { failed: Response }> => {
  const headers = buildRequestHeaders({ apiKey });
  const direct = await langwatchFetch(
    `${endpoint}/api/v1/monitors/${encodeURIComponent(reference)}`,
    {
      headers,
    },
  );
  if (direct.ok) return { monitor: (await direct.json()) as Monitor };
  if (direct.status !== 404) return { failed: direct };

  const list = await langwatchFetch(`${endpoint}/api/v1/monitors`, { headers });
  if (!list.ok) return { failed: list };
  try {
    const monitor = pickByReference({
      rows: (await list.json()) as Monitor[],
      reference,
      what: "monitor",
      scope: "project",
      listCommand: "langwatch monitor list",
    });
    return { monitor };
  } catch (error) {
    if (!(error instanceof ReferenceNotResolvedError)) throw error;
    throw error.reason === "none"
      ? monitorNotFoundError(error.message)
      : Object.assign(new Error(error.message), commandValidationError(error.message));
  }
};

/** The miss text for commands that take an exact id, where a name is not accepted. */
export const exactLookupMissMessage = (reference: string): string =>
  `No monitor with the id "${reference}". Find its id with ` +
  "`langwatch monitor get <name>` or `langwatch monitor list`, then pass the id.";

/** For delete/update: a platform 404 gets the exact-lookup message, other failures pass through. */
export const failMonitorResponse = async ({
  spinner,
  response,
  action,
  reference,
}: {
  spinner: Ora;
  response: Response;
  action: string;
  reference: string;
}): Promise<void> => {
  if (response.status !== 404) {
    await failSpinnerFromResponse({ spinner, response, action });
    return;
  }
  failSpinner({
    spinner,
    error: monitorNotFoundError(exactLookupMissMessage(reference)),
    action,
  });
};
