/** The control family reads the terminal's user off the door's actor, never the credential (§8). */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  bindRestMiddleware,
  canonicalErrorResponse,
  createRestRuntime,
  type RestCaller,
} from "@langwatch/api/rest";
import { describe, expect, it, vi } from "vitest";

import type { LocalControlRuntime } from "#repositories/redis/redis.langy-local-control-runtime.repository";

import type { LocalControlLongPoll } from "../langy-local-control-long-poll.rest.ts";
import {
  type LangyLocalControlRestMembers,
  langyLocalControlRest,
  langyLocalControlRestMembers,
} from "../langy-local-control.rest.ts";

function familyFor(actor: RestCaller["actor"]) {
  const listOpen = vi.fn<LocalControlRuntime["requests"]["listOpen"]>(async () => []);
  const members: LangyLocalControlRestMembers = {
    runtime: () =>
      createApiFixture<LocalControlRuntime>({
        requests: createApiFixture<LocalControlRuntime["requests"]>({ listOpen }),
      }),
    longPoll: () => createApiFixture<LocalControlLongPoll>(),
    baseHost: "https://app.test",
    permissions: () => ({ getDecision: () => Promise.reject(new Error("no request to decide")) }),
  };
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor, scope: { tier: "project", id: "project-1" } }),
    },
  });
  const family = runtime.mount(langyLocalControlRest.router(), {
    app: () => createApiFixture(),
    onError: (error, context) => canonicalErrorResponse(error, context),
    facts: [bindRestMiddleware(langyLocalControlRestMembers, () => members)],
  });

  return { listOpen, list: () => family.request("http://api.test/api/langy/control/requests") };
}

describe("listing the terminal's open requests", () => {
  describe("given a key a person owns", () => {
    it("reads that person's requests", async () => {
      const { listOpen, list } = familyFor({ type: "user", id: "user-1" });

      const response = await list();

      expect(response.status).toBe(200);
      expect(listOpen).toHaveBeenCalledWith({ userId: "user-1" });
    });
  });

  describe("given a key no person owns", () => {
    it("refuses as an invalid request without reading any", async () => {
      const { listOpen, list } = familyFor(null);

      const response = await list();

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "langy_local_request_invalid" });
      expect(listOpen).not.toHaveBeenCalled();
    });
  });
});
