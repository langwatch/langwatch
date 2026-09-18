import { createSpinner } from "../utils/spinner";
import { QueryApiService } from "@/client-sdk/services/query/query-api.service";
import { resolveCredentials } from "../utils/apiKey";
import { formatTable } from "../utils/formatting";
import { failSpinner } from "../utils/spinnerError";
import type { CommandResult } from "../utils/output";

/**
 * `langwatch query "<sql>"` — runs one read-only LangWatchQL `SELECT` and
 * prints the rows. Built for a headless coding agent: no `--project` flag,
 * no `X-Project-Id` header — the configured API key alone decides which
 * projects' rows come back (see `QueryApiService`'s doc comment on why the
 * door is project-implicit).
 *
 * Speaks the CLI output port like `whoami` and `chart schema`: `data` is the
 * rows array so `-o json` (the primary use case here), `-o yaml` and `--jq`
 * all project straight from it; `table` is the human fallback for someone
 * running the command by hand.
 */
export const queryCommand = async (sql: string): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new QueryApiService();
  const spinner = createSpinner("Running query...").start();

  try {
    const result = await service.query({ sql });
    const rowCount = result.rows.length;
    spinner.succeed(`Query complete — ${rowCount} row${rowCount === 1 ? "" : "s"}`);

    return {
      data: result.rows,
      table: () => {
        const headers = result.columns.map((column) => column.name);
        formatTable({
          data: result.rows.map((row) =>
            Object.fromEntries(
              headers.map((header) => [
                header,
                (row as Record<string, unknown>)[header] === undefined
                  ? ""
                  : String((row as Record<string, unknown>)[header]),
              ]),
            ),
          ),
          headers,
          emptyMessage: "No rows returned.",
        });
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "run query" });
    process.exit(1);
  }
};
