/** The hotel bot is served to no caller until platform operators are admitted. */
import { describe, expect, it } from "vitest";

import { sampleAgentsProcessModule } from "../sample-agents.module.ts";
import { hotelBotRest } from "../transport/hotel-bot.rest.ts";

describe("sampleAgentsProcessModule", () => {
  /** @scenario "The hotel bot is served to no caller until platform operators are admitted" */
  it("mounts no transport, so no door reaches the hotel bot or its OpenAI channel", () => {
    expect(sampleAgentsProcessModule.transports).not.toContain(hotelBotRest);
    expect(sampleAgentsProcessModule.transports).toEqual([]);
  });
});
