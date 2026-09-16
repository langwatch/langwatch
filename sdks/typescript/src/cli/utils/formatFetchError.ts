import { formatApiErrorMessage } from "../../client-sdk/services/_shared/format-api-error";

/**
 * Reads a failed fetch `Response` into a user-facing error message: parses
 * JSON, falls back to raw text. Status code is threaded through so generic
 * or empty bodies at least surface "status N".
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

/** Reads a failed fetch Response into {status, body} for failSpinner.
 * Preserves handled errors (422 stays validation_error, etc.) vs flattening. */
export async function readFetchFailure(
  response: Response,
): Promise<{ status: number; body: unknown }> {
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON body — pass the raw text through */
  }
  return { status: response.status, body };
}
