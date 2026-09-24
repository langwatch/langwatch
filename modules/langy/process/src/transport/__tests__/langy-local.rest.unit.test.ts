/**
 * Local surface's declared permission is enforced by the framework's own
 * project door; each route hands the door's actor and project to one operation
 * and answers its result as JSON, status 200, body unchanged.
 * @see specs/langy/langy-local-control.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { canonicalErrorResponse, createRestRuntime, type RestCaller } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import {
  type LangyApi,
  LangyConversationNotFoundError,
  LangyLocalRecordNotFoundError,
} from "@langwatch/langy-contract";
import { describe, expect, it, vi } from "vitest";

import { langyLocalRest } from "../langy-local.rest.ts";

const PROJECT_ID = "project-123";
const USER_ID = "user-1";
const CONVERSATION_ID = "conversation-1";
const OWNER = { type: "user", id: USER_ID } as const;
const KEY = { actor: OWNER, projectId: PROJECT_ID };

const TURN = { conversationId: CONVERSATION_ID, turnId: "turn-1" };
const WORKSPACE = { connected: false, codeAccessPreference: null, github: { installed: false } };
const REQUEST = {
  id: "request-1",
  conversationId: CONVERSATION_ID,
  conversationTitle: "A conversation",
  conversationUrl: "https://app.test/project/langy/conversation-1",
  projectId: PROJECT_ID,
  projectName: "Project",
  createdAt: "2026-09-25T00:00:00.000Z",
  expiresAt: "2026-09-25T00:10:00.000Z",
};
const CREATED = { request: REQUEST, command: "npx langwatch langy share" };
const CALL_ANSWER = { callId: "call-1", state: "done", ok: true, text: "ok" } as const;
const WAIT_ANSWER = { waitId: "wait-1", state: "answered" as const, answers: [] };

class ApiKeyPermissionDeniedError extends HandledError {
  constructor() {
    super("api_key_permission_denied", "api key permission denied", { httpStatus: 403 });
  }
}

function buildApi(options: { granted: boolean; own?: boolean; actor?: RestCaller["actor"] }) {
  const authenticate = vi.fn((input: { request: Request; permission: string }) => {
    if (!options.granted) throw new ApiKeyPermissionDeniedError();
    return {
      actor: options.actor === undefined ? OWNER : options.actor,
      scope: { tier: "project" as const, id: PROJECT_ID },
      permission: input.permission,
    };
  });
  const ops = {
    getLocalWorkspace: vi.fn<LangyApi["getLocalWorkspace"]>(async (input) => {
      if (options.own === false) throw new LangyConversationNotFoundError(input.conversationId);
      return WORKSPACE;
    }),
    createLocalControlRequest: vi.fn<LangyApi["createLocalControlRequest"]>(async () => CREATED),
    startLocalCall: vi.fn<LangyApi["startLocalCall"]>(async () => ({ callId: "call-1" })),
    getLocalCallAnswer: vi.fn<LangyApi["getLocalCallAnswer"]>(async (input) => {
      if (input.callId === "call-gone") throw new LangyLocalRecordNotFoundError();
      return CALL_ANSWER;
    }),
    cancelLocalCall: vi.fn<LangyApi["cancelLocalCall"]>(async (input) => ({
      callId: input.callId,
      cancelled: true,
    })),
    startLocalWait: vi.fn<LangyApi["startLocalWait"]>(async () => ({ waitId: "wait-1" })),
    getLocalWaitAnswer: vi.fn<LangyApi["getLocalWaitAnswer"]>(async () => WAIT_ANSWER),
  };

  const hono = createRestRuntime({ identity: { authenticate } }).mount(langyLocalRest.router(), {
    app: () => createApiFixture<LangyApi>(ops),
    onError: (error, context) => canonicalErrorResponse(error, context),
  });
  const send = (path: string, init?: { method: "POST"; body?: unknown }) =>
    hono.request(`http://api.test${path}`, {
      method: init?.method ?? "GET",
      ...(init?.body === undefined
        ? {}
        : { body: JSON.stringify(init.body), headers: { "content-type": "application/json" } }),
    });

  return { authenticate, ops, send };
}

describe("given a key held by someone with Langy access", () => {
  describe("when the key does not carry the local surface's permission", () => {
    /** @scenario "A key without the local surface's permission is refused" */
    it("refuses before the conversation is read", async () => {
      const api = buildApi({ granted: false });

      const response = await api.send(
        `/api/langy/local/workspace?conversationId=${CONVERSATION_ID}`,
      );

      expect(response.status).toBe(403);
      expect(api.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({ permission: "langy:create" }),
      );
      expect(api.ops.getLocalWorkspace).not.toHaveBeenCalled();
    });
  });

  describe("when the key carries the local surface's permission", () => {
    /** @scenario "A key carrying the permission reaches the local surface" */
    it("serves the workspace to the key's owner in the door's project", async () => {
      const api = buildApi({ granted: true });

      const response = await api.send(
        `/api/langy/local/workspace?conversationId=${CONVERSATION_ID}`,
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(WORKSPACE);
      expect(api.ops.getLocalWorkspace).toHaveBeenCalledWith({
        ...KEY,
        conversationId: CONVERSATION_ID,
      });
    });
  });

  describe("when the door put no person behind the key", () => {
    it("hands the operation no actor to refuse on", async () => {
      const api = buildApi({ granted: true, actor: null });

      await api.send(`/api/langy/local/workspace?conversationId=${CONVERSATION_ID}`);

      expect(api.ops.getLocalWorkspace).toHaveBeenCalledWith({
        actor: null,
        projectId: PROJECT_ID,
        conversationId: CONVERSATION_ID,
      });
    });
  });
});

describe("each local route answers its operation's result as JSON with status 200", () => {
  it("creates a control request", async () => {
    const api = buildApi({ granted: true });

    const response = await api.send("/api/langy/local/requests", {
      method: "POST",
      body: { conversationId: CONVERSATION_ID },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(CREATED);
    expect(api.ops.createLocalControlRequest).toHaveBeenCalledWith({
      ...KEY,
      conversationId: CONVERSATION_ID,
    });
  });

  it("starts a call", async () => {
    const api = buildApi({ granted: true });
    const call = { ...TURN, tool: "local_read", params: { path: "README.md" } };

    const response = await api.send("/api/langy/local/calls", { method: "POST", body: call });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ callId: "call-1" });
    expect(api.ops.startLocalCall).toHaveBeenCalledWith({ ...KEY, call });
  });

  it("reads a call's answer", async () => {
    const api = buildApi({ granted: true });

    const response = await api.send("/api/langy/local/calls/call-1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(CALL_ANSWER);
    expect(api.ops.getLocalCallAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ ...KEY, callId: "call-1" }),
    );
  });

  it("cancels a call", async () => {
    const api = buildApi({ granted: true });

    const response = await api.send("/api/langy/local/calls/call-1/cancel", { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ callId: "call-1", cancelled: true });
    expect(api.ops.cancelLocalCall).toHaveBeenCalledWith({ ...KEY, callId: "call-1" });
  });

  it("starts a wait", async () => {
    const api = buildApi({ granted: true });
    const wait = {
      ...TURN,
      kind: "question",
      questions: [{ question: "Which file?", options: [{ label: "README.md" }] }],
    };

    const response = await api.send("/api/langy/waits", { method: "POST", body: wait });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ waitId: "wait-1" });
    expect(api.ops.startLocalWait).toHaveBeenCalledWith({ ...KEY, wait });
  });

  it("reads a wait's answer", async () => {
    const api = buildApi({ granted: true });

    const response = await api.send("/api/langy/waits/wait-1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(WAIT_ANSWER);
    expect(api.ops.getLocalWaitAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ ...KEY, waitId: "wait-1" }),
    );
  });
});

describe("given a teammate shared their conversation with the project", () => {
  describe("when a Langy key of mine names that conversation", () => {
    it("answers not found, as for a conversation that does not exist", async () => {
      const api = buildApi({ granted: true, own: false });

      const response = await api.send(
        `/api/langy/local/workspace?conversationId=${CONVERSATION_ID}`,
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "langy_conversation_not_found" });
    });
  });
});

describe("given a call whose record has lapsed", () => {
  describe("when the worker polls it", () => {
    /** @scenario "A poll for a lapsed call or question answers a handled not found" */
    it("answers a handled not found the worker reads as still pending", async () => {
      const api = buildApi({ granted: true });

      const response = await api.send("/api/langy/local/calls/call-gone");

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "langy_local_record_not_found" });
    });
  });
});
