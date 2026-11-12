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

describe("heldKeyName", () => {
  const run = { userId: "user-1", idempotencyKey: "run-1" };

  /** @scenario "An unattended turn holds its key under the run and releases it on revoke" */
  it("names the same run the same way, whatever its brief or turn id, as neither is an input", () => {
    expect(LANGY_TURN_SHARED.heldKeyName({ ...run })).toBe(LANGY_TURN_SHARED.heldKeyName(run));
    expect(LANGY_TURN_SHARED.heldKeyName(run)).toMatch(/^langyhold_[0-9a-f]{32}$/);
  });

  it("names another person's run differently", () => {
    expect(LANGY_TURN_SHARED.heldKeyName({ ...run, userId: "user-2" })).not.toBe(
      LANGY_TURN_SHARED.heldKeyName(run),
    );
  });

  it("names another run of the same person differently", () => {
    expect(LANGY_TURN_SHARED.heldKeyName({ ...run, idempotencyKey: "run-2" })).not.toBe(
      LANGY_TURN_SHARED.heldKeyName(run),
    );
  });

  it("keeps a user and run that concatenate alike apart", () => {
    expect(LANGY_TURN_SHARED.heldKeyName({ userId: "ab", idempotencyKey: "c" })).not.toBe(
      LANGY_TURN_SHARED.heldKeyName({ userId: "a", idempotencyKey: "bc" }),
    );
  });
});
