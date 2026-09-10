/**
 * The permission the local surface DECLARES, enforced on the key that calls it.
 *
 * The door resolves its own credential, so the framework chain never runs its
 * declared `langy:create`. It used to resolve the key, bridge to the owning
 * user and go straight to the conversation, which let a key narrowed below
 * that permission reach local control on the strength of its holder's Langy
 * access. Driven through the real route, because the missing call was in the
 * route's own authorization step.
 *
 * @see specs/langy/langy-local-control.feature
 */
import { createAppRestSecurity, type AppRestSecurity } from "@langwatch/api/rest";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createLangyLocalRestApp, type LangyLocalRestMembers } from "../langy-local.api.ts";

const PROJECT_ID = "project-123";
const ORGANIZATION_ID = "organization-1";
const USER_ID = "user-1";
const CONVERSATION_ID = "conversation-1";

const WORKSPACE_URL = `http://api.test/api/langy/local/workspace?conversationId=${CONVERSATION_ID}`;

/** The refusal a ceiling denial answers with, rendered so a test can read it. */
const renderHandled: ErrorHandler = (error, c) => {
  const handled = error as { httpStatus?: number; code?: string };
  return typeof handled.httpStatus === "number"
    ? c.json({ error: handled.code ?? "error" }, handled.httpStatus as never)
    : c.json({ error: String(error) }, 500);
};

function passThroughSecurity(): AppRestSecurity {
  const noop: MiddlewareHandler = async (_c, next) => next();
  const unreachable = () => {
    throw new Error("A handler-managed family must not reach the framework auth chain.");
  };
  return createAppRestSecurity({
    appContext: noop,
    requestLogger: () => noop,
    requestTracer: () => noop,
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
    authenticateProject: unreachable,
    authorizeProjectPermission: unreachable,
    authorizeApiKeyCeiling: unreachable,
    authenticateOrganization: unreachable,
    authorizeOrganizationPermission: unreachable,
    authorizeRouteTeamPermission: unreachable,
    authorizeRouteProjectPermission: unreachable,
    authenticateOrganizationThrowing: noop,
    authorizeOrganizationPermissionThrowing: unreachable,
  } as never);
}

/** The deployment's ceiling: it throws for a key that lacks the permission. */
function ceiling(granted: boolean) {
  return vi.fn(async () => {
    if (granted) return undefined;
    throw Object.assign(new Error("api key permission denied"), {
      httpStatus: 403,
      code: "api_key_permission_denied",
    });
  });
}

function buildApi(options: { granted: boolean }) {
  const enforceCeiling = ceiling(options.granted);
  const tryFindVisible = vi.fn(async () => ({ id: CONVERSATION_ID, title: "Instrument tracing" }));

  const ports: LangyLocalRestMembers = {
    readCredential: () => ({ token: "test-token", projectId: PROJECT_ID }),
    apiKeys: () =>
      ({
        findResolvedToken: async () => ({
          type: "apiKey" as const,
          apiKeyId: "key-1",
          userId: USER_ID,
          organizationId: ORGANIZATION_ID,
          ingestSourceType: null,
          ingestionTemplateId: null,
          project: {
            id: PROJECT_ID,
            name: "Project",
            slug: "project",
            teamId: "team-1",
            organizationId: ORGANIZATION_ID,
            isPersonal: false,
            ownerUserId: null,
          },
        }),
        markUsed: vi.fn(),
      }) as never,
    enforceCeiling,
    // The holder HAS Langy access: the refusal below must come from the key's
    // own grants, not from the person failing the cohort gate.
    featureFlags: () => ({ isEnabled: async () => true }) as never,
    actors: () => ({ user: { findUnique: async () => ({ id: USER_ID }) } }) as never,
    langy: () => ({ tryFindVisible }) as never,
    runtime: () =>
      ({
        presence: { read: async () => null },
        requests: { tryFindOpenForConversation: async () => null },
      }) as never,
    commands: () => ({}) as never,
    users: () => ({ tryReadPreference: async () => null }),
    github: () => ({ readInstallation: async () => ({ installed: false }) }),
    baseHost: undefined,
    skipGate: (() => true) as never,
  };

  const app = createLangyLocalRestApp({ security: passThroughSecurity(), ports });

  return {
    enforceCeiling,
    tryFindVisible,
    workspace: () => app.request(WORKSPACE_URL, { headers: { "X-Auth-Token": "test-token" } }),
  };
}

describe("given a key held by someone with Langy access", () => {
  describe("when the key does not carry the local surface's permission", () => {
    /** @scenario "A key without the local surface's permission is refused" */
    it("refuses before the conversation is read", async () => {
      const api = buildApi({ granted: false });

      const response = await api.workspace();

      expect(response.status).toBe(403);
      expect(api.enforceCeiling).toHaveBeenCalledWith(
        expect.objectContaining({ permission: "langy:create" }),
      );
      expect(api.tryFindVisible).not.toHaveBeenCalled();
    });
  });

  describe("when the key carries the local surface's permission", () => {
    /** @scenario "A key carrying the permission reaches the local surface" */
    it("serves the call", async () => {
      const api = buildApi({ granted: true });

      const response = await api.workspace();

      expect(response.status).toBe(200);
      expect(api.tryFindVisible).toHaveBeenCalled();
    });
  });
});
