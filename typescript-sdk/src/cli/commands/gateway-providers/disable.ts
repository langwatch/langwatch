import chalk from "chalk";
import ora from "ora";
import { GatewayProvidersApiService } from "@/client-sdk/services/gateway-providers/gateway-providers-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export const disableGatewayProviderCommand = async (
  id: string,
  options?: { format?: string },
): Promise<void> => {
  checkApiKey();

  const service = new GatewayProvidersApiService();
  const spinner = ora(`Disabling provider binding "${id}"...`).start();

  try {
    const row = await service.disable(id);

    spinner.succeed(`Disabled provider binding "${chalk.cyan(row.id)}"`);

    if (options?.format === "json") {
      console.log(JSON.stringify(row, null, 2));
      return;
    }

    console.log();
    console.log(chalk.gray("Disabled at: ") + (row.disabled_at ? new Date(row.disabled_at).toLocaleString() : chalk.gray("—")));
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "disable gateway provider binding" });
    process.exit(1);
  }
};
