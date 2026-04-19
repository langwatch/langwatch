import { formatApiErrorMessage } from "../../client-sdk/services/_shared/format-api-error";

/**
 * Reads a failed fetch `Response` and produces a user-facing error message.
 * Tries to parse the body as JSON; falls back to the raw text. Status code is
 * threaded through as context for the formatter, so generic or empty bodies
 * at least surface "status N" to the user.
 */
export async function formatFetchError(response: Response): Promise<string> {
  const errorBody = await response.text();
  let parsed: unknown = errorBody;
  try {
    parsed = JSON.parse(errorBody);
  } catch {
    /* non-JSON body — pass through as-is */
  }
  return formatApiErrorMessage({
    error: parsed,
    options: { status: response.status },
  });
}
