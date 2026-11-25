import { describe, expect, it } from "vitest";

import { redrivableAt, syncStatePalette, syncStateWords } from "../directory-sync-oversight.ts";

describe("the back office's reading of a sync", () => {
  it("says a state in words rather than as a constant", () => {
    expect(syncStateWords("TOKEN_ISSUED")).toBe("token issued");
  });

  it("colours a stopped directory red and an unknown state grey", () => {
    expect(syncStatePalette("ERROR")).toBe("red");
    expect(syncStatePalette("SOMETHING_NEW")).toBe("gray");
  });

  describe("given a retired apply", () => {
    it("offers it by its retirement time until it has been sent through", () => {
      expect(redrivableAt({ retiredAtMs: 40, redrivenAtMs: null })).toBe(40);
      expect(redrivableAt({ retiredAtMs: 40, redrivenAtMs: 50 })).toBeUndefined();
      expect(redrivableAt({ retiredAtMs: null, redrivenAtMs: null })).toBeUndefined();
    });
  });
});
