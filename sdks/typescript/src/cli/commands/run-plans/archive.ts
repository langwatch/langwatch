import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";
import { createCliRunPlansService } from "./cli-run-plans-service";

/**
 * Archives a run plan. The plan stops being listed and its run history is
 * kept; the scenarios it covered are left where they are.
 *
 * @see specs/features/run-plan-cli.feature
 */
export const archiveRunPlanCommand = async (id: string): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = createCliRunPlansService();
  const spinner = createSpinner(`Archiving run plan "${id}"...`).start();

  try {
    const result = await service.archive(id);

    spinner.succeed(`Run plan "${id}" archived`);

    return {
      data: result,
      table: () => {
        // The spinner's success line is the whole human output.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "archive run plan" });
    process.exit(1);
  }
};
