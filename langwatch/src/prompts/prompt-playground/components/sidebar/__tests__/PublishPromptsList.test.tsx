import { getDisplayHandle } from "../PublishedPromptsList";
import { expect, describe, it } from "vitest";

describe("getDisplayHandle", () => {
  describe("when handle is missing or nullish", () => {
    it("returns 'Untitled' for undefined", () => {
      expect(getDisplayHandle(undefined)).toBe("Untitled");
    });
    it("returns 'Untitled' for null", () => {
      expect(getDisplayHandle(null)).toBe("Untitled");
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
