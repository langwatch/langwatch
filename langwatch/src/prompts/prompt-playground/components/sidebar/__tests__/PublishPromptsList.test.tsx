import { describe, expect, it } from "vitest";
import { getDisplayHandle } from "../PublishedPromptsList";

describe("getDisplayHandle", () => {
  describe("when handle is missing or nullish", () => {
    it("returns 'New Prompt' for undefined", () => {
      expect(getDisplayHandle(undefined)).toBe("New Prompt");
    });
    it("returns 'New Prompt' for null", () => {
      expect(getDisplayHandle(null)).toBe("New Prompt");
    });
  });

  describe("when handle is string", () => {
    it("returns handle itself if no slash", () => {
      expect(getDisplayHandle("myPrompt")).toBe("myPrompt");
    });

    it("returns last part if single slash", () => {
      expect(getDisplayHandle("folder/myPrompt")).toBe("myPrompt");
    });

    it("returns part after first slash if multiple slashes", () => {
      expect(getDisplayHandle("folder/subfolder/myPrompt")).toBe("subfolder");
    });
  });
});
