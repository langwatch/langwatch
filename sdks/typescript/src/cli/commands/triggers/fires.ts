import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { buildAuthHeaders } from "@/internal/api/auth";
import { TRIGGER_REQUEST_TIMEOUT_MS } from "./requestTimeout";
import { scopedApiKey } from "@/internal/credentialContext";
import { resolveCredentials } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { langwatchFetch } from "@/internal/http/langwatchFetch";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import { readFirePage } from "./summary";

/** What an automation has done, newest first. Metadata only: no trace ids and
 *  no trace content, the same contract the dashboard's fire panel reads. */
export const triggerFiresCommand = async (
  id: string,
  options: { limit?: string; cursor?: string } = {},
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const spinner = createSpinner(`Fetching fires for "${id}"...`).start();

  try {
    const query = new URLSearchParams();
    if (options.limit) query.set("limit", options.limit);
    if (options.cursor) query.set("cursor", options.cursor);
    const search = query.toString() ? `?${query.toString()}` : "";
    const response = await langwatchFetch(
      `${endpoint}/api/triggers/${encodeURIComponent(id)}/fires${search}`,
      {
        headers: buildAuthHeaders({ apiKey }),
        signal: AbortSignal.timeout(TRIGGER_REQUEST_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({
        spinner,
        error: new Error(message),
        action: "list trigger fires",
      });
      process.exit(1);
    }

    const { fires, nextCursor } = readFirePage<{
      id: string;
      firedAt: string;
      resolvedAt: string | null;
    }>(await response.json());
    spinner.succeed(`Found ${fires.length} fire(s)`);

    return {
      data: { fires, nextCursor },
      table: () => {
        if (fires.length === 0) {
          console.log(
            options.cursor
              ? "\n  No more fires.\n"
              : "\n  This automation has not fired yet.\n",
          );
          return;
        }
        console.log();
        formatTable({
          data: fires.map((fire) => ({
            ID: fire.id,
            Fired: fire.firedAt,
            Resolved: fire.resolvedAt ?? "-",
          })),
          headers: ["ID", "Fired", "Resolved"],
        });
        console.log();
        if (nextCursor) {
          console.log(`  Next page: --cursor ${nextCursor}`);
          console.log();
        }
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "list trigger fires" });
    process.exit(1);
  }
};
