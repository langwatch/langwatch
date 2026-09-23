/**
 * Local surface's declared permission is enforced by the framework's own
 * project door; the identity bridge on top is this family's own.
 * @see specs/langy/langy-local-control.feature
 */
import {
  bindRestMiddleware,
  createRestRuntime,
  recordProjectCredential,
  type RestResolvedProjectCredential,
} from "@langwatch/api/rest";
import type { ErrorHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  langyLocalRest,
  langyLocalRestMembers,
  type LangyLocalRestMembers,
} from "../langy-local.rest.ts";

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

const resolvedCredential: RestResolvedProjectCredential = {
  type: "apiKey",
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
};

/** The deployment's project door: it throws for a key that lacks the ceiling permission. */
function projectDoor(granted: boolean) {
  const authenticate = vi.fn((input: { request: Request; permission: string }) => {
    if (!granted) {
      throw Object.assign(new Error("api key permission denied"), {
        httpStatus: 403,
        code: "api_key_permission_denied",
      });
    }
    recordProjectCredential(input.request, resolvedCredential);
    return {
      actor: { type: "api_key" as const, id: "key-1" },
      scope: { tier: "project" as const, id: PROJECT_ID },
    };
  });
  return authenticate;
}

function buildApi(options: { granted: boolean; own?: boolean }) {
  const authenticate = projectDoor(options.granted);
  const tryFindVisible = vi.fn(async () => ({
    id: CONVERSATION_ID,
    title: "Instrument tracing",
    lastModel: "gpt-5-mini",
    isOwn: options.own ?? true,
  }));

  const app = { findByIdVisible: tryFindVisible } as never;

  const members: LangyLocalRestMembers = {
    // The holder HAS Langy access: the refusal below must come from the
    // key's own grants, not from the person failing the cohort gate.
    featureFlags: () => ({ isEnabled: async () => true }) as never,
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

  const runtime = createRestRuntime({
    identity: { authenticate },
  });

  const hono = runtime.mount(langyLocalRest.router(), {
    app: () => app,
    onError: renderHandled,
    facts: [bindRestMiddleware(langyLocalRestMembers, () => members)],
  });

  return {
    authenticate,
    tryFindVisible,
    workspace: () => hono.request(WORKSPACE_URL),
  };
}

describe("given a key held by someone with Langy access", () => {
  describe("when the key does not carry the local surface's permission", () => {
    /** @scenario "A key without the local surface's permission is refused" */
    it("refuses before the conversation is read", async () => {
      const api = buildApi({ granted: false });

      const response = await api.workspace();

      expect(response.status).toBe(403);
      expect(api.authenticate).toHaveBeenCalledWith(
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

describe("given a teammate shared their conversation with the project", () => {
  describe("when a Langy key of mine names that conversation", () => {
    /** @scenario "A key never reaches the folder of a teammate's shared conversation" */
    it("answers not found, as for a conversation that does not exist", async () => {
      const api = buildApi({ granted: true, own: false });

      const response = await api.workspace();

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "langy_conversation_not_found" });
    });
  });
});
