import { describe, expect, it } from "vitest";
import { TEST_FIRE_NOTICE } from "../banner";
import { DEFAULT_SLACK_BLOCK_KIT_TEMPLATE } from "../defaults";
import {
  renderTriggerSlack,
  resolveSlackTemplateType,
} from "../renderSlack";
import { makeContext, makeMatch } from "./fixtures";

const MRKDWN_INJECTION = "<https://evil|click> <!channel> & a < b > c";

function asText(payload: { text: string } | { blocks: unknown[] }): string {
  if (!("text" in payload)) throw new Error("expected a text payload");
  return payload.text;
}

function asBlocks(
  payload: { text: string } | { blocks: Record<string, unknown>[] },
): Record<string, unknown>[] {
  if (!("blocks" in payload)) throw new Error("expected a blocks payload");
  return payload.blocks;
}

describe("renderTriggerSlack", () => {
  describe("when no custom template is provided", () => {
    // #6716 P0: the default message must carry what the trace actually said,
    // not just its identifier — an author previewing this (or a teammate
    // reading the delivered Slack message) needs the input and output, not a
    // trace ID they'd still have to open LangWatch to make sense of.
    it("renders the default message as text with the matched trace's input and output", async () => {
      const slack = await renderTriggerSlack({
        templateType: null,
        template: null,
        context: makeContext(),
      });
      const text = asText(slack.payload);
      expect(text).toContain("High latency");
      expect(text).toContain("what is the weather");
      expect(text).toContain("it is sunny");
      expect(slack.usedDefault).toBe(true);
    });
  });

  describe("when a string template is provided", () => {
    it("renders it as plain text", async () => {
      const slack = await renderTriggerSlack({
        templateType: "string",
        template: "Alert for {{ project.name }}: {{ trigger.name }}",
        context: makeContext(),
      });
      expect(asText(slack.payload)).toBe("Alert for Acme: High latency");
      expect(slack.usedDefault).toBe(false);
    });
  });

  describe("when the framework default Block Kit template is rendered", () => {
    it("produces a valid blocks payload (no JSON syntax errors)", async () => {
      const slack = await renderTriggerSlack({
        templateType: "block_kit",
        template: DEFAULT_SLACK_BLOCK_KIT_TEMPLATE,
        context: makeContext(),
      });
      const blocks = asBlocks(slack.payload);
      expect(slack.usedDefault).toBe(false);
      expect(slack.errors).toEqual([]);
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks[0]?.type).toBe("header");
    });

    // #6716 P0: the rich layout must carry the same input/output excerpt the
    // plain-text default does — a bot connection renders this one by
    // default, so it is what most authors actually see.
    it("carries the matched trace's input and output, not just its id", async () => {
      const slack = await renderTriggerSlack({
        templateType: "block_kit",
        template: DEFAULT_SLACK_BLOCK_KIT_TEMPLATE,
        context: makeContext(),
      });
      const serialized = JSON.stringify(asBlocks(slack.payload));
      expect(serialized).toContain("what is the weather");
      expect(serialized).toContain("it is sunny");
    });
  });

  describe("when type is block_kit but no template is provided", () => {
    it("renders the block_kit default (not the plain-text default)", async () => {
      const slack = await renderTriggerSlack({
        templateType: "block_kit",
        template: null,
        context: makeContext(),
      });
      const blocks = asBlocks(slack.payload);
      expect(slack.usedDefault).toBe(true);
      expect(slack.errors).toEqual([]);
      expect(blocks[0]?.type).toBe("header");
    });
  });

  describe("when a Block Kit template renders valid JSON", () => {
    it("sends a blocks payload through the allowlist", async () => {
      const template = JSON.stringify([
        {
          type: "header",
          text: { type: "plain_text", text: "{{ trigger.name }}" },
        },
        { type: "divider" },
        { type: "actions", elements: [{ type: "button", text: "x" }] },
      ]);
      const slack = await renderTriggerSlack({
        templateType: "block_kit",
        template,
        context: makeContext(),
      });
      const blocks = asBlocks(slack.payload);
      expect(blocks.map((b) => b.type)).toEqual(["header", "divider"]);
      expect(slack.usedDefault).toBe(false);
    });
  });

  // The allowlist drops a block Slack would reject outright (an emptied
  // `context` / `rich_text`), rather than emitting it. That keeps this fallback
  // reachable: a template whose blocks ALL get dropped degrades to the plain
  // text message instead of shipping a payload Slack answers with
  // `invalid_blocks` — which fails the whole notification and is not retryable.
  describe("when every block is stripped by the allowlist", () => {
    it("falls back to the plain-text default rather than sending empty blocks", async () => {
      const template = JSON.stringify([
        {
          type: "context",
          elements: [
            { type: "image", image_url: "https://tracker/p.png", alt_text: "" },
          ],
        },
        {
          type: "rich_text",
          elements: [
            {
              type: "rich_text_section",
              elements: [{ type: "user", user_id: "U123" }],
            },
          ],
        },
      ]);
      const slack = await renderTriggerSlack({
        templateType: "block_kit",
        template,
        context: makeContext(),
      });
      const text = asText(slack.payload);
      expect(text).toContain("High latency");
      expect(slack.usedDefault).toBe(true);
      expect(slack.errors).toEqual([
        "Block Kit template produced no allowed blocks",
      ]);
    });
  });

  describe("when a Block Kit template renders invalid JSON", () => {
    it("falls back to the default text and surfaces the error", async () => {
      const slack = await renderTriggerSlack({
        templateType: "block_kit",
        template: "this is not json {{ trigger.name }}",
        context: makeContext(),
      });
      expect("text" in slack.payload).toBe(true);
      expect(slack.usedDefault).toBe(true);
      expect(slack.errors.length).toBeGreaterThan(0);
    });
  });

  describe("when a string template throws while rendering", () => {
    it("falls back to the default text", async () => {
      const slack = await renderTriggerSlack({
        templateType: "string",
        template: "{{ trigger.name | nonexistent_filter }}",
        context: makeContext(),
      });
      expect(asText(slack.payload)).toContain("High latency");
      expect(slack.usedDefault).toBe(true);
    });
  });

  describe("when dispatched as a test fire", () => {
    it("prepends a banner to a text message", async () => {
      const slack = await renderTriggerSlack({
        templateType: "string",
        template: "Body",
        context: makeContext(),
        testFire: true,
      });
      expect(asText(slack.payload)).toContain(TEST_FIRE_NOTICE);
    });

    it("prepends a banner block to a Block Kit message", async () => {
      const slack = await renderTriggerSlack({
        templateType: "block_kit",
        template: JSON.stringify([{ type: "divider" }]),
        context: makeContext(),
        testFire: true,
      });
      const blocks = asBlocks(slack.payload);
      expect(blocks[0]?.type).toBe("section");
      expect(JSON.stringify(blocks[0])).toContain(TEST_FIRE_NOTICE);
    });
  });

  // Regression for the Slack-mrkdwn-injection finding: user-authored trace
  // content reaches Slack mrkdwn, where `<...|...>` is a live link and
  // `<!channel>` a broadcast. The default templates must escape `&`/`<`/`>`
  // (mrkdwn_escape) so the raw control sequences never render.
  describe("when trace content contains Slack mrkdwn control characters", () => {
    const contextWithInjection = makeContext({
      matches: [
        makeMatch({
          trace: {
            id: "trace_inj",
            input: MRKDWN_INJECTION,
            output: MRKDWN_INJECTION,
            url: "https://app.langwatch.ai/acme/traces/trace_inj",
            metadata: {},
          },
        }),
      ],
    });

    it("escapes the control characters in the string default text", async () => {
      const slack = await renderTriggerSlack({
        templateType: null,
        template: null,
        context: contextWithInjection,
      });
      const text = asText(slack.payload);
      expect(text).not.toContain("<https://evil|click>");
      expect(text).not.toContain("<!channel>");
      expect(text).toContain("&lt;https://evil|click&gt;");
      expect(text).toContain("&lt;!channel&gt;");
      expect(text).toContain("&amp;");
    });

    it("escapes the control characters in the Block Kit default blocks", async () => {
      const slack = await renderTriggerSlack({
        templateType: "block_kit",
        template: DEFAULT_SLACK_BLOCK_KIT_TEMPLATE,
        context: contextWithInjection,
      });
      const serialized = JSON.stringify(asBlocks(slack.payload));
      // The `<{{ m.trace.url }}|View trace>` link is operator-controlled and
      // stays live; assert the *user* content (evil link / broadcast) is escaped.
      expect(serialized).not.toContain("<https://evil|click>");
      expect(serialized).not.toContain("<!channel>");
      expect(serialized).toContain("&lt;https://evil|click&gt;");
      expect(serialized).toContain("&lt;!channel&gt;");
    });
  });
});

describe("resolveSlackTemplateType", () => {
  describe("given a bot connection", () => {
    it("defaults to block_kit when no type is configured", () => {
      expect(
        resolveSlackTemplateType({ configured: null, deliveryMethod: "bot" }),
      ).toBe("block_kit");
    });

    it("defaults to block_kit when the type is undefined", () => {
      expect(
        resolveSlackTemplateType({
          configured: undefined,
          deliveryMethod: "bot",
        }),
      ).toBe("block_kit");
    });

    it("honours an explicit string type", () => {
      expect(
        resolveSlackTemplateType({
          configured: "string",
          deliveryMethod: "bot",
        }),
      ).toBe("string");
    });

    it("honours an explicit block_kit type", () => {
      expect(
        resolveSlackTemplateType({
          configured: "block_kit",
          deliveryMethod: "bot",
        }),
      ).toBe("block_kit");
    });
  });

  describe("given a webhook connection", () => {
    it("defaults to string when no type is configured", () => {
      expect(
        resolveSlackTemplateType({
          configured: null,
          deliveryMethod: "webhook",
        }),
      ).toBe("string");
    });

    it("honours an explicit block_kit type", () => {
      expect(
        resolveSlackTemplateType({
          configured: "block_kit",
          deliveryMethod: "webhook",
        }),
      ).toBe("block_kit");
    });
  });

  describe("given an unrecognised configured value", () => {
    it("falls back to the delivery method's default", () => {
      expect(
        resolveSlackTemplateType({
          configured: "nonsense",
          deliveryMethod: "bot",
        }),
      ).toBe("block_kit");
    });
  });
});

describe("when a bot connection renders with the resolved template type", () => {
  it("renders Block Kit blocks even though no template type was configured", async () => {
    const templateType = resolveSlackTemplateType({
      configured: null,
      deliveryMethod: "bot",
    });
    const slack = await renderTriggerSlack({
      templateType,
      template: null,
      context: makeContext(),
      allowGatedBlocks: true,
    });
    expect("blocks" in slack.payload).toBe(true);
    expect(slack.usedDefault).toBe(true);
  });
});
