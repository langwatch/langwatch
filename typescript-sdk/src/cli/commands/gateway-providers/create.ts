import chalk from "chalk";
import ora from "ora";
import {
  type ProviderRotationPolicy,
  GatewayProvidersApiService,
} from "@/client-sdk/services/gateway-providers/gateway-providers-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";

export interface CreateGatewayProviderOptions {
  modelProvider: string;
  slot?: string;
  rateLimitRpm?: string;
  rateLimitTpm?: string;
  rateLimitRpd?: string;
  rotationPolicy?: ProviderRotationPolicy;
  fallbackPriority?: string;
  format?: string;
}

function parseIntOrUndefined(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

export const createGatewayProviderCommand = async (
  options: CreateGatewayProviderOptions,
): Promise<void> => {
  checkApiKey();

  const service = new GatewayProvidersApiService();
  const spinner = ora(`Binding provider "${options.modelProvider}"...`).start();

  try {
    const provider = await service.create({
      model_provider_id: options.modelProvider,
      slot: options.slot,
      rate_limit_rpm: parseIntOrUndefined(options.rateLimitRpm) ?? null,
      rate_limit_tpm: parseIntOrUndefined(options.rateLimitTpm) ?? null,
      rate_limit_rpd: parseIntOrUndefined(options.rateLimitRpd) ?? null,
      rotation_policy: options.rotationPolicy,
      fallback_priority_global: parseIntOrUndefined(options.fallbackPriority) ?? null,
    });

    spinner.succeed(`Bound provider — id: ${chalk.cyan(provider.id)}`);

    if (options.format === "json") {
      console.log(JSON.stringify(provider, null, 2));
      return;
    }

    console.log();
    console.log(chalk.gray("Use this id when binding a virtual key: ") + provider.id);
    console.log();
  } catch (error) {
    failSpinner({ spinner, error, action: "create gateway provider binding" });
    process.exit(1);
  }
};
