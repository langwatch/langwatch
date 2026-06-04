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
    it("keeps the image accessory", () => {
      const [block] = filterBlockKit([
        {
          type: "section",
          text: { type: "mrkdwn", text: "body" },
          accessory: { type: "image", image_url: "https://x/y.png", alt_text: "y" },
        },
      ]);
      expect((block?.accessory as { type: string }).type).toBe("image");
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
