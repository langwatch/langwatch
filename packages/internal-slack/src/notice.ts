import { Temporal } from "@langwatch/time";
import type { Button, KnownBlock, MrkdwnElement } from "@slack/types";
import { z } from "zod";

/** The one status emoji a notice's header opens with. */
export const NOTICE_TONES = {
  win: "🎉",
  lead: "🌱",
  signup: "👋",
  warning: "⚠️",
  loss: "📉",
  failure: "🚨",
} as const;

export type NoticeTone = keyof typeof NOTICE_TONES;

/** Text that is already Slack mrkdwn, with the words a notification shows instead. */
export type Mrkdwn = Readonly<{ mrkdwn: string; plain: string }>;

/** Plain words are escaped for Slack; `Mrkdwn` parts pass through as written. */
export type NoticeText = string | Mrkdwn | readonly (string | Mrkdwn)[];

export type NoticeField = Readonly<{ label: string; value: NoticeText }>;

export type NoticeAction = Readonly<{ label: string; url: string; primary?: boolean }>;

/** What a template decides; the kit decides how every notice looks. */
export type NoticeLayout = Readonly<{
  tone: NoticeTone;
  title: string;
  summary?: NoticeText;
  fields: readonly NoticeField[];
  note?: string;
  actions?: readonly NoticeAction[];
}>;

export const noticeOriginSchema = z.object({
  environment: z.string().min(1).describe("The host that sent it, such as app.langwatch.ai"),
  sentAt: z.number().int().describe("When it was sent, in epoch milliseconds"),
});

export type NoticeOrigin = z.infer<typeof noticeOriginSchema>;

/** The body an incoming webhook posts: blocks, and the words a notification shows. */
export type SlackNoticeMessage = Readonly<{ text: string; blocks: KnownBlock[] }>;

export type NoticeFixture = Readonly<{ name: string; props: unknown }>;

/** One registered notice, props erased so a single list holds every one. */
export interface RegisteredNotice {
  readonly id: string;
  readonly title: string;
  readonly sentWhen: string;
  readonly schema: z.ZodType;
  readonly fixtures: readonly NoticeFixture[];
  renderUnknown(input: { props: unknown; origin: NoticeOrigin }): SlackNoticeMessage;
}

export interface SlackNotice<Schema extends z.ZodType> extends RegisteredNotice {
  render(input: { props: z.input<Schema>; origin: NoticeOrigin }): SlackNoticeMessage;
}

const HEADER_LIMIT = 150;
const TEXT_LIMIT = 2_000;
const FIELDS_PER_SECTION = 10;

export const bold = (text: string): Mrkdwn => ({ mrkdwn: `*${escapeMrkdwn(text)}*`, plain: text });

export const code = (text: string): Mrkdwn => ({
  mrkdwn: `\`${escapeMrkdwn(text.replaceAll("`", "'"))}\``,
  plain: text,
});

/** A moment Slack prints in each reader's own time zone. */
export const moment = (epochMs: number): Mrkdwn => {
  const iso = Temporal.Instant.fromEpochMilliseconds(epochMs).toString({ smallestUnit: "minute" });
  const seconds = Math.floor(epochMs / 1_000);
  return { mrkdwn: `<!date^${seconds}^{date_short_pretty} at {time}|${iso}>`, plain: iso };
};

/** A count as people read it, or a dash where none was given. */
export const count = (value: number | null | undefined): string =>
  typeof value === "number" ? value.toLocaleString("en-US") : "-";

export function escapeMrkdwn(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const parts = (text: NoticeText): readonly (string | Mrkdwn)[] => {
  if (typeof text === "string" || "mrkdwn" in text) return [text];
  return text;
};

export function toMrkdwn(text: NoticeText): string {
  return parts(text)
    .map((part) => (typeof part === "string" ? escapeMrkdwn(part) : part.mrkdwn))
    .join("");
}

export function toPlain(text: NoticeText): string {
  return parts(text)
    .map((part) => (typeof part === "string" ? part : part.plain))
    .join("");
}

const clip = ({ text, limit }: { text: string; limit: number }): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;

const mrkdwnElement = (text: string): MrkdwnElement => ({
  type: "mrkdwn",
  text: clip({ text, limit: TEXT_LIMIT }),
});

function fieldSections(fields: readonly NoticeField[]): KnownBlock[] {
  const sections: KnownBlock[] = [];
  for (let start = 0; start < fields.length; start += FIELDS_PER_SECTION) {
    sections.push({
      type: "section",
      fields: fields
        .slice(start, start + FIELDS_PER_SECTION)
        .map((field) => mrkdwnElement(`*${escapeMrkdwn(field.label)}*\n${toMrkdwn(field.value)}`)),
    });
  }
  return sections;
}

function actionButtons({
  noticeId,
  actions,
}: {
  noticeId: string;
  actions: readonly NoticeAction[];
}): Button[] {
  return actions.map((action, index) => ({
    type: "button",
    text: { type: "plain_text", text: action.label },
    url: action.url,
    action_id: `${noticeId}_${index}`,
    ...(action.primary ? { style: "primary" } : {}),
  }));
}

/** The one look every notice shares: header, summary, fields, note, buttons, footer. */
export function composeMessage({
  noticeId,
  layout,
  origin,
}: {
  noticeId: string;
  layout: NoticeLayout;
  origin: NoticeOrigin;
}): SlackNoticeMessage {
  const heading = `${NOTICE_TONES[layout.tone]} ${layout.title}`;
  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: clip({ text: heading, limit: HEADER_LIMIT }), emoji: true },
    },
  ];
  if (layout.summary !== undefined) {
    blocks.push({ type: "section", text: mrkdwnElement(toMrkdwn(layout.summary)) });
  }
  blocks.push(...fieldSections(layout.fields));
  if (layout.note !== undefined && layout.note.trim() !== "") {
    const quoted = escapeMrkdwn(layout.note.trim()).replaceAll("\n", "\n>");
    blocks.push({ type: "section", text: mrkdwnElement(`>${quoted}`) });
  }
  if (layout.actions !== undefined && layout.actions.length > 0) {
    blocks.push({
      type: "actions",
      elements: actionButtons({ noticeId, actions: layout.actions }),
    });
  }
  blocks.push({
    type: "context",
    elements: [
      mrkdwnElement(`${escapeMrkdwn(origin.environment)} · ${moment(origin.sentAt).mrkdwn}`),
    ],
  });

  const details = layout.summary !== undefined ? [toPlain(layout.summary)] : [];
  details.push(...layout.fields.map((field) => `${field.label}: ${toPlain(field.value)}`));
  const text = [heading, ...details].join(" · ");
  return { text: escapeMrkdwn(clip({ text, limit: TEXT_LIMIT })), blocks };
}

/**
 * Declares a notice: its props schema, how its props fill the shared layout,
 * and named fixtures. Props are parsed on every render, so a bad value is
 * refused where the notice is built rather than posted half-filled.
 */
export const defineNotice = <Schema extends z.ZodType>(spec: {
  id: string;
  title: string;
  sentWhen: string;
  schema: Schema;
  compose: (props: z.output<Schema>) => NoticeLayout;
  fixtures: Readonly<Record<string, z.input<Schema>>>;
}): SlackNotice<Schema> => {
  const renderUnknown = ({ props, origin }: { props: unknown; origin: NoticeOrigin }) =>
    composeMessage({
      noticeId: spec.id,
      layout: spec.compose(spec.schema.parse(props)),
      origin: noticeOriginSchema.parse(origin),
    });
  return {
    id: spec.id,
    title: spec.title,
    sentWhen: spec.sentWhen,
    schema: spec.schema,
    fixtures: Object.entries(spec.fixtures).map(([name, props]) => ({ name, props })),
    renderUnknown,
    render: renderUnknown,
  };
};
