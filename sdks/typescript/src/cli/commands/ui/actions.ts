import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { asCommandResult } from "./call";

/**
 * List every UI action the platform can dispatch to an open page, with each
 * action's JSON schema and required permission
 * (specs/langy/langy-ui-actions.feature). The companion to `ui call`: read
 * the schema here, then dispatch with a payload that matches it.
 */
export const uiActionsCommand = async (): Promise<CommandResult | void> => {
  const { apiKey, endpoint } = await resolveCredentials();

  const response = await fetch(`${endpoint}/api/langy/ui/actions`, {
    method: "GET",
    headers: { "X-Auth-Token": apiKey },
  });

  const text = await response.text();
  if (!response.ok) {
    process.stderr.write(`${text}\n`);
    process.exitCode = 1;
    return;
  }
  return asCommandResult(text);
};
