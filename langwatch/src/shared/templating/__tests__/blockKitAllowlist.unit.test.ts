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

  describe("when a rich_text block is present (ADR-041)", () => {
    it("keeps a rich_text block with quote/section sub-blocks of plain text", () => {
      const blocks = filterBlockKit([
        {
          type: "rich_text",
          elements: [
            {
              type: "rich_text_section",
              elements: [{ type: "text", text: "Input", style: { bold: true } }],
            },
            {
              type: "rich_text_quote",
              elements: [{ type: "text", text: "what is the weather" }],
            },
          ],
        },
      ]);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.type).toBe("rich_text");
      expect(blocks[0]?.elements).toEqual([
        {
          type: "rich_text_section",
          elements: [{ type: "text", text: "Input", style: { bold: true } }],
        },
        {
          type: "rich_text_quote",
          elements: [{ type: "text", text: "what is the weather" }],
        },
      ]);
    });
  });

  describe("when a rich_text block carries mention elements", () => {
    it("drops broadcast/user/usergroup/channel inline elements (notification-abuse vector)", () => {
      const [block] = filterBlockKit([
        {
          type: "rich_text",
          elements: [
            {
              type: "rich_text_section",
              elements: [
                { type: "text", text: "hi" },
                { type: "broadcast", range: "channel" },
                { type: "user", user_id: "U123" },
                { type: "usergroup", usergroup_id: "S1" },
                { type: "channel", channel_id: "C1" },
              ],
            },
          ],
        },
      ]);
      expect(block?.type).toBe("rich_text");
      const section = (block?.elements as Record<string, unknown>[])[0];
      expect(section?.elements).toEqual([{ type: "text", text: "hi" }]);
    });
  });

  describe("when a rich_text link element has a non-http scheme", () => {
    it("drops the unsafe link but keeps http(s) siblings (javascript:/data: stripped)", () => {
      const [block] = filterBlockKit([
        {
          type: "rich_text",
          elements: [
            {
              type: "rich_text_section",
              elements: [
                { type: "link", url: "javascript:alert(1)", text: "x" },
                {
                  type: "link",
                  url: "https://app.langwatch.ai/acme/messages/t1",
                  text: "ok",
                },
              ],
            },
          ],
        },
      ]);
      const section = (block?.elements as Record<string, unknown>[])[0];
      expect(section?.elements).toEqual([
        {
          type: "link",
          url: "https://app.langwatch.ai/acme/messages/t1",
          text: "ok",
        },
      ]);
    });
  });

  describe("when a rich_text block carries an unknown sub-block type", () => {
    it("keeps only allowlisted rich_text sub-block types", () => {
      const [block] = filterBlockKit([
        {
          type: "rich_text",
          elements: [
            {
              type: "rich_text_quote",
              elements: [{ type: "text", text: "q" }],
            },
            {
              type: "rich_text_evil",
              elements: [{ type: "text", text: "nope" }],
            },
          ],
        },
      ]);
      const types = (block?.elements as Record<string, unknown>[]).map(
        (e) => e.type,
      );
      expect(types).toEqual(["rich_text_quote"]);
    });
  });

  describe("when a rich_text_list nests sections with mentions", () => {
    it("recursively sanitizes each list item's inline elements", () => {
      const [block] = filterBlockKit([
        {
          type: "rich_text",
          elements: [
            {
              type: "rich_text_list",
              style: "bullet",
              elements: [
                {
                  type: "rich_text_section",
                  elements: [
                    { type: "text", text: "item" },
                    { type: "channel", channel_id: "C1" },
                  ],
                },
              ],
            },
          ],
        },
      ]);
      const list = (block?.elements as Record<string, unknown>[])[0];
      const item = (list?.elements as Record<string, unknown>[])[0];
      expect(item?.elements).toEqual([{ type: "text", text: "item" }]);
    });
  });
});
