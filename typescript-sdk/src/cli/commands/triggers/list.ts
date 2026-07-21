import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { checkApiKey } from "../../utils/apiKey";
import { formatFetchError } from "../../utils/formatFetchError";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import { buildAuthHeaders } from "@/internal/api/auth";

import { resolveControlPlaneUrl } from "@/cli/utils/governance/resolveEndpoint";
import type { CommandResult } from "../../utils/output";
import { redactTriggerListSecrets } from "./redact";

/**
 * Returns the listing rather than printing it: the output port renders it in
 * whatever format the caller asked for (utils/output.ts).
 */
export const listTriggersCommand = async (): Promise<CommandResult | void> => {
  checkApiKey();

  const apiKey = process.env.LANGWATCH_API_KEY ?? "";
  const endpoint = resolveControlPlaneUrl();

  const spinner = createSpinner("Fetching triggers...").start();

  try {
    const response = await fetch(`${endpoint}/api/triggers`, {
      headers: buildAuthHeaders({ apiKey }),
    });

    if (!response.ok) {
      const message = await formatFetchError(response);
      failSpinner({ spinner, error: new Error(message), action: "fetch triggers" });
      process.exit(1);
    }

    const triggers = await response.json() as Array<{
      id: string;
      name: string;
      action: string;
      active: boolean;
      alertType: string | null;
    }>;

    spinner.succeed(`Found ${triggers.length} trigger${triggers.length !== 1 ? "s" : ""}`);

    return {
      // See ./redact.ts — actionParams is plaintext and never shown to humans.
      data: redactTriggerListSecrets(triggers),
      table: () => {
        if (triggers.length === 0) {
          console.log();
          console.log(chalk.gray("No triggers found."));
          console.log(chalk.gray("Create one with:"));
          console.log(chalk.cyan('  langwatch trigger create "My Alert" --action SEND_EMAIL'));
          return;
        }

        console.log();

        const tableData = triggers.map((t) => ({
          Name: t.name,
          ID: t.id,
          Action: t.action,
          Status: t.active ? chalk.green("active") : chalk.gray("inactive"),
          Alert: t.alertType ?? chalk.gray("—"),
        }));

        formatTable({
          data: tableData,
          headers: ["Name", "ID", "Action", "Status", "Alert"],
          colorMap: {
            Name: chalk.cyan,
            ID: chalk.green,
          },
        });

        console.log();
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch triggers" });
    process.exit(1);
  }
};
