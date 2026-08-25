import { describe, expect, it } from "vitest";

import {
  compareModelSortKeys,
  type OpenAIVariant,
  rankOpenAIChatModel,
} from "../modelTiers";

const ranks = ({ id, variant }: { id: string; variant: OpenAIVariant }) =>
  rankOpenAIChatModel({ id, variant }) !== null;

describe("given the OpenAI chat model tier grammar", () => {
  describe("when ranking flagship candidates", () => {
    it("accepts the unsuffixed id of a generation", () => {
      expect(ranks({ id: "openai/gpt-5.5", variant: "flagship" })).toBe(true);
    });

    it("accepts the named flagship tier", () => {
      expect(ranks({ id: "openai/gpt-5.6-sol", variant: "flagship" })).toBe(true);
    });

    it("rejects the balanced middle tier", () => {
      expect(ranks({ id: "openai/gpt-5.6-terra", variant: "flagship" })).toBe(false);
    });

    it("rejects the fast tier", () => {
      expect(ranks({ id: "openai/gpt-5.6-luna", variant: "flagship" })).toBe(false);
    });

    it.each([
      "openai/gpt-5.6-sol-pro",
      "openai/gpt-5.5-pro",
      "openai/gpt-5.4-nano",
      "openai/gpt-5.3-codex",
      "openai/gpt-5.2-chat",
      "openai/gpt-5.4-image-2",
    ])("rejects %s", (id) => {
      expect(ranks({ id, variant: "flagship" })).toBe(false);
    });

    it("rejects ids from other providers", () => {
      expect(ranks({ id: "azure/gpt-5.5", variant: "flagship" })).toBe(false);
    });

    it("rejects a generation with no minor version", () => {
      expect(ranks({ id: "openai/gpt-5", variant: "flagship" })).toBe(false);
    });
  });

  describe("when ranking fast candidates", () => {
    it("accepts the legacy -mini suffix", () => {
      expect(ranks({ id: "openai/gpt-5.4-mini", variant: "mini" })).toBe(true);
    });

    it("accepts the named fast tier", () => {
      expect(ranks({ id: "openai/gpt-5.6-luna", variant: "mini" })).toBe(true);
    });

    it("rejects the flagship tier", () => {
      expect(ranks({ id: "openai/gpt-5.6-sol", variant: "mini" })).toBe(false);
    });

    it("rejects the nano tier, which sits below fast", () => {
      expect(ranks({ id: "openai/gpt-5.4-nano", variant: "mini" })).toBe(false);
    });
  });

  describe("when sorting ranked candidates", () => {
    const sorted = (ids: string[], variant: OpenAIVariant) =>
      ids
        .flatMap((id) => {
          const key = rankOpenAIChatModel({ id, variant });
          return key ? [{ id, ...key }] : [];
        })
        .sort(compareModelSortKeys)
        .map((c) => c.id);

    it("puts the newest generation first", () => {
      expect(
        sorted(["openai/gpt-5.4", "openai/gpt-5.6-sol", "openai/gpt-5.5"], "flagship"),
      ).toEqual(["openai/gpt-5.6-sol", "openai/gpt-5.5", "openai/gpt-5.4"]);
    });

    it("compares minor versions numerically, not as text", () => {
      // A lexical sort would rank "5.9" above "5.10".
      expect(sorted(["openai/gpt-5.9", "openai/gpt-5.10"], "flagship")[0]).toBe(
        "openai/gpt-5.10",
      );
    });

    /** @scenario A generation shipping both an unsuffixed model and a named flagship */
    it("breaks a same-generation tie in favour of the named tier", () => {
      expect(sorted(["openai/gpt-5.7", "openai/gpt-5.7-sol"], "flagship")[0]).toBe(
        "openai/gpt-5.7-sol",
      );
    });
  });
});
