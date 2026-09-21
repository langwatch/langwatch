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

/**
 * Reads a failed fetch `Response` into `{ status, body }` for `failSpinner`.
 *
 * The error reader (`handledErrorFromThrown`) can take the status and the
 * body the platform wrote and keep the failure handled: a 422 stays
 * `validation_error` with its reasons, a 404 stays `not_found`. Flattening
 * the body into an `Error` message first — what `formatFetchError` does —
 * loses the code and the status, and the failure degrades to
 * `network_error` with advice about the network.
 */
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
