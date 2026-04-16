import chalk from "chalk";
import ora from "ora";
import {
  ModelProvidersApiService,
  ModelProvidersApiError,
} from "@/client-sdk/services/model-providers/model-providers-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { formatApiErrorMessage } from "@/client-sdk/services/_shared/format-api-error";

export const listModelProvidersCommand = async (options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = new ModelProvidersApiService();
  const spinner = ora("Fetching model providers...").start();

  try {
    const providers = await service.list();

    // Response is an object keyed by provider name
    const providerEntries = Object.entries(providers);

    spinner.succeed(`Found ${providerEntries.length} model provider${providerEntries.length !== 1 ? "s" : ""}`);

    if (options?.format === "json") {
      console.log(JSON.stringify(providers, null, 2));
      return;
    }

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
  } catch (error) {
    spinner.fail();
    if (error instanceof ModelProvidersApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error fetching model providers: ${formatApiErrorMessage({ error })}`,
        ),
      );
    }
    process.exit(1);
  }
};
