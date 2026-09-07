import type { Ora } from "ora";
import { formatApiErrorMessage } from "../../client-sdk/services/_shared/format-api-error";
import { handledErrorFrom } from "../../internal/api/errors";
import { failSpinner } from "./spinnerError";

/**
 * Fails a spinner from a non-2xx `Response`, keeping whatever the platform
 * named.
 *
 * The pattern this replaces — `new Error(await formatFetchError(response))` —
 * keeps the sentence and throws away everything else. By the time the failure
 * is rendered there is no code and no status left, so `--format json` reports
 * `network_error`, `httpStatus: 0` and `terminal: false`, and the fallback
 * table adds "check your network connection". An agent reading that document
 * is told a permission refusal is a connectivity blip it should retry.
 *
 * Reading the body once and handing it to `handledErrorFrom` keeps the code,
 * the status and the platform's own tips whenever the platform named the
 * failure. When it did not, the fallback is the same sentence the old path
 * produced, so nothing regresses for a bare 500 or an HTML page from a proxy.
 */
export async function failSpinnerFromResponse({
  spinner,
  response,
  action,
  format,
}: {
  spinner: Ora;
  response: Response;
  /** Short description of what was being done, e.g. "create trigger". */
  action: string;
  /** The command's `--format`, when the caller holds it. */
  format?: string;
}): Promise<void> {
  const raw = await response.text();
  let body: unknown = raw;
  try {
    body = JSON.parse(raw);
  } catch {
    /* non-JSON body — pass through as-is, same as formatFetchError */
  }

  const message = formatApiErrorMessage({
    error: body,
    options: { status: response.status },
  });

  const handled = handledErrorFrom({
    body,
    status: response.status,
    message,
  });

  failSpinner({
    spinner,
    error: handled ?? new Error(message),
    action,
    format,
  });
}
