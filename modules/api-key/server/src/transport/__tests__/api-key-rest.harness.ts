/**
 * The `/api/api-keys` family on a runtime that stands in for the process: one
 * organization door, the credential fact a mount binds, and the flat legacy
 * envelope this family publishes.
 */
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import {
  bindRestMiddleware,
  createRestRuntime,
  ForbiddenError,
  HttpError,
  UnauthorizedError,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { apiKeyRest, apiKeyRestCredential } from "../api-key.rest.ts";
import { TestApiKeyService } from "./support/test-api-key-service.ts";

export const ORGANIZATION_ID = "organization-1";
export const CALLER_USER_ID = "user-caller";
export const OTHER_USER_ID = "user-other";
export const API_KEY_ID = "api-key-credential";

/**
 * Which credential the request arrives with. A service credential acts as
 * NOBODY — its user is null — and that, not `keyType`, is what makes a mint
 * privileged.
 */
export const AS_MEMBER = "member-credential";
export const AS_SERVICE = "service-credential";

/** The member a presented credential acts as, or `undefined` for one nobody issued. */
function callerOf(request: Request): string | null | undefined {
  const presented = request.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (presented === AS_MEMBER) return CALLER_USER_ID;
  if (presented === AS_SERVICE) return null;

  return undefined;
}

/** The flat `{ error, message }` body this family has always published. */
const renderRefusal: RestErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    return c.json(
      { error: error.code, message: error.message },
      (error.httpStatus ?? 500) as ContentfulStatusCode,
    );
  }
  if (error instanceof HttpError) {
    return c.json({ error: error.error, message: error.message }, error.status);
  }

  return c.json({ error: "Internal server error" }, 500);
};

/** The family over one API-key boundary the test may stub method by method. */
export function mountApiKeyRest(
  options: { apiKeys?: Partial<TestApiKeyService>; granted?: readonly string[] } = {},
) {
  const apiKeys: ApiKeyApi = Object.assign(new TestApiKeyService(), options.apiKeys);
  const granted = new Set(options.granted ?? ["organization:view", "organization:manage"]);

  const runtime = createRestRuntime({
    identity: {
      authenticate: ({ request, permission }) => {
        const userId = callerOf(request);
        if (userId === undefined) throw new UnauthorizedError("Invalid credential");
        if (!granted.has(permission)) throw new ForbiddenError("Missing permission");

        return {
          actor: userId ? { type: "user", id: userId } : { type: "api_key", id: API_KEY_ID },
          scope: { tier: "organization", id: ORGANIZATION_ID },
        };
      },
    },
  });

  const hono = runtime.mount(apiKeyRest.router(), {
    app: () => apiKeys,
    onError: renderRefusal,
    facts: [
      bindRestMiddleware(apiKeyRestCredential, (c) => ({
        apiKeyId: API_KEY_ID,
        userId: callerOf(c.req.raw) ?? null,
      })),
    ],
  });

  const send = (path: string, init: { method?: string; body?: unknown; as?: string } = {}) =>
    hono.fetch(
      new Request(`http://api.test${path}`, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${init.as ?? AS_MEMBER}`,
          "Content-Type": "application/json",
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    );

  return { hono, send };
}
