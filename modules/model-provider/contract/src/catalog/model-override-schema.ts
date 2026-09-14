import { z } from "zod";

/** Validate model override: provider/model shape (deep checks at runtime). */
export const modelOverrideSchema = z
  .string()
  .max(200)
  .regex(
    /^[a-zA-Z0-9_-]+(?:\/[^\s/]+)+$/,
    "Model must be a provider/model id, for example openai/gpt-5-mini",
  );
