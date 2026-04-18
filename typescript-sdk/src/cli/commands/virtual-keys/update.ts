import chalk from "chalk";
import ora from "ora";
import { VirtualKeysApiService } from "@/client-sdk/services/virtual-keys/virtual-keys-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export interface UpdateVirtualKeyOptions {
  name?: string;
  description?: string;
  clearDescription?: boolean;
  provider?: string[];
  configJson?: string;
  configFile?: string;
  format?: string;
}

function parseConfig(options: UpdateVirtualKeyOptions): Record<string, unknown> | undefined {
  if (options.configJson) {
    try {
      return JSON.parse(options.configJson) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`--config-json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (options.configFile) {
    // Lazy-require so the import stays local to the --config-file path
    // (the CLI is an entrypoint shared with scripts that may not need fs).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const raw = readFileSync(options.configFile, "utf8");
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`--config-file is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return undefined;
}

export const updateVirtualKeyCommand = async (
  id: string,
  options: UpdateVirtualKeyOptions,
): Promise<void> => {
  checkApiKey();

  let config: Record<string, unknown> | undefined;
  try {
    config = parseConfig(options);
  } catch (err) {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  const noFieldsProvided =
    options.name === undefined &&
    options.description === undefined &&
    !options.clearDescription &&
    (options.provider === undefined || options.provider.length === 0) &&
    config === undefined;

  if (noFieldsProvided) {
    console.error(
      chalk.red(
        "Error: nothing to update. Provide at least one of --name, --description, --clear-description, --provider, --config-json, --config-file.",
      ),
    );
    process.exit(1);
  }

  const service = new VirtualKeysApiService();
  const spinner = ora(`Updating virtual key "${id}"...`).start();

  try {
    const updated = await service.update(id, {
      name: options.name,
      description: options.clearDescription ? null : options.description,
      provider_credential_ids: options.provider && options.provider.length > 0 ? options.provider : undefined,
      config,
    });

    spinner.succeed(`Updated virtual key "${chalk.cyan(updated.name)}"`);

    if (options.format === "json") {
      console.log(JSON.stringify(updated, null, 2));
      return;
    }

    console.log();
    console.log(`${chalk.bold("ID:")}           ${updated.id}`);
    console.log(`${chalk.bold("Name:")}         ${chalk.cyan(updated.name)}`);
    if (updated.description) console.log(`${chalk.bold("Description:")}  ${updated.description}`);
    console.log(`${chalk.bold("Providers:")}    ${updated.provider_credential_ids.join(", ") || chalk.gray("—")}`);
    console.log(`${chalk.bold("Updated:")}      ${new Date(updated.updated_at).toLocaleString()}`);
    console.log();
    console.log(chalk.gray("Config after update:"));
    console.log(JSON.stringify(updated.config, null, 2));
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "update virtual key" });
    process.exit(1);
  }
};
