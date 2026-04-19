import chalk from "chalk";
import ora from "ora";
import { WorkflowsApiService } from "@/client-sdk/services/workflows/workflows-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const deleteWorkflowCommand = async (id: string, options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = new WorkflowsApiService();

  const resolveSpinner = ora(`Finding workflow "${id}"...`).start();
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

  const deleteSpinner = ora(`Archiving workflow "${workflowName}"...`).start();
  try {
    await service.delete(id);
    deleteSpinner.succeed(`Archived workflow "${chalk.cyan(workflowName)}"`);

    if (options?.format === "json") {
      console.log(JSON.stringify({ id, name: workflowName, archived: true }, null, 2));
    }
  } catch (error) {
    failSpinner({
      spinner: deleteSpinner,
      error,
      action: `archive workflow "${workflowName}"`,
    });
    process.exit(1);
  }
};
