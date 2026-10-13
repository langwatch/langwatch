/** The hotel bot is mounted, behind the project API-key door its declaration names. */
import { describe, expect, it } from "vitest";

import { sampleAgentsProcessModule } from "../sample-agents.module.ts";
import { hotelBotRest } from "../transport/hotel-bot.rest.ts";

describe("sampleAgentsProcessModule", () => {
  /** @scenario "The hotel bot is mounted behind the project API-key door" */
  it("mounts the hotel bot's route", () => {
    expect(sampleAgentsProcessModule.transports).toEqual([hotelBotRest]);
  });
});
