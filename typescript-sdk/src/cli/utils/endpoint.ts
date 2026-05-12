import { DEFAULT_ENDPOINT } from "@/internal/constants";

/**
 * Returns the LangWatch endpoint with any trailing slashes stripped, so callers
 * can safely concatenate paths like `${endpoint}/authorize` without producing
 * `https://app.langwatch.ai//authorize`.
 */
export function getEndpoint(): string {
  const raw = process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT;
  return raw.replace(/\/+$/, "");
}
