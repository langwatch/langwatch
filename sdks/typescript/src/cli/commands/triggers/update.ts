import { scopedApiKey } from "@/internal/credentialContext";
import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";
import { commandValidationError } from "../../utils/errorOutput";
import { buildAuthHeaders } from "@/internal/api/auth";
import { TRIGGER_REQUEST_TIMEOUT_MS } from "./requestTimeout";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the updated trigger rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const updateTriggerCommand = async (
  id: string,
  options: {
    name?: string;
    active?: string;
    message?: string;
    alertType?: string;
    filters?: string;
    filterQuery?: string;
    actionParams?: string;
  },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const spinner = createSpinner(`Updating trigger "${id}"...`).start();

  // Parsed BEFORE the request, in their own narrow guard — the outer catch
  // must not misread a non-JSON API response as a flag the user never passed.
  let parsedFilters: Record<string, unknown> | undefined;
  let parsedActionParams: Record<string, unknown> | undefined;
  try {
    if (options.filters) {
      parsedFilters = JSON.parse(options.filters) as Record<string, unknown>;
    }
    if (options.actionParams) {
      parsedActionParams = JSON.parse(options.actionParams) as Record<string, unknown>;
    }
  } catch {
    failSpinner({
      spinner,
      error: commandValidationError("--filters and --action-params must be valid JSON"),
      action: "update trigger",
    });
    process.exit(1);
  }

  try {
    const body: Record<string, unknown> = {};
    if (options.name) body.name = options.name;
    if (options.active !== undefined) body.active = options.active === "true";
    if (options.message !== undefined) body.message = options.message || null;
    if (options.alertType) body.alertType = options.alertType;
    if (parsedFilters) body.filters = parsedFilters;
    if (options.filterQuery !== undefined) {
      body.filterQuery = options.filterQuery || null;
    }
    // The delivery configuration this automation should have from now on: it
    // replaces the stored one rather than merging into it. A credential the
    // read hid comes back as `[redacted]`; send that to keep the stored value.
    if (parsedActionParams) body.actionParams = parsedActionParams;

    if (Object.keys(body).length === 0) {
      failSpinner({
        spinner,
        error: commandValidationError(
          "No fields to update. Use --name, --active, --message, --alert-type, --filters, --filter-query or --action-params.",
        ),
        action: "update trigger",
      });
      process.exit(1);
    }

    const response = await fetch(`${endpoint}/api/triggers/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(TRIGGER_REQUEST_TIMEOUT_MS),
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders({ apiKey }),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({ spinner, error: new Error(message), action: "update trigger" });
      process.exit(1);
    }

    const trigger = await response.json() as { id: string; name: string; active: boolean };
    spinner.succeed(`Trigger "${trigger.name}" updated`);

    return {
      data: trigger,
      table: () => {
        // Nothing further to print: the spinner line above was the whole
        // human output before the migration, and stays so.
      },
    };
  } catch (error) {
    failSpinner({
      spinner,
      error,
      action: "update trigger",
    });
    process.exit(1);
  }
};
