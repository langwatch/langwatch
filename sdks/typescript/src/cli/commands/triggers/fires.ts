import { resolveCredentials } from "../../utils/apiKey.ts";
import { failSpinnerFromResponse } from "../../utils/failFromResponse.ts";
import { formatTable } from "../../utils/formatting.ts";
import type { CommandResult } from "../../utils/output.ts";
import { createSpinner } from "../../utils/spinner.ts";
import { failSpinner } from "../../utils/spinnerError.ts";
import { isRecord } from "./summary.ts";
import { triggerRequest } from "./triggerRequest.ts";

interface Fire {
  id: string;
  firedAt: string;
  resolvedAt: string | null;
}

/** Reads a fires page: the paginated `{ fires, nextCursor }` body, or the bare
 *  array an older deployment answers with (which has no next page). */
function readFirePage(body: unknown): {
  fires: Fire[];
  nextCursor: string | null;
} {
  if (Array.isArray(body)) return { fires: body, nextCursor: null };
  if (!isRecord(body)) return { fires: [], nextCursor: null };
  const list = Array.isArray(body.fires) ? body.fires : body.data;
  return {
    fires: Array.isArray(list) ? list : [],
    nextCursor: typeof body.nextCursor === "string" ? body.nextCursor : null,
  };
}

/** What an automation has done, newest first. Metadata only: no trace ids and
 *  no trace content, the same contract the dashboard's fire panel reads. */
export const triggerFiresCommand = async ({
  id,
  options = {},
}: {
  id: string;
  options?: { limit?: string; cursor?: string };
}): Promise<CommandResult | void> => {
  await resolveCredentials();

  const spinner = createSpinner(`Fetching fires for "${id}"...`).start();

  try {
    const query = new URLSearchParams();
    if (options.limit) query.set("limit", options.limit);
    if (options.cursor) query.set("cursor", options.cursor);
    const search = query.toString() ? `?${query.toString()}` : "";
    const response = await triggerRequest({
      path: `/${encodeURIComponent(id)}/fires${search}`,
    });

    if (!response.ok) {
      await failSpinnerFromResponse({ spinner, response, action: "list trigger fires" });
      process.exit(1);
    }

    const { fires, nextCursor } = readFirePage(await response.json());
    spinner.succeed(`Found ${fires.length} fire(s)`);

    return {
      data: { fires, nextCursor },
      table: () => {
        if (fires.length === 0) {
          console.log(
            options.cursor ? "\n  No more fires.\n" : "\n  This automation has not fired yet.\n",
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
