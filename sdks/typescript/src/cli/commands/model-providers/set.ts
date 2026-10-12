import chalk from "chalk";

import { ModelProvidersApiService } from "@/client-sdk/services/model-providers/model-providers-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";

/**
 * Return configuration without echoing apiKey (key material); never emit
 * service's full provider map, just what was asked about.
 */
export const setModelProviderCommand = async (
  provider: string,
  options: { enabled?: boolean; apiKey?: string; defaultModel?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const service = new ModelProvidersApiService();
  const spinner = createSpinner(`Configuring model provider "${provider}"...`).start();

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

    spinner.succeed(`Configured model provider "${chalk.cyan(provider)}"`);

    return {
      data: {
        provider,
        enabled: options.enabled ?? true,
        defaultModel: options.defaultModel ?? null,
      },
      table: () => {
        // Nothing further to print: the spinner line above was the whole
        // human output before the migration, and stays so.
      },
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "configure model provider" });
    process.exit(1);
  }
};
