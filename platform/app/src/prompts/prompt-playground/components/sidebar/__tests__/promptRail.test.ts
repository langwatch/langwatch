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
  it("filters by handle, model, author and live tag", () => {
    const item = prompt({
      handle: "support/classifier",
      tags: [{ name: "production", versionId: "v2" }],
    });

    expect(matchesPromptRailFilter({ prompt: item, rawQuery: "support" })).toBe(
      true,
    );
    expect(matchesPromptRailFilter({ prompt: item, rawQuery: "gpt-5" })).toBe(
      true,
    );
    expect(matchesPromptRailFilter({ prompt: item, rawQuery: "ada" })).toBe(
      true,
    );
    expect(
      matchesPromptRailFilter({ prompt: item, rawQuery: "production" }),
    ).toBe(true);
    expect(
      matchesPromptRailFilter({ prompt: item, rawQuery: "summariser" }),
    ).toBe(false);
  });

  it("groups unfiled prompts first and sorts folders by name", () => {
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

  it("moves a prompt between a folder and the top level without renaming it", () => {
    expect(
      movePromptHandleToFolder({
        handle: "support/classifier",
        folder: "routing",
      }),
    ).toBe("routing/classifier");
    expect(
      movePromptHandleToFolder({
        handle: "support/classifier",
      }),
    ).toBe("classifier");
  });
});
