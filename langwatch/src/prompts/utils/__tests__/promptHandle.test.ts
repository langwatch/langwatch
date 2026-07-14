import { describe, expect, it } from "vitest";
import {
  NEW_PROMPT_TITLE,
  getDisplayHandle,
  getPromptFolder,
} from "../promptHandle";

describe("getDisplayHandle", () => {
  describe("given a handle with a folder prefix", () => {
    it("returns the name, dropping the folder", () => {
      expect(getDisplayHandle("onboarding/welcome")).toBe("welcome");
    });

    /**
     * The two copies this module replaced both took `split("/")[1]`, which
     * answers "b" here. The name is what follows the *last* separator.
     */
    it("returns the last segment of a nested handle, not the second", () => {
      expect(getDisplayHandle("a/b/c")).toBe("c");
    });
  });

  describe("given a handle with no folder prefix", () => {
    it("returns the whole handle", () => {
      expect(getDisplayHandle("classifier")).toBe("classifier");
    });
  });

  describe("given a handle ending in a separator", () => {
    it("falls back to the whole handle rather than an empty name", () => {
      expect(getDisplayHandle("onboarding/")).toBe("onboarding/");
    });
  });

  describe("given no handle", () => {
    it("returns the placeholder for a prompt that was never saved", () => {
      expect(getDisplayHandle(undefined)).toBe(NEW_PROMPT_TITLE);
      expect(getDisplayHandle(null)).toBe(NEW_PROMPT_TITLE);
      expect(getDisplayHandle("")).toBe(NEW_PROMPT_TITLE);
    });
  });
});

describe("getPromptFolder", () => {
  describe("given a handle with a folder prefix", () => {
    it("returns the folder", () => {
      expect(getPromptFolder("onboarding/welcome")).toBe("onboarding");
    });

    it("returns the first segment of a nested handle", () => {
      expect(getPromptFolder("a/b/c")).toBe("a");
    });
  });

  describe("given a handle with no folder prefix", () => {
    it("returns nothing, there being no folder", () => {
      expect(getPromptFolder("classifier")).toBeUndefined();
    });
  });

  describe("given a handle that starts with a separator", () => {
    it("returns nothing rather than an empty folder name", () => {
      expect(getPromptFolder("/welcome")).toBeUndefined();
    });
  });

  describe("given no handle", () => {
    it("returns nothing", () => {
      expect(getPromptFolder(undefined)).toBeUndefined();
      expect(getPromptFolder(null)).toBeUndefined();
      expect(getPromptFolder("")).toBeUndefined();
    });
  });
});
