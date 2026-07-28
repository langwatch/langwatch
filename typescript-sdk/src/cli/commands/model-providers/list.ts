import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ModelProvidersApiService } from "@/client-sdk/services/model-providers/model-providers-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns the provider map rather than printing it: the output port renders it
 * in whatever format the caller asked for (utils/output.ts).
 *
 * `customKeys` reaches us already masked — `GET /api/model-providers` answers
 * from `getProjectModelProvidersForFrontend`, which runs `maskApiKeys` before
 * serialising — so the raw response carries no key material and needs no
 * further redaction here. The human table only says whether keys EXIST, and
 * that stays true of the machine payload.
 */
export const listModelProvidersCommand = async (): Promise<CommandResult | void> => {
  checkApiKey();

  const service = new ModelProvidersApiService();
  const spinner = createSpinner("Fetching model providers...").start();

  try {
    const providers = await service.list();

    // Response is an object keyed by provider name
    const providerEntries = Object.entries(providers);

    spinner.succeed(`Found ${providerEntries.length} model provider${providerEntries.length !== 1 ? "s" : ""}`);

    return {
      data: providers,
      table: () => {
        if (providerEntries.length === 0) {
          console.log();
          console.log(chalk.gray("No model providers configured."));
          console.log(chalk.gray("Set one up with:"));
          console.log(
            chalk.cyan('  langwatch model-provider set openai --enabled true'),
          );
          return;
        }

        console.log();

        const tableData = providerEntries.map(([key, p]) => ({
          Provider: p.provider ?? key,
          Enabled: p.enabled ? chalk.green("✓") : chalk.red("✗"),
          "Default Model": "—",
          "Has Keys": p.customKeys && Object.keys(p.customKeys).length > 0 ? chalk.green("✓") : chalk.gray("—"),
        }));

        formatTable({
          data: tableData,
          headers: ["Provider", "Enabled", "Default Model", "Has Keys"],
          colorMap: {
            Provider: chalk.cyan,
          },
        });

        console.log();
        console.log(
          chalk.gray(
            `Use ${chalk.cyan("langwatch model-provider set <provider> --enabled true")} to configure a provider`,
          ),
        );
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch model providers" });
    process.exit(1);
  }
};
