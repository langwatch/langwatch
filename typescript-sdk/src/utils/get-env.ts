import { z } from "zod";

/**
 * Environment variable schema using zod for validation.
 * - OPENAI_API_KEY: Optional, for OpenAI API access.
 * - AUTH_SECRET: Required, for authentication.
 * - LANGWATCH_API_KEY: Required, for LangWatch API access.
 * - LANGWATCH_ENDPOINT: Optional, defaults to LangWatch cloud endpoint.
 */
const envSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
  LANGWATCH_API_KEY: z.string().min(1, "LANGWATCH_API_KEY is required"),
  LANGWATCH_ENDPOINT: z
    .string()
    .url()
    .optional()
    .default("https://app.langwatch.ai"),
});

let env: z.infer<typeof envSchema>;

/**
 * Validates and returns environment variables.
 * Throws if required variables are missing or invalid.
 */
export const getEnv = () => {
  // Lazy load the env variables
  if (!env) {
    // Only select relevant env vars for validation
    const envVars = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      AUTH_SECRET: process.env.AUTH_SECRET,
      LANGWATCH_API_KEY: process.env.LANGWATCH_API_KEY,
      LANGWATCH_ENDPOINT: process.env.LANGWATCH_ENDPOINT,
    };

    env = envSchema.parse(envVars);
  }

  return env;
};
