import { describe, expect, it } from "vitest";
import { filterBlockKit } from "../blockKitAllowlist";

describe("filterBlockKit", () => {
  describe("when given a mix of allowed and disallowed blocks", () => {
    it("keeps allowlisted block types and drops the rest", () => {
      const blocks = filterBlockKit([
        { type: "header", text: { type: "plain_text", text: "Hi" } },
        { type: "section", text: { type: "mrkdwn", text: "body" } },
        { type: "divider" },
        { type: "markdown", text: "## md body" },
        { type: "actions", elements: [{ type: "button", text: "Click" }] },
        { type: "input", label: "x" },
      ]);
      expect(blocks.map((b) => b.type)).toEqual([
        "header",
        "section",
        "divider",
        "markdown",
      ]);
    });
  });

  describe("when a section carries an interactive accessory", () => {
    it("strips the accessory but keeps the section", () => {
      const [block] = filterBlockKit([
        {
          type: "section",
          text: { type: "mrkdwn", text: "body" },
          accessory: { type: "button", text: "Click" },
        },
      ]);
      expect(block?.type).toBe("section");
      expect(block?.accessory).toBeUndefined();
    });
  });

  describe("when a section carries an image accessory", () => {
    it("strips the image accessory (tpl-001 — image blocks/accessories are tracking-pixel vectors)", () => {
      const [block] = filterBlockKit([
        {
          type: "section",
          text: { type: "mrkdwn", text: "body" },
          accessory: {
            type: "image",
            image_url: "https://x/y.png",
            alt_text: "y",
          },
        },
      ]);
      expect(block?.type).toBe("section");
      expect(block?.accessory).toBeUndefined();
    });
  });

  describe("when a top-level image block is present", () => {
    it("drops it entirely (tpl-001 tracking-pixel vector)", () => {
      const blocks = filterBlockKit([
        {
          type: "image",
          image_url: "https://tracker.example/pixel.png",
          alt_text: "hi",
        },
        { type: "section", text: { type: "mrkdwn", text: "keep me" } },
      ]);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.type).toBe("section");
    });
  });

  describe("when a context block carries an image element", () => {
    it("strips the image element but keeps text elements (tpl-002 recursive sanitize)", () => {
      const [block] = filterBlockKit([
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: "keep-me" },
            { type: "image", image_url: "https://tracker/", alt_text: "z" },
            { type: "plain_text", text: "keep-me-too" },
          ],
        },
      ]);
      expect(block?.type).toBe("context");
      expect(block?.elements).toEqual([
        { type: "mrkdwn", text: "keep-me" },
        { type: "plain_text", text: "keep-me-too" },
      ]);
    });
  });

  describe("when given non-array or malformed input", () => {
    it("returns an empty list", () => {
      expect(filterBlockKit(null)).toEqual([]);
      expect(filterBlockKit("nope")).toEqual([]);
      expect(filterBlockKit([null, 1, "x", { noType: true }])).toEqual([]);
    });
  });
});
