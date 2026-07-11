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

  // ADR-041 Phase 3 — the modern blocks. A live 2026-07 webhook probe showed
  // `card` renders (200 ok) while `alert` / `data_visualization` / `data_table`
  // are rejected (400 invalid_blocks). So `card` is allowlisted (kept, sanitised)
  // and the other three stay gated — dropped by default, sanitised-and-kept only
  // when the caller confirms the surface renders them (`allowGatedBlocks`).
  describe("when modern blocks are present with default options", () => {
    it("keeps card (delivery-verified) but drops the still-gated alert / data_visualization / data_table", () => {
      const blocks = filterBlockKit([
        { type: "alert", level: "error", text: { type: "mrkdwn", text: "x" } },
        { type: "card", title: { type: "mrkdwn", text: "t" } },
        {
          type: "data_visualization",
          title: "T",
          chart: { type: "pie", segments: [{ label: "a", value: 1 }] },
        },
        {
          type: "data_table",
          caption: "c",
          rows: [
            [{ type: "raw_text", text: "H" }],
            [{ type: "raw_text", text: "v" }],
          ],
        },
        { type: "section", text: { type: "mrkdwn", text: "keep me" } },
      ]);
      expect(blocks.map((b) => b.type)).toEqual(["card", "section"]);
    });
  });

  describe("when a template's gated hero is filtered but a fallback follows", () => {
    it("degrades to the allowlisted fallback so the message is never empty", () => {
      const blocks = filterBlockKit([
        {
          type: "alert",
          level: "success",
          text: { type: "mrkdwn", text: "Summary" },
        },
        { type: "section", text: { type: "mrkdwn", text: "*Name* · detail" } },
        { type: "context", elements: [{ type: "mrkdwn", text: "footer" }] },
      ]);
      expect(blocks.map((b) => b.type)).toEqual(["section", "context"]);
      expect(blocks.length).toBeGreaterThan(0);
    });
  });

  describe("when gated blocks are allowed (delivery probe passed)", () => {
    describe("given an alert block", () => {
      it("keeps a valid alert and normalises the level", () => {
        const [block] = filterBlockKit(
          [
            {
              type: "alert",
              level: "success",
              text: { type: "mrkdwn", text: "Recovered" },
            },
          ],
          { allowGatedBlocks: true },
        );
        expect(block).toEqual({
          type: "alert",
          level: "success",
          text: { type: "mrkdwn", text: "Recovered" },
        });
      });

      it("drops an out-of-range level (Slack defaults it) but keeps the block", () => {
        const [block] = filterBlockKit(
          [
            {
              type: "alert",
              level: "catastrophic",
              text: { type: "mrkdwn", text: "hi" },
            },
          ],
          { allowGatedBlocks: true },
        );
        expect(block?.level).toBeUndefined();
        expect(block?.type).toBe("alert");
      });

      it("drops an alert whose text is missing or malformed", () => {
        const blocks = filterBlockKit(
          [
            { type: "alert", level: "info" },
            { type: "alert", text: "not-a-text-object" },
          ],
          { allowGatedBlocks: true },
        );
        expect(blocks).toEqual([]);
      });
    });

    describe("given a card block", () => {
      it("strips the fetch-on-render icon and the callback actions, keeps text", () => {
        const [block] = filterBlockKit(
          [
            {
              type: "card",
              icon: { type: "image", image_url: "https://tracker/p.png" },
              hero_image: { image_url: "https://tracker/hero.png" },
              title: { type: "mrkdwn", text: "Deploy #42" },
              body: { type: "mrkdwn", text: "succeeded" },
              actions: [{ type: "button", action_id: "ack", text: "Ack" }],
            },
          ],
          { allowGatedBlocks: true },
        );
        expect(block).toEqual({
          type: "card",
          title: { type: "mrkdwn", text: "Deploy #42" },
          body: { type: "mrkdwn", text: "succeeded" },
        });
        expect(block?.icon).toBeUndefined();
        expect(block?.hero_image).toBeUndefined();
        expect(block?.actions).toBeUndefined();
      });

      it("drops a card that has no title or body left after sanitising", () => {
        const blocks = filterBlockKit(
          [
            {
              type: "card",
              icon: { type: "image", image_url: "https://tracker/p.png" },
              actions: [{ type: "button", url: "https://x", text: "Go" }],
            },
          ],
          { allowGatedBlocks: true },
        );
        expect(blocks).toEqual([]);
      });
    });

    describe("given a data_visualization block", () => {
      it("keeps a valid pie chart and drops non-positive / malformed segments", () => {
        const [block] = filterBlockKit(
          [
            {
              type: "data_visualization",
              title: "Matches by evaluator",
              chart: {
                type: "pie",
                segments: [
                  { label: "Relevancy", value: 3 },
                  { label: "Toxicity", value: 0 },
                  { label: "NoValue" },
                  { label: 7, value: 2 },
                ],
              },
            },
          ],
          { allowGatedBlocks: true },
        );
        const chart = block?.chart as Record<string, unknown>;
        expect(chart.type).toBe("pie");
        expect(chart.segments).toEqual([
          { label: "Relevancy", value: 3 },
          { label: "7", value: 2 },
        ]);
      });

      it("keeps a line chart with series + axis_config and caps points", () => {
        const data = Array.from({ length: 25 }, (_, i) => ({
          label: `t${i}`,
          value: i,
        }));
        const [block] = filterBlockKit(
          [
            {
              type: "data_visualization",
              title: "Trend",
              chart: {
                type: "line",
                series: [{ name: "latency", data }],
                axis_config: {
                  categories: data.map((d) => d.label),
                  x_label: "Time",
                  y_label: "ms",
                },
              },
            },
          ],
          { allowGatedBlocks: true },
        );
        const chart = block?.chart as Record<string, unknown>;
        const series = chart.series as Record<string, unknown>[];
        expect((series[0]!.data as unknown[]).length).toBe(20);
      });

      it("drops a chart with an unknown chart type or no usable data", () => {
        const blocks = filterBlockKit(
          [
            { type: "data_visualization", title: "x", chart: { type: "radar" } },
            {
              type: "data_visualization",
              title: "y",
              chart: { type: "pie", segments: [] },
            },
          ],
          { allowGatedBlocks: true },
        );
        expect(blocks).toEqual([]);
      });
    });

    describe("given a data_table block", () => {
      it("keeps raw_text / raw_number cells and normalises row width", () => {
        const [block] = filterBlockKit(
          [
            {
              type: "data_table",
              caption: "Recent values",
              rows: [
                [
                  { type: "raw_text", text: "Time" },
                  { type: "raw_text", text: "Value" },
                ],
                [
                  { type: "raw_text", text: "10:00" },
                  { type: "raw_number", value: 12, text: "12" },
                ],
                // Short row — the missing cell is padded so widths stay equal.
                [{ type: "raw_text", text: "10:05" }],
              ],
            },
          ],
          { allowGatedBlocks: true },
        );
        const rows = block?.rows as Record<string, unknown>[][];
        expect(rows).toHaveLength(3);
        expect(rows.every((r) => r.length === 2)).toBe(true);
        expect(rows[2]![1]).toEqual({ type: "raw_text", text: "—" });
      });

      it("sanitises a rich_text cell, stripping an image element", () => {
        const [block] = filterBlockKit(
          [
            {
              type: "data_table",
              caption: "c",
              rows: [
                [{ type: "raw_text", text: "Link" }],
                [
                  {
                    type: "rich_text",
                    elements: [
                      {
                        type: "rich_text_section",
                        elements: [
                          {
                            type: "link",
                            url: "https://app.langwatch.ai/t",
                            text: "View",
                          },
                          { type: "channel", channel_id: "C1" },
                        ],
                      },
                    ],
                  },
                ],
              ],
            },
          ],
          { allowGatedBlocks: true },
        );
        const rows = block?.rows as Record<string, unknown>[][];
        const cell = rows[1]![0] as Record<string, unknown>;
        const section = (cell.elements as Record<string, unknown>[])[0];
        expect(section?.elements).toEqual([
          { type: "link", url: "https://app.langwatch.ai/t", text: "View" },
        ]);
      });

      it("drops a table with fewer than a header plus one data row", () => {
        const blocks = filterBlockKit(
          [
            {
              type: "data_table",
              caption: "c",
              rows: [[{ type: "raw_text", text: "only header" }]],
            },
          ],
          { allowGatedBlocks: true },
        );
        expect(blocks).toEqual([]);
      });
    });
  });
});
