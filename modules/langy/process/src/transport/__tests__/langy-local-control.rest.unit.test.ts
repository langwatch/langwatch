/** The control family hands the door's actor to one operation and answers its result (§8). */
import { createApiFixture } from "@langwatch/api-fixture";
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import { type LangyApi, LangyLocalRequestInvalidError } from "@langwatch/langy-contract";
import { describe, expect, it, vi } from "vitest";

import { langyLocalControlRest } from "../langy-local-control.rest.ts";

const OWNER = { type: "user", id: "user-1" } as const;
const APPROVED = {
  sessionKey: "sk-lw-session",
  endpoint: "https://app.test",
  conversation: { id: "conversation-1", title: "A conversation", url: "https://app.test/c/1" },
};

function family(actor: typeof OWNER | null) {
  const ops = {
    listLocalControlRequests: vi.fn<LangyApi["listLocalControlRequests"]>(async (input) => {
      if (!input.actor) throw new LangyLocalRequestInvalidError();
      return { requests: [] };
    }),
    approveLocalControlRequest: vi.fn<LangyApi["approveLocalControlRequest"]>(async () => APPROVED),
    cancelLocalControlRequest: vi.fn<LangyApi["cancelLocalControlRequest"]>(async (input) => ({
      id: input.requestId,
      cancelled: true,
    })),
  };
  const hono = createRestRuntime({
    identity: { authenticate: () => ({ actor, scope: { tier: "project", id: "project-1" } }) },
  }).mount(langyLocalControlRest.router(), {
    app: () => createApiFixture<LangyApi>(ops),
    onError: (error, context) => canonicalErrorResponse(error, context),
  });
  const post = (path: string, body?: unknown) =>
    hono.request(`http://api.test${path}`, {
      method: "POST",
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    });
  return { ops, get: (path: string) => hono.request(`http://api.test${path}`), post };
}

describe("the terminal's control requests", () => {
  it("lists the key owner's open requests at the v1 path main published", async () => {
    const api = family(OWNER);

    const response = await api.get("/api/v1/langy/control/requests");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ requests: [] });
    expect(api.ops.listLocalControlRequests).toHaveBeenCalledWith({ actor: OWNER });
  });

  it("refuses a key no person owns as an invalid request", async () => {
    const api = family(null);

    const response = await api.get("/api/v1/langy/control/requests");

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "langy_local_request_invalid" });
  });

  it("answers an approval's session key once, status 200", async () => {
    const api = family(OWNER);

    const response = await api.post("/api/v1/langy/control/requests/request-1/approve", {
      workspace: { root: "/home/ada/repo", name: "repo", os: "darwin" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(APPROVED);
    expect(api.ops.approveLocalControlRequest).toHaveBeenCalledWith({
      actor: OWNER,
      requestId: "request-1",
    });
  });

  it("answers a cancelled request, status 200", async () => {
    const api = family(OWNER);

    const response = await api.post("/api/v1/langy/control/requests/request-1/cancel");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "request-1", cancelled: true });
    expect(api.ops.cancelLocalControlRequest).toHaveBeenCalledWith({
      actor: OWNER,
      requestId: "request-1",
    });
  });
});
