import { describe, expect, it } from "vitest";
import type { VersionedPrompt } from "~/server/prompt-config/prompt.service";
import {
  groupPromptsForRail,
  matchesPromptRailFilter,
  movePromptHandleToFolder,
} from "../promptRail";

const prompt = (
  overrides: Partial<VersionedPrompt> & Pick<VersionedPrompt, "handle">,
): VersionedPrompt =>
  ({
    id: overrides.handle ?? "prompt",
    model: "openai/gpt-5-mini",
    author: { id: "user-1", name: "Ada Lovelace", email: null, image: null },
    tags: [],
    updatedAt: new Date("2026-08-20T10:00:00Z"),
    ...overrides,
  }) as VersionedPrompt;

describe("the prompts rail model", () => {
  describe("given a foldered prompt carrying a live tag", () => {
    const item = prompt({
      handle: "support/classifier",
      tags: [{ name: "production", versionId: "v2" }],
    });

    describe("when the query matches the handle, model, author or tag", () => {
      it("keeps the prompt", () => {
        expect(
          matchesPromptRailFilter({ prompt: item, rawQuery: "support" }),
        ).toBe(true);
        expect(
          matchesPromptRailFilter({ prompt: item, rawQuery: "gpt-5" }),
        ).toBe(true);
        expect(matchesPromptRailFilter({ prompt: item, rawQuery: "ada" })).toBe(
          true,
        );
        expect(
          matchesPromptRailFilter({ prompt: item, rawQuery: "production" }),
        ).toBe(true);
      });
    });

    describe("when the query matches none of them", () => {
      it("drops the prompt", () => {
        expect(
          matchesPromptRailFilter({ prompt: item, rawQuery: "summariser" }),
        ).toBe(false);
      });
    });
  });

  describe("given prompts spread across folders and the top level", () => {
    describe("when grouping them for the rail", () => {
      it("puts the unfiled group first and sorts the folders by name", () => {
        const groups = groupPromptsForRail([
          prompt({ handle: "sales/qualifier" }),
          prompt({ handle: "standalone" }),
          prompt({ handle: "onboarding/welcome" }),
        ]);

        expect(groups.map((group) => group.folder)).toEqual([
          undefined,
          "onboarding",
          "sales",
        ]);
      });
    });
  });

  describe("given a prompt filed under a folder", () => {
    describe("when moving it to another folder", () => {
      it("reparents the handle and keeps the name", () => {
        expect(
          movePromptHandleToFolder({
            handle: "support/classifier",
            folder: "routing",
          }),
        ).toBe("routing/classifier");
      });
    });

    describe("when moving it to the top level", () => {
      it("drops the folder and keeps the name", () => {
        expect(
          movePromptHandleToFolder({
            handle: "support/classifier",
          }),
        ).toBe("classifier");
      });
    });
  });
});
