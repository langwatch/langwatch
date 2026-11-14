import { describe, expect, it } from "vitest";

import { toLangevalsConversation } from "../langevals-conversation.rules.ts";

describe("toLangevalsConversation", () => {
  /** @scenario "A conversation mapping that resolves to nothing reaches langevals as no turns" */
  it.each(["", "   "])("reads an unmapped %j conversation as no turns", (value) => {
    expect(toLangevalsConversation(value)).toEqual([]);
  });

  it("leaves a missing conversation missing", () => {
    expect(toLangevalsConversation(undefined)).toBeUndefined();
    expect(toLangevalsConversation(null)).toBeUndefined();
  });

  it("passes a JSON-encoded conversation through as its turns", () => {
    const turns = [{ input: "hi", output: "hello" }];

    expect(toLangevalsConversation(JSON.stringify(turns))).toEqual(turns);
    expect(toLangevalsConversation(turns)).toEqual(turns);
  });

  /** @scenario "A conversation mapping that resolves to nothing reaches langevals as no turns" */
  it("drops an empty turn beside real ones", () => {
    expect(toLangevalsConversation([{ input: "hi", output: "yo" }, ""])).toEqual([
      { input: "hi", output: "yo" },
    ]);
  });
});
