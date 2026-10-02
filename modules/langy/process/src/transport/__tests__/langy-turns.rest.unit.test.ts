import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import type {
  LangyApi,
  LangyStartConversationTurnInput,
  LangyTurnSettlementWait,
  LangyTurnSettlementWaitInput,
} from "@langwatch/langy-contract";
/** @see specs/langy/langy-api-key-turns.feature */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { langyTurnsRest } from "../langy-turns.rest.ts";

const PROJECT_ID = "project-1";
const USER_ID = "user-1";
const ACCEPTED = { conversationId: "conv-1", turnId: "turn-1" };

function buildApi(options: {
  dark?: boolean;
  settle?: (input: LangyTurnSettlementWaitInput) => Promise<LangyTurnSettlementWait>;
}) {
  const started: LangyStartConversationTurnInput[] = [];
  const authenticate = (input: { request: Request; permission: string }) => ({
    actor: { type: "user" as const, id: USER_ID },
    scope: { tier: "project" as const, id: PROJECT_ID },
    permission: input.permission,
  });
  const app = createApiFixture<LangyApi>({
    getRestCaller: async () =>
      options.dark ? { dark: true } : { dark: false, projectId: PROJECT_ID, userId: USER_ID },
    getRestActor: async ({ userId }) => ({ user: { id: userId } }),
    startConversationTurn: async (input) => {
      started.push(input);
      return ACCEPTED;
    },
    awaitTurnSettlement: async (input) =>
      options.settle ? options.settle(input) : { kind: "stopped" },
  });

  const hono = createRestRuntime({ identity: { authenticate } }).mount(langyTurnsRest.router(), {
    app: () => app,
    onError: (error, context) => canonicalErrorResponse(error, context),
  });
  const postRaw = (raw: string, headers: Record<string, string> = {}) =>
    hono.request("http://api.test/api/langy/conversations", {
      method: "POST",
      body: raw,
      headers: { "content-type": "application/json", ...headers },
    });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    postRaw(JSON.stringify(body), headers);

  const postUnmounted = () =>
    hono.request("http://api.test/api/langy/not-a-real-route", { method: "POST" });

  return { post, postRaw, postUnmounted, started };
}

const TURN = {
  idempotencyKey: "idem-1",
  messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
};

describe("given a project key starting a Langy turn", () => {
  describe("when the caller prefers to wait and the turn completes", () => {
    /** @scenario "A caller preferring to wait receives the assistant's output synchronously" */
    it("answers 200 with the reply for that turn and declares the applied preference", async () => {
      const api = buildApi({
        settle: async () => ({
          kind: "settled",
          settlement: { succeeded: true, outcome: "completed", text: "hi there", error: null },
        }),
      });

      const response = await api.post(TURN, { prefer: "wait=30" });

      expect(response.status).toBe(200);
      expect(response.headers.get("preference-applied")).toBe("wait=30");
      expect(await response.json()).toEqual({
        ...ACCEPTED,
        status: "completed",
        error: null,
        reply: { role: "assistant", text: "hi there" },
      });
    });
  });

  describe("when the waited turn fails", () => {
    /** @scenario "A failed turn settles the wait as a domain outcome, not a transport refusal" */
    it("answers 200 carrying the failed status and error with no reply", async () => {
      const api = buildApi({
        settle: async () => ({
          kind: "settled",
          settlement: { succeeded: false, outcome: "failed", text: null, error: "model down" },
        }),
      });

      const response = await api.post(TURN, { prefer: "wait=30" });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: "failed",
        error: "model down",
        reply: null,
      });
    });
  });

  describe("when the wait window expires first", () => {
    /** @scenario "An expired wait degrades to the asynchronous acceptance" */
    it("answers the plain 202 acceptance without declaring a preference", async () => {
      const api = buildApi({
        settle: (input) =>
          new Promise((resolve) =>
            input.signal.addEventListener("abort", () => resolve({ kind: "stopped" })),
          ),
      });

      const response = await api.post(TURN, { prefer: "wait=1" });

      expect(response.status).toBe(202);
      expect(response.headers.get("preference-applied")).toBeNull();
      expect(await response.json()).toEqual(ACCEPTED);
    });
  });

  describe("when the message is plain role-and-text", () => {
    /** @scenario "A plain-text message is accepted without the parts structure" */
    it("accepts it as one text part and keeps structured parts when both are sent", async () => {
      const api = buildApi({});

      await api.post({ idempotencyKey: "a", messages: [{ role: "user", content: "plain" }] });
      await api.post({
        idempotencyKey: "b",
        messages: [{ role: "user", content: "ignored", parts: [{ type: "text", text: "kept" }] }],
      });

      expect(api.started.map((turn) => turn.messages)).toEqual([
        [{ role: "user", parts: [{ type: "text", text: "plain" }] }],
        [{ role: "user", parts: [{ type: "text", text: "kept" }] }],
      ]);
    });
  });
});

describe("given a project key sending a turn the framework refuses", () => {
  describe("when the body is not JSON", () => {
    it("answers 400 malformed_request before any turn starts", async () => {
      const api = buildApi({});

      const response = await api.postRaw("{not json");

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "malformed_request" });
      expect(api.started).toEqual([]);
    });
  });

  describe("when the body misses the schema", () => {
    it("answers 422 validation_error before any turn starts", async () => {
      const api = buildApi({});

      const response = await api.post({ messages: [] });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "validation_error" });
      expect(api.started).toEqual([]);
    });
  });

  describe("when a fresh turn asks to adopt a conversation id it has no path for", () => {
    it("answers 422 validation_error naming adoptConversationId", async () => {
      const api = buildApi({});

      const response = await api.post({ ...TURN, adoptConversationId: true });

      expect(response.status).toBe(422);
      const body = await response.text();
      expect(body).toContain("validation_error");
      expect(body).toContain("adoptConversationId");
      expect(api.started).toEqual([]);
    });
  });
});

describe("given the key-authed surface is switched off for the project", () => {
  describe("when a valid key starts a turn", () => {
    /** @scenario "A switched-off surface answers exactly as a route that does not exist" */
    it("answers exactly what an unrouted path answers, with no envelope", async () => {
      const api = buildApi({ dark: true });

      const dark = await api.post(TURN);
      const unrouted = await api.postUnmounted();

      expect(dark.status).toBe(404);
      expect(dark.status).toBe(unrouted.status);
      expect(dark.headers.get("content-type")).toBe(unrouted.headers.get("content-type"));
      const body = await dark.text();
      expect(body).toBe(await unrouted.text());
      expect(body).not.toContain("trace_id");
      expect(api.started).toEqual([]);
    });
  });
});
