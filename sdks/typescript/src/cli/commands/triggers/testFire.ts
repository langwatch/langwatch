import chalk from "chalk";
import { resolveCredentials } from "../../utils/apiKey.ts";
import { failSpinnerFromResponse } from "../../utils/failFromResponse.ts";
import type { CommandResult } from "../../utils/output.ts";
import { createSpinner } from "../../utils/spinner.ts";
import { failSpinner } from "../../utils/spinnerError.ts";
import { triggerRequest } from "./triggerRequest.ts";

/**
 * Send an automation's message to the destination it is configured with, so
 * an operator can confirm it arrives. The destination is the saved one — there
 * is nothing to pass here, and nothing this command could send anywhere else.
 */
export const testFireTriggerCommand = async (
  id: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const spinner = createSpinner(`Test-firing trigger "${id}"...`).start();

  try {
    const response = await triggerRequest({
      path: `/${encodeURIComponent(id)}/test-fire`,
      method: "POST",
    });

    if (!response.ok) {
      await failSpinnerFromResponse({ spinner, response, action: "test-fire trigger" });
      process.exit(1);
    }

    const parsed: {
      channel: string;
      recipientCount: number;
      usedDefault: boolean;
      missingVariables?: string[];
      errors?: string[];
      httpStatus?: number;
    } = await response.json();
    // The annotation is not validation: a control plane that omits either array
    // must not make the CLI throw after reporting success.
    const result = {
      ...parsed,
      missingVariables: parsed.missingVariables ?? [],
      errors: parsed.errors ?? [],
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
