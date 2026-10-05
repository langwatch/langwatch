/**
 * The `/api/api-keys` family on a runtime that stands in for the process: one
 * organization door, the credential fact a mount binds, and the canonical
 * error envelope the host answers with.
 */
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { RestAuditRow, RestIdentity } from "@langwatch/api/hosting";
import {
  bindRestMiddleware,
  canonicalErrorResponse,
  createRestRuntime,
  ForbiddenError,
  UnauthorizedError,
} from "@langwatch/api/rest";
import type { PrincipalRef } from "@langwatch/authorization";

import { IngestionKeyMintService } from "../../services/ingestion-key-mint.service.ts";
import { apiKeyIngestionCaller, apiKeyRest, apiKeyRestCredential } from "../api-key.rest.ts";
import { TestApiKeyService } from "./support/test-api-key-service.ts";

export const ORGANIZATION_ID = "organization-1";
export const CALLER_USER_ID = "user-caller";
export const OTHER_USER_ID = "user-other";
export const API_KEY_ID = "api-key-credential";
export const PROJECT_ID = "project-1";

/** The permissions the two project-session mint routes ask of the project door. */
const PROJECT_TIER_PERMISSIONS = new Set(["traces:create", "project:manage"]);

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

/** The family over one API-key boundary the test may stub method by method. */
export function mountApiKeyRest(
  options: { apiKeys?: Partial<TestApiKeyService>; granted?: readonly string[] } = {},
) {
  const apiKeys: ApiKeyApi = Object.assign(new TestApiKeyService(), options.apiKeys);
  // The ingestion route's refusals are the real service's, minting through the test's `create`.
  const ingestionKeys = IngestionKeyMintService.create({ apiKeys });
  if (!options.apiKeys?.createIngestionKey) {
    apiKeys.createIngestionKey = (input) => ingestionKeys.createIngestionKey(input);
  }
  const granted = new Set(
    options.granted ?? [
      "organization:view",
      "organization:manage",
      "traces:create",
      "project:manage",
    ],
  );
  // The trail the two addressed management routes declare. The runtime refuses
  // to mount a declared action with nowhere to write it, so a family that
  // stopped auditing would fail here rather than go quiet in production.
  const audit: RestAuditRow[] = [];

  // One identity answers the organization door and the project-session mint routes' project door.
  const door: RestIdentity = {
    authenticate: ({ request, permission }) => {
      const userId = callerOf(request);
      if (userId === undefined) throw new UnauthorizedError("Invalid credential");
      if (!granted.has(permission)) throw new ForbiddenError("Missing permission");

      return {
        actor: userId ? { type: "user", id: userId } : { type: "api_key", id: API_KEY_ID },
        scope: PROJECT_TIER_PERMISSIONS.has(permission)
          ? { tier: "project", id: PROJECT_ID }
          : { tier: "organization", id: ORGANIZATION_ID },
      };
    },
  };

  const runtime = createRestRuntime({
    audit: {
      record: (row) => {
        audit.push(row);
      },
    },
    identity: door,
    doors: { project: door },
  });

  const hono = runtime.mount(apiKeyRest.router(), {
    app: () => apiKeys,
    onError: canonicalErrorResponse,
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
