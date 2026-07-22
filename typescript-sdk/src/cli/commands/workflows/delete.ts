import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { WorkflowsApiService } from "@/client-sdk/services/workflows/workflows-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

export const deleteWorkflowCommand = async (id: string): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new WorkflowsApiService();

  const resolveSpinner = createSpinner(`Finding workflow "${id}"...`).start();
  let workflowName: string;
  try {
    const workflow = await service.get(id);
    workflowName = workflow.name;
    resolveSpinner.succeed(`Found workflow "${workflowName}"`);
  } catch (error) {
    failSpinner({
      spinner: resolveSpinner,
      error,
      action: `find workflow "${id}"`,
    });
    process.exit(1);
  }

  const deleteSpinner = createSpinner(`Archiving workflow "${workflowName}"...`).start();
  try {
    await service.delete(id);
    deleteSpinner.succeed(`Archived workflow "${chalk.cyan(workflowName)}"`);

    return {
      data: { id, name: workflowName, archived: true },
      table: () => {
        // The spinner's success line above is the whole human output.
      },
    };
  } catch (error) {
    failSpinner({
      spinner: deleteSpinner,
      error,
      action: `archive workflow "${workflowName}"`,
    });
    process.exit(1);
  }
};
