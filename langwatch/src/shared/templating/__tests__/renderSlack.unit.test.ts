import { describe, expect, it } from "vitest";
import { TEST_FIRE_NOTICE } from "../banner";
import { DEFAULT_SLACK_BLOCK_KIT_TEMPLATE } from "../defaults";
import { renderTriggerSlack } from "../renderSlack";
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
    it("renders the default message as text", async () => {
      const slack = await renderTriggerSlack({
        templateType: null,
        template: null,
        context: makeContext(),
      });
      const text = asText(slack.payload);
      expect(text).toContain("High latency");
      expect(text).toContain("what is the weather");
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
            url: "https://app.langwatch.ai/acme/messages/trace_inj",
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
