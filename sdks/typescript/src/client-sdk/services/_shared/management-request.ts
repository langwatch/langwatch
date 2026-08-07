/**
 * The raw-fetch request path the management API services share.
 *
 * Every one of them talks to an organization-scoped REST family with the same
 * three-step failure handling the api-keys service established: read the body,
 * build the English sentence, raise the typed `LangWatchHandledError` when the
 * platform NAMED the failure, and otherwise throw the family's own error class
 * with that same sentence. Nine copies of that would drift; this is the one
 * copy, parameterised by the family's error constructor.
 *
 * The families answer two error envelopes and both land here unchanged:
 * `@langwatch/api` services send `{code, message, meta, tips?, docsUrl?}`,
 * while api-keys, teams, groups and the instance-admin family send the legacy
 * `{error, message}`. `handledErrorFrom` reads either, so the caller never has
 * to know which family it is holding.
 */
import { formatApiErrorForOperation } from "./format-api-error";
import { throwIfHandledError } from "./throw-handled-error";

/** Builds the family's own error for a failure the platform did not name. */
export type ManagementErrorFactory = (params: {
  message: string;
  operation: string;
  body: unknown;
}) => Error;

export interface ManagementRequestConfig {
  endpoint: string;
  /** The bearer credential; an organization key, or the instance-admin key. */
  token: string;
  /** Raised when the response carries no named platform failure. */
  errorFactory: ManagementErrorFactory;
}

export interface ManagementRequestParams {
  /** What was being attempted, e.g. `list custom roles`. */
  operation: string;
  /** Path from the endpoint root, e.g. `/api/roles`. */
  path: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** JSON request body; omitted for reads. */
  body?: unknown;
  /** Query parameters. Undefined values are left off the URL entirely. */
  query?: Record<string, string | number | boolean | undefined>;
}

/** `?a=1&b=2` for the values that are actually set, or "" when none are. */
export const buildQueryString = (
  query: Record<string, string | number | boolean | undefined> | undefined,
): string => {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const rendered = params.toString();
  return rendered ? `?${rendered}` : "";
};

/**
 * A bound request function for one service: same semantics as the api-keys
 * service's private `request`, with the family's error class supplied once.
 */
export const createManagementRequest = ({
  endpoint,
  token,
  errorFactory,
}: ManagementRequestConfig) => {
  return async <T>({
    operation,
    path,
    method,
    body,
    query,
  }: ManagementRequestParams): Promise<T> => {
    const response = await fetch(
      `${endpoint}${path}${buildQueryString(query)}`,
      {
        ...(method ? { method } : {}),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
    );

    if (!response.ok) {
      let parsedBody: unknown;
      try {
        parsedBody = await response.json();
      } catch {
        parsedBody = await response.text();
      }
      const message = formatApiErrorForOperation({
        operation,
        error: parsedBody,
        options: { status: response.status },
      });
      throwIfHandledError({
        operation,
        error: parsedBody,
        status: response.status,
        message,
      });
      throw errorFactory({ message, operation, body: parsedBody });
    }

    return (await response.json()) as T;
  };
};

export type ManagementRequest = ReturnType<typeof createManagementRequest>;
