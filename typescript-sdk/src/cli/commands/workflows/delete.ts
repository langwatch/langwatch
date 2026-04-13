import chalk from "chalk";
import ora from "ora";
import {
  WorkflowsApiService,
  WorkflowsApiError,
} from "@/client-sdk/services/workflows/workflows-api.service";
import { checkApiKey } from "../../utils/apiKey";

export const deleteWorkflowCommand = async (id: string): Promise<void> => {
  checkApiKey();

  const service = new WorkflowsApiService();

  const resolveSpinner = ora(`Finding workflow "${id}"...`).start();
  let workflowName: string;
  try {
    const workflow = await service.get(id);
    workflowName = workflow.name;
    resolveSpinner.succeed(`Found workflow "${workflowName}"`);
  } catch (error) {
    resolveSpinner.fail();
    if (error instanceof WorkflowsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error finding workflow: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }

  const deleteSpinner = ora(`Archiving workflow "${workflowName}"...`).start();
  try {
    await service.delete(id);
    deleteSpinner.succeed(`Archived workflow "${chalk.cyan(workflowName)}"`);
  } catch (error) {
    deleteSpinner.fail();
    if (error instanceof WorkflowsApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error archiving workflow: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};
