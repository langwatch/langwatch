/**
 * @vitest-environment node
 * The hotel bot's door through the REST runtime: the browser door asks `ops:manage` at the
 * platform tier and hides the route from everyone else; the caller's key goes in, a refusal
 * comes out by code.
 */
import { SessionReader, type SessionCaller } from "@langwatch/api/hosting";
import {
  BrowserSessionIdentity,
  createCanonicalFamilyErrorHandler,
  createRestRuntime,
} from "@langwatch/api/rest";
import {
  HotelBotDeclinedError,
  type HotelBotRunInput,
  type SampleAgentsApi,
} from "@langwatch/sample-agents-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { hotelBotRest } from "../hotel-bot.rest.ts";

const SESSIONS: Record<string, SessionCaller> = {
  operator: { userId: "operator_1" },
  viewer: { userId: "viewer_1" },
  customer: { userId: "customer_1" },
};
const GRANTS: Record<string, readonly string[]> = {
  operator_1: ["ops:view", "ops:manage"],
  viewer_1: ["ops:view"],
};

function mount(app: Partial<SampleAgentsApi>) {
  const door = BrowserSessionIdentity.create({
    sessions: SessionReader.create({
      verify: async (request: Request) => SESSIONS[request.headers.get("cookie") ?? ""] ?? null,
    }),
    authz: {
      getDecision: async () => ({ permitted: false, organizationRole: null }),
      getPlatformDecision: async ({ userId, permission }) => ({
        permitted: (GRANTS[userId] ?? []).includes(permission),
      }),
    },
    publicBaseUrl: void 0,
  });

  return createRestRuntime({ identity: door, doors: { browser: door } }).mount(
    hotelBotRest.router(),
    {
      app: () => createApiFixture<SampleAgentsApi>(app),
      onError: createCanonicalFamilyErrorHandler({
        loggerName: "langwatch:test:hotel-bot",
        label: "Hotel bot",
      }),
    },
  );
}

function callHotelBot({ cookie }: { cookie: string | null }) {
  return new Request("http://api.test/api/demo/hotel_bot", {
    method: "POST",
    headers: {
      "x-auth-token": "sk-lw-project",
      "sec-fetch-site": "same-origin",
      ...(cookie ? { cookie } : {}),
    },
  });
}

describe("the hotel bot's door", () => {
  describe("given a caller who is not a platform operator holding ops:manage", () => {
    /** @scenario "The hotel bot's door hides the bot from anyone who is not a platform operator" */
    it.each([
      ["no session", null],
      ["a customer", "customer"],
      ["a view-only operator", "viewer"],
    ])("answers %s 404 not_found and never runs the bot", async (_who, cookie) => {
      const runs: HotelBotRunInput[] = [];
      const hono = mount({
        runHotelBot: (input) => {
          runs.push(input);
          return Promise.resolve({ message: "Sent to LangWatch", ragResponse: "never" });
        },
      });

      const response = await hono.fetch(callHotelBot({ cookie }));

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: "not_found" });
      expect(runs).toEqual([]);
    });
  });

  describe("given a platform operator holding ops:manage", () => {
    /** @scenario "The door hands a platform operator's X-Auth-Token to the hotel bot" */
    it("runs the bot with the caller's X-Auth-Token and answers its reply", async () => {
      const runs: HotelBotRunInput[] = [];
      const hono = mount({
        runHotelBot: (input) => {
          runs.push(input);
          return Promise.resolve({ message: "Sent to LangWatch", ragResponse: "Try the bistro." });
        },
      });

      const response = await hono.fetch(callHotelBot({ cookie: "operator" }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        message: "Sent to LangWatch",
        ragResponse: "Try the bistro.",
      });
      expect(runs).toEqual([{ authToken: "sk-lw-project" }]);
    });

    /** @scenario "The door answers a declined run with its code" */
    it("answers a declined run as 401 with its code", async () => {
      const hono = mount({ runHotelBot: () => Promise.reject(new HotelBotDeclinedError()) });

      const response = await hono.fetch(callHotelBot({ cookie: "operator" }));

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "demo_bot_declined" });
    });
  });
});
