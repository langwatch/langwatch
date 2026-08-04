import { describe, expect, it } from "vitest";

import { handleSchema } from "~/prompts/schemas/field-schemas";
import { toHandleSlug } from "../handle-slug";

describe("toHandleSlug", () => {
  describe("given text a handle already accepts", () => {
    it("leaves it untouched", () => {
      expect(toHandleSlug("support-bot")).toBe("support-bot");
      expect(toHandleSlug("support_bot_2")).toBe("support_bot_2");
    });
  });

  describe("given a prompt id", () => {
    it("lowercases the nanoid so the handle stays valid", () => {
      expect(toHandleSlug("prompt_1h5icu8XRkHHbaQlrOgwq")).toBe(
        "prompt_1h5icu8xrkhhbaqlrogwq",
      );
    });
  });

  describe("given a display name", () => {
    it("replaces runs of unsupported characters with a single hyphen", () => {
      expect(toHandleSlug("My Support Bot")).toBe("my-support-bot");
      expect(toHandleSlug("Support   Bot!!!  v2")).toBe("support-bot-v2");
    });

    it("trims the hyphens that unsupported edge characters leave behind", () => {
      expect(toHandleSlug("  spaced  ")).toBe("spaced");
      expect(toHandleSlug("!!!bang!!!")).toBe("bang");
    });
  });

  describe("given text with no usable characters at all", () => {
    it("falls back to a generic handle rather than an empty one", () => {
      expect(toHandleSlug("!!!")).toBe("prompt");
      expect(toHandleSlug("")).toBe("prompt");
      expect(toHandleSlug("---")).toBe("prompt");
    });
  });

  describe("given anything at all", () => {
    // The reason this function exists: a handle that fails `handleSchema` is
    // silently treated as invalid and forces the prompt into draft mode.
    it.each([
      "prompt_1h5icu8XRkHHbaQlrOgwq",
      "My Support Bot",
      "a/b/c",
      "  spaced  ",
      "!!!",
      "",
      "---",
      "___",
      "ünïcödé",
      "emoji 🎉 handle",
    ])("produces a handle the schema accepts: %j", (input) => {
      expect(handleSchema.safeParse(toHandleSlug(input)).success).toBe(true);
    });
  });
});
