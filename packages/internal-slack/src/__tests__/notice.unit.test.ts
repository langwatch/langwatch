import type { KnownBlock } from "@slack/types";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { NOTICE_TONES, bold, code, composeMessage, defineNotice, moment } from "../notice.ts";

const origin = { environment: "app.langwatch.ai", sentAt: 1_790_000_000_000 };

const textOf = (block: KnownBlock | undefined): string => {
  if (block?.type === "section" && block.text) return block.text.text;
  if (block?.type === "header") return block.text.text;
  throw new Error(`expected a header or a section with text, got ${block?.type}`);
};

const fieldTextsOf = (blocks: KnownBlock[]): string[] =>
  blocks.flatMap((block) =>
    block.type === "section" && block.fields ? block.fields.map((field) => field.text) : [],
  );

describe("composeMessage()", () => {
  describe("given a layout with every part", () => {
    const message = composeMessage({
      noticeId: "example",
      layout: {
        tone: "warning",
        title: "Something happened",
        summary: [bold("Acme"), " did a thing."],
        fields: [
          { label: "Organization", value: "Acme" },
          { label: "Subscription ID", value: code("subscription_1") },
        ],
        note: "Look into it.",
        actions: [
          { label: "Open org in admin", url: "https://example.test/admin", primary: true },
          { label: "Open in Stripe", url: "https://dashboard.stripe.com/x" },
        ],
      },
      origin,
    });

    it("lays the parts out in one order", () => {
      expect(message.blocks.map((block) => block.type)).toEqual([
        "header",
        "section",
        "section",
        "section",
        "actions",
        "context",
      ]);
    });

    it("opens the header with the tone's emoji", () => {
      expect(textOf(message.blocks[0])).toBe(`${NOTICE_TONES.warning} Something happened`);
    });

    it("writes each field as a bold label over its value", () => {
      expect(fieldTextsOf(message.blocks)).toEqual([
        "*Organization*\nAcme",
        "*Subscription ID*\n`subscription_1`",
      ]);
    });

    it("quotes the note", () => {
      expect(textOf(message.blocks[3])).toBe(">Look into it.");
    });

    it("makes the first action the primary button", () => {
      const actions = message.blocks[4];
      if (actions?.type !== "actions") throw new Error("expected an actions block");
      expect(actions.elements).toEqual([
        {
          type: "button",
          text: { type: "plain_text", text: "Open org in admin" },
          url: "https://example.test/admin",
          action_id: "example_0",
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Open in Stripe" },
          url: "https://dashboard.stripe.com/x",
          action_id: "example_1",
        },
      ]);
    });

    /** @scenario "Every notice ends with where and when it was sent" */
    it("ends with the environment and a moment Slack localises", () => {
      const footer = message.blocks.at(-1);
      if (footer?.type !== "context") throw new Error("expected a context footer");
      expect(footer.elements).toEqual([
        {
          type: "mrkdwn",
          text: "app.langwatch.ai · <!date^1790000000^{date_short_pretty} at {time}|2026-09-21T14:13Z>",
        },
      ]);
    });

    /** @scenario "Every notice carries a plain-text fallback for notifications" */
    it("carries the heading, summary and fields as the notification text", () => {
      expect(message.text).toBe(
        `${NOTICE_TONES.warning} Something happened · Acme did a thing. · Organization: Acme · Subscription ID: subscription_1`,
      );
    });
  });

  describe("given values holding Slack's control characters", () => {
    const message = composeMessage({
      noticeId: "example",
      layout: {
        tone: "signup",
        title: "New user registered",
        fields: [{ label: "Organization", value: "<!channel> & <https://evil.test|click>" }],
        note: "a > b",
      },
      origin,
    });

    /** @scenario "Words from the product cannot break the message's formatting" */
    it("escapes them rather than letting them mention or link", () => {
      const serialised = JSON.stringify(message);
      expect(serialised).not.toContain("<!channel>");
      expect(serialised).not.toContain("<https://evil.test");
      expect(fieldTextsOf(message.blocks)).toEqual([
        "*Organization*\n&lt;!channel&gt; &amp; &lt;https://evil.test|click&gt;",
      ]);
    });
  });

  describe("given more fields than one section holds", () => {
    const message = composeMessage({
      noticeId: "example",
      layout: {
        tone: "lead",
        title: "Many fields",
        fields: Array.from({ length: 12 }, (_, index) => ({ label: `F${index}`, value: "v" })),
      },
      origin,
    });

    it("spreads them over sections of ten", () => {
      const sections = message.blocks.filter((block) => block.type === "section");
      expect(sections).toHaveLength(2);
      expect(fieldTextsOf(message.blocks)).toHaveLength(12);
    });
  });

  describe("given a title longer than a header allows", () => {
    it("clips it to Slack's 150 characters", () => {
      const message = composeMessage({
        noticeId: "example",
        layout: { tone: "lead", title: "x".repeat(400), fields: [] },
        origin,
      });
      expect(textOf(message.blocks[0])).toHaveLength(150);
    });
  });
});

describe("moment()", () => {
  it("renders a Slack date token with an ISO fallback", () => {
    expect(moment(1_790_000_000_000)).toEqual({
      mrkdwn: "<!date^1790000000^{date_short_pretty} at {time}|2026-09-21T14:13Z>",
      plain: "2026-09-21T14:13Z",
    });
  });
});

describe("defineNotice()", () => {
  const notice = defineNotice({
    id: "example",
    title: "Example",
    sentWhen: "In tests.",
    schema: z.object({ name: z.string(), url: z.url() }),
    compose: (props) => ({
      tone: "win",
      title: "Example",
      fields: [{ label: "Name", value: props.name }],
      actions: [{ label: "Open", url: props.url }],
    }),
    fixtures: { plain: { name: "Acme", url: "https://example.test" } },
  });

  describe("when props do not match the schema", () => {
    /** @scenario "Props that do not match the schema are refused" */
    it("refuses to render rather than posting a half-filled notice", () => {
      expect(() =>
        notice.renderUnknown({ props: { name: "Acme", url: "not a url" }, origin }),
      ).toThrow(z.ZodError);
    });
  });

  describe("when the origin is not a moment", () => {
    it("refuses to render", () => {
      expect(() =>
        notice.render({
          props: { name: "Acme", url: "https://example.test" },
          origin: { environment: "", sentAt: 1 },
        }),
      ).toThrow(z.ZodError);
    });
  });

  it("lists its fixtures by name", () => {
    expect(notice.fixtures).toEqual([
      { name: "plain", props: { name: "Acme", url: "https://example.test" } },
    ]);
  });
});
