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
  type RestErrorHandler,
  UnauthorizedError,
} from "@langwatch/api/rest";
import type { PrincipalRef } from "@langwatch/authorization";
import { HandledError } from "@langwatch/handled-error";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { apiKeyIngestionCaller, apiKeyRest, apiKeyRestCredential } from "../api-key.rest.ts";
import { TestApiKeyService } from "./support/test-api-key-service.ts";
import type { RestAuditRow } from "@langwatch/api/hosting";

export const ORGANIZATION_ID = "organization-1";
export const CALLER_USER_ID = "user-caller";
export const OTHER_USER_ID = "user-other";
export const API_KEY_ID = "api-key-credential";
export const PROJECT_ID = "project-1";

/**
 * Which credential the request arrives with. A service credential acts as
 * NOBODY — its user is null — and that, not `keyType`, is what makes a mint
 * privileged.
 */
export const AS_MEMBER = "member-credential";
export const AS_SERVICE = "service-credential";
/** A person's project-bound sign-in session, which the project door admits as that person. */
export const AS_SESSION = "session-credential";

function presentedOf(request: Request): string | undefined {
  return request.headers.get("Authorization")?.replace(/^Bearer /, "");
}

/** The member a presented credential acts as, or `undefined` for one nobody issued. */
function callerOf(request: Request): string | null | undefined {
  const presented = presentedOf(request);
  if (presented === AS_MEMBER || presented === AS_SESSION) return CALLER_USER_ID;
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
  const granted = new Set(
    options.granted ?? ["organization:view", "organization:manage", "traces:create"],
  );
  // The trail the two addressed management routes declare. The runtime refuses
  // to mount a declared action with nowhere to write it, so a family that
  // stopped auditing would fail here rather than go quiet in production.
  const audit: RestAuditRow[] = [];

  const runtime = createRestRuntime({
    audit: {
      record: (row) => {
        audit.push(row);
      },
    },
    identity: {
      authenticate: ({ request, permission }) => {
        const userId = callerOf(request);
        if (userId === undefined) throw new UnauthorizedError("Invalid credential");
        if (!granted.has(permission)) throw new ForbiddenError("Missing permission");

        return {
          actor: userId ? { type: "user", id: userId } : { type: "api_key", id: API_KEY_ID },
          scope:
            permission === "traces:create"
              ? { tier: "project", id: PROJECT_ID }
              : { tier: "organization", id: ORGANIZATION_ID },
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
      bindRestMiddleware(apiKeyIngestionCaller, (c) => {
        const userId = callerOf(c.req.raw);
        const principal: PrincipalRef =
          presentedOf(c.req.raw) === AS_SESSION && userId
            ? { type: "user", id: userId }
            : { type: "apiKey", id: API_KEY_ID };
        return { principal, organizationId: ORGANIZATION_ID };
      }),
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

  return { hono, send, audit };
}
