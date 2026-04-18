import chalk from "chalk";
import ora from "ora";
import { GatewayProvidersApiService } from "@/client-sdk/services/gateway-providers/gateway-providers-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import { failSpinner } from "../../utils/spinnerError";

export const listGatewayProvidersCommand = async (options?: { format?: string }): Promise<void> => {
  checkApiKey();

  const service = new GatewayProvidersApiService();
  const spinner = ora("Fetching gateway provider bindings...").start();

  try {
    const rows = await service.list();

    spinner.succeed(`Found ${rows.length} provider binding${rows.length !== 1 ? "s" : ""}`);

    if (options?.format === "json") {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    if (rows.length === 0) {
      console.log();
      console.log(chalk.gray("No gateway provider bindings configured."));
      console.log(chalk.gray("Bind a provider with:"));
      console.log(chalk.cyan("  langwatch gateway-providers create --model-provider <id>"));
      return;
    }

    const healthChip = (status: string): string => {
      if (status === "healthy") return chalk.green(status);
      if (status === "degraded") return chalk.yellow(status);
      return chalk.red(status);
    };

    const tableData = rows.map((p) => ({
      ID: p.id,
      Provider: p.model_provider_name,
      Slot: p.slot ?? chalk.gray("—"),
      Health: healthChip(p.health_status),
      "Rate (rpm/tpm/rpd)": `${p.rate_limit_rpm ?? "—"}/${p.rate_limit_tpm ?? "—"}/${p.rate_limit_rpd ?? "—"}`,
      Rotation: p.rotation_policy,
      "Fallback#": p.fallback_priority_global?.toString() ?? chalk.gray("—"),
      Disabled: p.disabled_at ? chalk.red("yes") : "",
    }));

    console.log();
    formatTable({
      data: tableData,
      headers: ["ID", "Provider", "Slot", "Health", "Rate (rpm/tpm/rpd)", "Rotation", "Fallback#", "Disabled"],
      colorMap: { ID: chalk.gray, Provider: chalk.cyan },
    });
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "fetch gateway providers" });
    process.exit(1);
  }
};
