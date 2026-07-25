import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { AgentsApiService } from "@/client-sdk/services/agents/agents-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the archival outcome rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 */
export const deleteAgentCommand = async (id: string): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new AgentsApiService();
  const spinner = createSpinner(`Archiving agent "${id}"...`).start();

  try {
    const result = await service.delete(id);
    spinner.succeed(
      `Archived agent "${chalk.cyan(result.name)}" ${chalk.gray(`(id: ${result.id})`)}`,
    );

    return {
      data: result,
      table: () => {
        // The spinner's success line is the human output.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "archive agent" });
    process.exit(1);
  }
};
