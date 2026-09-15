import { resolveCredentials } from "../../utils/apiKey.ts";
import type { CommandResult } from "../../utils/output.ts";
import { asCommandResult } from "./call.ts";
import { langwatchFetch } from "@/internal/http/langwatchFetch";

/**
 * Bound the request so a quiet socket cannot hold the CLI open forever. This
 * is a plain read of the catalog, so it takes the normal CLI deadline, not the
 * long one `ui call` needs while a page claims and runs the action.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * List every UI action the platform can dispatch to an open page, with each action's JSON
 * schema and required permission (specs/langy/langy-ui-actions.feature). The companion to
 * `ui call`: read the schema here, then dispatch with a payload that matches it.
 */
export const uiActionsCommand = async (): Promise<CommandResult | void> => {
  const { apiKey, endpoint } = await resolveCredentials();

  let response: Response;
  let text: string;
  try {
    response = await langwatchFetch(`${endpoint}/api/v1/langy/ui/actions`, {
      method: "GET",
      headers: { "X-Auth-Token": apiKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // The deadline covers the body too: a socket that goes quiet after the
    // headers aborts this read, not the send.
    text = await response.text();
  } catch (error) {
    // A tripped deadline rejects with a bare TimeoutError, which reads as a
    // crash rather than as the limit this command set. Name it, and leave every
    // other failure to the caller's error path. An aborted body read arrives as
    // an AbortError instead.
    const name = (error as { name?: string } | null)?.name;
    if (name !== "TimeoutError" && name !== "AbortError") throw error;
    process.stderr.write(
      `${endpoint} did not answer with the UI actions within ${REQUEST_TIMEOUT_MS / 1000}s.\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (!response.ok) {
    process.stderr.write(`${text}\n`);
    process.exitCode = 1;
    return;
  }
  return asCommandResult(text);
};
