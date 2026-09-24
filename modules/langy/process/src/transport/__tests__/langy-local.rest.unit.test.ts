/**
 * Local surface's declared permission is enforced by the framework's own
 * project door; each route hands the request's credential to one operation.
 * @see specs/langy/langy-local-control.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  createRestRuntime,
  recordProjectCredential,
  type RestResolvedProjectCredential,
} from "@langwatch/api/rest";
import {
  type LangyApi,
  LangyConversationNotFoundError,
  LangyLocalRecordNotFoundError,
} from "@langwatch/langy-contract";
import type { ErrorHandler } from "hono";
import { describe, expect, it, vi } from "vitest";

import { langyLocalRest } from "../langy-local.rest.ts";

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
  const getLocalWorkspace = vi.fn<LangyApi["getLocalWorkspace"]>(async (input) => {
    if (options.own === false) throw new LangyConversationNotFoundError(input.conversationId);
    return {
      connected: false,
      codeAccessPreference: null,
      github: { installed: false },
    };
  });
  const getLocalCallAnswer = vi.fn<LangyApi["getLocalCallAnswer"]>(async () => {
    throw new LangyLocalRecordNotFoundError();
  });

  const app = createApiFixture<LangyApi>({ getLocalWorkspace, getLocalCallAnswer });

  const runtime = createRestRuntime({
    identity: { authenticate },
  });

  const hono = runtime.mount(langyLocalRest.router(), {
    app: () => app,
    onError: renderHandled,
  });

  return {
    authenticate,
    getLocalWorkspace,
    workspace: () => hono.request(WORKSPACE_URL),
    readCall: (callId: string) => hono.request(`http://api.test/api/langy/local/calls/${callId}`),
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
      expect(api.getLocalWorkspace).not.toHaveBeenCalled();
    });
  });

  describe("when the key carries the local surface's permission", () => {
    /** @scenario "A key carrying the permission reaches the local surface" */
    it("serves the call with the key's own credential", async () => {
      const api = buildApi({ granted: true });

      const response = await api.workspace();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        connected: false,
        codeAccessPreference: null,
        github: { installed: false },
      });
      expect(api.getLocalWorkspace).toHaveBeenCalledWith({
        credential: resolvedCredential,
        conversationId: CONVERSATION_ID,
      });
    });
  });
});

describe("given a teammate shared their conversation with the project", () => {
  describe("when a Langy key of mine names that conversation", () => {
    it("answers not found, as for a conversation that does not exist", async () => {
      const api = buildApi({ granted: true, own: false });

      const response = await api.workspace();

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "langy_conversation_not_found" });
    });
  });
});

describe("given a call whose record has lapsed", () => {
  describe("when the worker polls it", () => {
    /** @scenario "A poll for a lapsed call or question answers a handled not found" */
    it("answers a handled not found the worker reads as still pending", async () => {
      const api = buildApi({ granted: true });

      const response = await api.readCall("call-gone");

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "langy_local_record_not_found" });
    });
  });
});
