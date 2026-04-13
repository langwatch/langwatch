import chalk from "chalk";
import ora from "ora";
import {
  ModelProvidersApiService,
  ModelProvidersApiError,
} from "@/client-sdk/services/model-providers/model-providers-api.service";
import { checkApiKey } from "../../utils/apiKey";

export const setModelProviderCommand = async (
  provider: string,
  options: { enabled?: boolean; apiKey?: string; defaultModel?: string },
): Promise<void> => {
  checkApiKey();

  const service = new ModelProvidersApiService();
  const spinner = ora(`Configuring model provider "${provider}"...`).start();

  try {
    const customKeys: Record<string, string> = {};
    if (options.apiKey) {
      // Map common provider names to their expected key field
      const keyFieldMap: Record<string, string> = {
        openai: "OPENAI_API_KEY",
        anthropic: "ANTHROPIC_API_KEY",
        azure: "AZURE_API_KEY",
        google: "GOOGLE_API_KEY",
        groq: "GROQ_API_KEY",
        cohere: "COHERE_API_KEY",
      };
      const keyField = keyFieldMap[provider] ?? `${provider.toUpperCase()}_API_KEY`;
      customKeys[keyField] = options.apiKey;
    }

    await service.set(provider, {
      enabled: options.enabled ?? true,
      ...(Object.keys(customKeys).length > 0 && { customKeys }),
      ...(options.defaultModel && { defaultModel: options.defaultModel }),
    });

    spinner.succeed(
      `Configured model provider "${chalk.cyan(provider)}"`,
    );
  } catch (error) {
    spinner.fail();
    if (error instanceof ModelProvidersApiError) {
      console.error(chalk.red(`Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `Error configuring model provider: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
    }
    process.exit(1);
  }
};
