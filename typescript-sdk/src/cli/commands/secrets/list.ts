import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { apiRequest } from "../../utils/apiClient";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the listing rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts). The endpoint returns
 * metadata only — never a secret VALUE — so the raw list is safe as a payload.
 */
export const listSecretsCommand = async (): Promise<CommandResult | void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint =
    resolveControlPlaneUrl();

  const spinner = createSpinner("Fetching secrets...").start();

  try {
    const secrets = (await apiRequest({
      method: "GET",
      path: "/api/secrets",
      apiKey,
      endpoint,
    })) as Array<{
      id: string;
      name: string;
      createdAt: string;
      updatedAt: string;
    }>;

    spinner.succeed(
      `Found ${secrets.length} secret${secrets.length !== 1 ? "s" : ""}`
    );

    return {
      data: secrets,
      table: () => {
        if (secrets.length === 0) {
          console.log();
          console.log(chalk.gray("No secrets found."));
          console.log(chalk.gray("Create one with:"));
          console.log(
            chalk.cyan('  langwatch secret create MY_API_KEY --value "sk-..."')
          );
          return;
        }

        console.log();

        const tableData = secrets.map((s) => ({
          Name: s.name,
          ID: s.id,
          Updated: new Date(s.updatedAt).toLocaleDateString(),
        }));

        formatTable({
          data: tableData,
          headers: ["Name", "ID", "Updated"],
          colorMap: {
            Name: chalk.cyan,
            ID: chalk.green,
          },
        });

        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch secrets" });
    process.exit(1);
  }
};
