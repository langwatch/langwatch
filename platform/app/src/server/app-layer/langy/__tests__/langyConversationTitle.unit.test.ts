/**
 * @vitest-environment node
 *
 * Recent chats showed three title styles at once: "Instrument Traces With
 * LangWatch", "Instrument Traces with LangWatch" and the raw first message
 * "instrument my traces with langwatch". One normaliser now decides the style,
 * whether the title came from the cheap model or from the first message.
 *
 * @see specs/langy/langy-conversation-title.feature
 */
import { LANGY_TITLE_GENERATION } from "@langwatch/langy";
import { describe, expect, it } from "vitest";
import { normalizeLangyConversationTitle } from "../langyConversationTitle";

describe("normalizeLangyConversationTitle", () => {
  describe("given a title the model wrote in title case", () => {
    /** @scenario "A title in title case is rewritten in sentence case" */
    /** @scenario "Product names and acronyms keep their own capitalisation" */
    it.each([
      {
        raw: "Instrument Traces With LangWatch",
        expected: "Instrument traces with LangWatch",
      },
      {
        raw: "Instrument Traces with LangWatch",
        expected: "Instrument traces with LangWatch",
      },
      {
        raw: "Fix The GitHub API Token",
        expected: "Fix the GitHub API token",
      },
      {
        raw: "Debug A Python Worker On Kubernetes",
        expected: "Debug a Python worker on Kubernetes",
      },
      {
        raw: "Why Are My Traces Failing Since The Deploy?",
        expected: "Why are my traces failing since the deploy?",
      },
    ])("rewrites $raw in sentence case", ({ raw, expected }) => {
      expect(normalizeLangyConversationTitle(raw)).toBe(expected);
    });
  });

  describe("given raw text a user typed", () => {
    /** @scenario "The placeholder title follows the same rules as a generated one" */
    it("capitalises the first word and leaves the rest alone", () => {
      expect(
        normalizeLangyConversationTitle("instrument my traces with langwatch"),
      ).toBe("Instrument my traces with langwatch");
    });
  });

  describe("given the wrapping an LLM adds despite instructions", () => {
    /** @scenario "Quotes and a trailing period are removed from a title" */
    it.each([
      {
        raw: '"Instrument traces with LangWatch."',
        expected: "Instrument traces with LangWatch",
      },
      {
        raw: "Title: Instrument traces with LangWatch",
        expected: "Instrument traces with LangWatch",
      },
      {
        raw: "```\nInstrument traces with LangWatch\n```",
        expected: "Instrument traces with LangWatch",
      },
      {
        raw: "Instrument   traces\nwith LangWatch",
        expected: "Instrument traces with LangWatch",
      },
    ])("cleans up $raw", ({ raw, expected }) => {
      expect(normalizeLangyConversationTitle(raw)).toBe(expected);
    });
  });

  describe("given a title longer than the character budget", () => {
    /** @scenario "A title longer than sixty characters is cut on a word boundary" */
    it("cuts it on a word boundary", () => {
      const title = normalizeLangyConversationTitle(
        "Instrument the checkout service traces with LangWatch and then compare the deploys",
      );

      expect(title.length).toBeLessThanOrEqual(
        LANGY_TITLE_GENERATION.MAX_TITLE_CHARS,
      );
      expect(title).toBe(
        "Instrument the checkout service traces with LangWatch and",
      );
    });

    it("cuts a single unbroken word at the budget", () => {
      const title = normalizeLangyConversationTitle("a".repeat(90));

      expect(title.length).toBe(LANGY_TITLE_GENERATION.MAX_TITLE_CHARS);
    });
  });

  describe("given nothing usable", () => {
    it("returns an empty string", () => {
      expect(normalizeLangyConversationTitle("   ")).toBe("");
      expect(normalizeLangyConversationTitle("")).toBe("");
    });
  });
});
