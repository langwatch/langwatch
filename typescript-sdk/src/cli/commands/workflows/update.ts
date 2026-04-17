import chalk from "chalk";
import ora from "ora";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { failSpinner } from "../../utils/spinnerError";

export const updateWorkflowCommand = async (
  id: string,
  options: { name?: string; icon?: string; description?: string; format?: string },
): Promise<void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const spinner = ora(`Updating workflow "${id}"...`).start();

  try {
    const body: Record<string, string> = {};
    if (options.name) body.name = options.name;
    if (options.icon) body.icon = options.icon;
    if (options.description) body.description = options.description;

    if (Object.keys(body).length === 0) {
      spinner.fail("No fields to update. Use --name, --icon, or --description.");
      process.exit(1);
    }

    const response = await fetch(
      `${endpoint}/api/workflows/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": apiKey,
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const message = await formatFetchError(response);
      spinner.fail(`Failed to update workflow: ${message}`);
      process.exit(1);
    }

    const workflow = await response.json() as {
      id: string;
      name: string;
      icon: string | null;
      description: string | null;
    };

    spinner.succeed(`Workflow "${workflow.name}" updated`);

    if (options.format === "json") {
      console.log(JSON.stringify(workflow, null, 2));
      return;
    }

    console.log();
    console.log(`  ${chalk.gray("ID:")}          ${chalk.green(workflow.id)}`);
    console.log(`  ${chalk.gray("Name:")}        ${chalk.cyan(workflow.name)}`);
    console.log(`  ${chalk.gray("Icon:")}        ${workflow.icon ?? chalk.gray("—")}`);
    console.log(`  ${chalk.gray("Description:")} ${workflow.description ?? chalk.gray("—")}`);
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "update workflow" });
    process.exit(1);
  }
};
