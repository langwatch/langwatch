import type { Ora } from "ora";

import { formatApiErrorMessage } from "../../client-sdk/services/_shared/format-api-error";
import { handledErrorFrom } from "../../internal/api/errors";
import { failSpinner } from "./spinnerError";

/**
 * Fails a spinner from a non-2xx `Response`, keeping what the platform
 * named -- the bare-Error pattern this replaces lost the code and status,
 * so a permission refusal reported as a retryable "network_error".
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
    void 0;
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
