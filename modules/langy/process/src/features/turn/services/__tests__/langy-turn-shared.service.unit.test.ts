import { describe, expect, it } from "vitest";

import { LangyTurnSharedService } from "../langy-turn-shared.service.ts";

const LANGY_TURN_SHARED = LangyTurnSharedService.create();

describe("composeLangyTurnPrompt", () => {
  describe("when the viewer has an email", () => {
    it('names the viewer so "email me" needs no question', () => {
      const { prompt } = LANGY_TURN_SHARED.composeLangyTurnPrompt({
        viewer: { id: "u1", name: "Ada", email: "ada@example.com" },
        contextBlock: null,
        capNote: "",
        userText: "email me on thumbs-down",
      });
      expect(prompt).toContain("You are talking to Ada <ada@example.com>.");
      expect(prompt.endsWith("email me on thumbs-down")).toBe(true);
    });
  });

  describe("when the viewer has no email", () => {
    it("leaves the prompt as the bare user text", () => {
      expect(
        LANGY_TURN_SHARED.composeLangyTurnPrompt({
          viewer: { id: "u1" },
          contextBlock: null,
          capNote: "",
          userText: "hi",
        }),
      ).toEqual({ prompt: "hi", labelled: false });
    });
  });
});
