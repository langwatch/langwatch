import { LangWatch } from "@/client-sdk";

/**
 * Creates a LangWatch SDK instance for CLI commands
 * Uses environment variables for configuration
 */
export function createLangWatchClient(): LangWatch {
  return new LangWatch({
    apiKey: process.env.LANGWATCH_API_KEY,
    endpoint: process.env.LANGWATCH_ENDPOINT,
  });
} 