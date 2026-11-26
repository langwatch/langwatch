/**
 * @see modules/langy/specs/langy-queue-while-busy.feature
 */
import { describe, expect, it } from "vitest";

import { langyDraftWithQueued, langyFollowUpOf } from "../langy-follow-up.ts";

describe("langyFollowUpOf", () => {
  /** @scenario Queued messages go as one follow-up turn when the turn ends */
  it("joins the texts in the order they were sent, one paragraph each", () => {
    const followUp = langyFollowUpOf([
      { text: "make it red", images: [] },
      { text: "  or red-ish, pastel ", images: [] },
    ]);

    expect(followUp.text).toBe("make it red\n\nor red-ish, pastel");
  });

  /** @scenario Images attached to a queued message go with it */
  it("carries every queued image, in order", () => {
    const followUp = langyFollowUpOf([
      { text: "this one [▣ a.png]", images: ["a"] },
      { text: "and [▣ b.png]", images: ["b"] },
    ]);

    expect(followUp.images).toEqual(["a", "b"]);
  });
});

describe("langyDraftWithQueued", () => {
  /** @scenario A queued message can be edited before it is sent */
  it("puts the queued text ahead of what is already typed", () => {
    expect(langyDraftWithQueued({ queued: "make it red", draft: "" })).toBe("make it red");
    expect(langyDraftWithQueued({ queued: "make it red", draft: "and bigger" })).toBe(
      "make it red\nand bigger",
    );
  });
});
