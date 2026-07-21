import chalk from "chalk";
import { createSpinner } from "../../utils/spinner";
import { ModelProvidersApiService } from "@/client-sdk/services/model-providers/model-providers-api.service";
import { checkApiKey } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import type { CommandResult } from "../../utils/output";

/**
 * Returns what was configured rather than printing it: the output port renders
 * it in whatever format the caller asked for (utils/output.ts).
 *
 * `data` keeps the shape the previous `--format json` branch established, which
 * deliberately does NOT echo `options.apiKey`. That value is key material the
 * caller supplied on the command line; the human output never showed it, and a
 * machine payload — far more likely to be logged or piped into an agent's
 * context — must not reintroduce it. The service's own response is not used
 * for the same reason: it is the whole provider map, and re-emitting every
 * provider's entry is more than this command was asked about.
 */
export const setModelProviderCommand = async (
  provider: string,
  options: { enabled?: boolean; apiKey?: string; defaultModel?: string },
): Promise<CommandResult | void> => {
  checkApiKey();

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

    spinner.succeed(
      `Configured model provider "${chalk.cyan(provider)}"`,
    );

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
