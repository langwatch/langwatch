import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import { buildAuthHeaders } from "@/internal/api/auth";

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
    const response = await fetch(`${endpoint}/api/secrets`, {
      headers: buildAuthHeaders({ apiKey }),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({ spinner, error: new Error(message), action: "fetch secrets" });
      process.exit(1);
    }

    const secrets = (await response.json()) as Array<{
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
