import { describe, it, expect } from "vitest";
import { getDisplayHandle } from "../PublishedPromptsList";

describe("PublishedPromptsList", () => {
  describe("getDisplayHandle", () => {
    describe("when handle is null or undefined", () => {
      it.todo("returns 'Untitled' when handle is null");
      it.todo("returns 'Untitled' when handle is undefined");
    });

    describe("when handle includes '/'", () => {
      it.todo("returns portion after '/' when handle has folder prefix");
      it.todo("returns portion after '/' when handle is 'folder/name'");
    });

    describe("when handle does not include '/'", () => {
      it.todo("returns full handle when no folder prefix");
    });
  });
});

