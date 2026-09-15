import { scopedApiKey } from "@/internal/credentialContext";
import chalk from "chalk";
import { createSpinner } from "../../utils/spinner.ts";
import { resolveCredentials } from "../../utils/apiKey.ts";
import { formatFetchError } from "../../utils/formatFetchError.ts";
import { failSpinner } from "../../utils/spinnerError.ts";
import { commandValidationError } from "../../utils/errorOutput.ts";
import { buildAuthHeaders } from "@/internal/api/auth";
import type { CommandResult } from "../../utils/output.ts";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import { langwatchFetch } from "@/internal/http/langwatchFetch";
export const updateWorkflowCommand = async (
  id: string,
  options: { name?: string; icon?: string; description?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const apiKey = scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const spinner = createSpinner(`Updating workflow "${id}"...`).start();

  try {
    const body: Record<string, string> = {};
    if (options.name) body.name = options.name;
    if (options.icon) body.icon = options.icon;
    if (options.description) body.description = options.description;

    if (Object.keys(body).length === 0) {
      failSpinner({
        spinner,
        error: commandValidationError("No fields to update. Use --name, --icon, or --description."),
        action: "update workflow",
      });
      process.exit(1);
    }

    const response = await langwatchFetch(
      `${endpoint}/api/v1/workflows/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders({ apiKey }),
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({ spinner, error: new Error(message), action: "update workflow" });
      process.exit(1);
    }

    const workflow = (await response.json()) as {
      id: string;
      name: string;
      icon: string | null;
      description: string | null;
    };

    spinner.succeed(`Workflow "${workflow.name}" updated`);

    return {
      data: workflow,
      table: () => {
        console.log();
        console.log(`  ${chalk.gray("ID:")}          ${chalk.green(workflow.id)}`);
        console.log(`  ${chalk.gray("Name:")}        ${chalk.cyan(workflow.name)}`);
        console.log(`  ${chalk.gray("Icon:")}        ${workflow.icon ?? chalk.gray("—")}`);
        console.log(`  ${chalk.gray("Description:")} ${workflow.description ?? chalk.gray("—")}`);
        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "update workflow" });
    process.exit(1);
  }
};
