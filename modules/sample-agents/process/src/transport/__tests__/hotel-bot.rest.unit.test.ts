/** The hotel bot's door through the REST runtime: the caller's key in, a refusal out by code. */
import { createApiFixture } from "@langwatch/api-fixture";
import { createCanonicalFamilyErrorHandler, createRestRuntime } from "@langwatch/api/rest";
import {
  HotelBotDeclinedError,
  type HotelBotRunInput,
  type SampleAgentsApi,
} from "@langwatch/sample-agents-contract";
import { describe, expect, it } from "vitest";

import { hotelBotRest } from "../hotel-bot.rest.ts";

function mount(app: Partial<SampleAgentsApi>) {
  return createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("the hotel bot's door reads no credential");
      },
    },
  }).mount(hotelBotRest.router(), {
    app: () => createApiFixture<SampleAgentsApi>(app),
    credential: "public",
    onError: createCanonicalFamilyErrorHandler({
      loggerName: "langwatch:test:hotel-bot",
      label: "Hotel bot",
    }),
  });
}

function callHotelBot(headers: Record<string, string>) {
  return new Request("http://api.test/api/demo/hotel_bot", { method: "POST", headers });
}

describe("the hotel bot's door", () => {
  /** @scenario "The door hands the caller's key to the hotel bot" */
  it("runs the bot with the caller's X-Auth-Token and answers its reply", async () => {
    const runs: HotelBotRunInput[] = [];
    const hono = mount({
      runHotelBot: (input) => {
        runs.push(input);
        return Promise.resolve({ message: "Sent to LangWatch", ragResponse: "Try the bistro." });
      },
    });

    const response = await hono.fetch(callHotelBot({ "x-auth-token": "sk-lw-project" }));

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

    const response = await hono.fetch(callHotelBot({ "x-auth-token": "sk-lw-project" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "demo_bot_declined" });
  });
});
