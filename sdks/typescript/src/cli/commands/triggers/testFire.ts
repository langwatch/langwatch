import chalk from "chalk";
import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { buildAuthHeaders } from "@/internal/api/auth";
import { TRIGGER_REQUEST_TIMEOUT_MS } from "./requestTimeout";
import { scopedApiKey } from "@/internal/credentialContext";
import { resolveCredentials } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/**
 * Send an automation's message to the destination it is configured with, so
 * an operator can confirm it arrives. The destination is the saved one — there
 * is nothing to pass here, and nothing this command could send anywhere else.
 */
export const testFireTriggerCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const spinner = createSpinner(`Test-firing trigger "${id}"...`).start();

  try {
    const response = await fetch(
      `${endpoint}/api/triggers/${encodeURIComponent(id)}/test-fire`,
      {
        signal: AbortSignal.timeout(TRIGGER_REQUEST_TIMEOUT_MS),
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders({ apiKey }),
        },
      },
    );

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({
        spinner,
        error: new Error(message),
        action: "test-fire trigger",
      });
      process.exit(1);
    }

    const result = (await response.json()) as {
      channel: string;
      recipientCount: number;
      usedDefault: boolean;
      missingVariables: string[];
      errors: string[];
      httpStatus?: number;
    };
    spinner.succeed(`Test fire sent on the ${result.channel} channel`);

    return {
      data: result,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("Recipients:")} ${result.recipientCount}`);
        console.log(
          `  ${chalk.gray("Message:")}    ${
            result.usedDefault
              ? "the LangWatch default"
              : "this automation's own template"
          }`,
        );
        if (result.httpStatus !== undefined) {
          console.log(`  ${chalk.gray("Answered:")}   ${result.httpStatus}`);
        }
        if (result.missingVariables.length > 0) {
          console.log(
            `  ${chalk.yellow("Unresolved:")} ${result.missingVariables.join(", ")}`,
          );
        }
        for (const error of result.errors) {
          console.log(`  ${chalk.red("Problem:")}    ${error}`);
        }
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "test-fire trigger" });
    process.exit(1);
  }
};
