import { z } from "zod";

/**
 * Shape validation for a stored model override (scenario / run plan
 * simulator and judge models). Accepts any provider-prefixed id,
 * including the virtual "latest" aliases (`openai/latest`,
 * `anthropic/latest-mini`, ...), which follow the same shape. Rejects
 * bare ids like "latest" or "gpt-5-mini" that no downstream provider
 * call could ever resolve. Deeper checks (is the provider enabled, does
 * the model exist) stay at execution time, where the project's provider
 * configuration is known.
 */
export const modelOverrideSchema = z
  .string()
  .max(200)
  .regex(
    /^[a-zA-Z0-9_-]+(?:\/[^\s/]+)+$/,
    "Model must be a provider/model id, for example openai/gpt-5-mini",
  );
