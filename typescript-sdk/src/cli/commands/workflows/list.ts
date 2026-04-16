import chalk from "chalk";
import ora from "ora";
import {
  WorkflowsApiService,
  WorkflowsApiError,
} from "@/client-sdk/services/workflows/workflows-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";

export const listWorkflowsCommand = async (options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = new WorkflowsApiService();
  const spinner = ora("Fetching workflows...").start();

  try {
    const workflows = await service.getAll();

    spinner.succeed(
      `Found ${workflows.length} workflow${workflows.length !== 1 ? "s" : ""}`,
    );

    if (options?.format === "json") {
      console.log(JSON.stringify(workflows, null, 2));
      return;
    }

    if (workflows.length === 0) {
      console.log();
      console.log(chalk.gray("No workflows found in this project."));
      return;
    }

    console.log();

    const tableData = workflows.map((w) => {
      const tags: string[] = [];
      if (w.isEvaluator) tags.push("evaluator");
      if (w.isComponent) tags.push("component");

      return {
        Name: w.name,
        ID: w.id,
        Tags: tags.length > 0 ? tags.join(", ") : chalk.gray("—"),
        Updated: formatRelativeTime(w.updatedAt),
      };
    });

    formatTable({
      data: tableData,
      headers: ["Name", "ID", "Tags", "Updated"],
      colorMap: {
        Name: chalk.cyan,
        ID: chalk.green,
        Tags: chalk.yellow,
      },
    });

    console.log();
    console.log(
      chalk.gray(
        `Use ${chalk.cyan("langwatch workflow get <id>")} to view workflow details`,
      ),
    );
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch workflows" });
    process.exit(1);
  }
};
