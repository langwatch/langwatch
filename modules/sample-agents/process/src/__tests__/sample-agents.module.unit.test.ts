/** The hotel bot is mounted, behind the platform-operator door its declaration names. */
import { describe, expect, it } from "vitest";

import { sampleAgentsProcessModule } from "../sample-agents.module.ts";
import { hotelBotRest } from "../transport/hotel-bot.rest.ts";

describe("sampleAgentsProcessModule", () => {
  /** @scenario "The hotel bot is mounted behind the platform-operator door" */
  it("mounts the hotel bot's route", () => {
    expect(sampleAgentsProcessModule.transports).toEqual([hotelBotRest]);
  });
});
