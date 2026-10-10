import { describe, expect, it } from "vitest";

import { addTagErrorMessage } from "../deploy-tags.ts";

describe("addTagErrorMessage", () => {
  /** @scenario "The deploy dialog names a refused tag in words, never the code" */
  it("says the name already exists when the tag is taken", () => {
    const error = { code: "prompt_tag_conflict", httpStatus: 409 };

    expect(addTagErrorMessage({ error, name: "production" })).toBe("production already exists");
  });

  /** @scenario "The deploy dialog names a refused tag in words, never the code" */
  it("shows the registry title for any other handled refusal, never its code", () => {
    const error = { code: "prompt_not_found", httpStatus: 404 };

    expect(addTagErrorMessage({ error, name: "canary" })).toBe("Prompt not found");
  });

  /** @scenario "The deploy dialog names a refused tag in words, never the code" */
  it("falls back to a plain sentence for an error that is not handled", () => {
    expect(addTagErrorMessage({ error: new Error("boom"), name: "canary" })).toBe(
      "Failed to create tag",
    );
  });
});
