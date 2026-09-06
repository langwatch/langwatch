import { z } from "zod";
import {
  CountTiles,
  DataTable,
  EmailLayout,
  Muted,
  Paragraph,
  ActionRow,
  type DataRow,
} from "./email-layout";
import { defineTemplate, renderMailTemplate } from "./registry";

/**
 * How many matches one digest lists.
 *
 * A settlement window can flush hundreds of matches at a cap breach, and a mail
 * with hundreds of links is neither readable nor deliverable. The remaining
 * matches are still claimed, still counted and still visible in the product;
 * only the mail is truncated.
 */
const DIGEST_ROW_LIMIT = 10;

/**
 * One settled match, as a row in the digest.
 *
 * Everything past the two identifiers is optional and everything optional is
 * something the sender already had: the moment it happened, a short preview of
 * what matched, and the number that tripped the automation. A row carrying
 * only an identifier still renders, in the same table, exactly as informative
 * as the whole digest used to be.
 */
export const triggerDigestEntry = z.object({
  traceId: z.string().optional(),
  graphId: z.string().optional(),
  /** When it happened, already formatted by the sender in its own zone. */
  occurredAt: z.string().min(1).optional(),
  /** A short piece of what matched — the trace's input, or the graph's name. */
  preview: z.string().min(1).optional(),
  /** The score or metric that tripped the automation. */
  value: z.string().min(1).optional(),
  /** What that value is measured in. */
  unit: z.string().min(1).optional(),
});

export type TriggerDigestEntry = z.infer<typeof triggerDigestEntry>;

/**
 * What the digest is rendered from.
 *
 * `triggerType` is a plain string rather than the automation feature's
 * `AlertType`: the only thing the template does with it is put it in
 * parentheses ahead of the heading, so naming the union here would buy the
 * mail gateway a dependency on a feature contract for a value it never
 * branches on.
 *
 * Nothing here reads configuration. `baseHost` arrives from the composition
 * root, and every link in the mail is built from it, so a deployment behind a
 * different origin sends links that resolve.
 */
export const triggerDigestMail = z.object({
  triggerName: z.string().min(1),
  triggerType: z.string().nullable(),
  triggerMessage: z.string(),
  projectSlug: z.string().min(1),
  baseHost: z.url(),
  entries: z.array(triggerDigestEntry),
  /**
   * The automation these matches came from, when the sender names it.
   *
   * This digest is only ever the one nobody wrote a message for, so its reader
   * is exactly the person who does not know they can write their own. With the
   * id the mail can offer that; without it, it says nothing.
   */
  triggerId: z.string().min(1).optional(),
});

export type TriggerDigestMail = z.infer<typeof triggerDigestMail>;

/**
 * Where a row points.
 *
 * A graph automation's match is a threshold on a chart rather than one trace,
 * so it links to the chart. `#` is the deliberate ending for a match that
 * carries neither: a link that goes nowhere is better than one that resolves to
 * a trace page for an id the project does not hold.
 */
const linkFor = (
  entry: TriggerDigestEntry,
  { projectSlug, baseHost }: { projectSlug: string; baseHost: string },
): string => {
  if (entry.graphId) return `${baseHost}/${projectSlug}/analytics/custom/${entry.graphId}`;
  if (entry.traceId) return `${baseHost}/${projectSlug}/traces/${entry.traceId}`;
  return "#";
};

/** Where the automation's own message is written, built the way a row link is. */
const automationEditUrl = ({
  baseHost,
  projectSlug,
  triggerId,
}: {
  baseHost: string;
  projectSlug: string;
  triggerId: string;
}): string =>
  `${baseHost}/${projectSlug}/automations?drawer.open=automation&drawer.automationId=${triggerId}`;

const textFor = (entry: TriggerDigestEntry): string =>
  entry.graphId ? "View graph" : (entry.traceId ?? "View");

/** Long enough to recognise a conversation, short enough to hold a table cell. */
const PREVIEW_LIMIT = 60;

const truncate = (value: string): string =>
  value.length > PREVIEW_LIMIT ? `${value.slice(0, PREVIEW_LIMIT - 1)}…` : value;

/**
 * The subject the worker puts on the digest.
 *
 * The worker owns the envelope — the no-reply `To`, the BCC fan-out, the
 * unsubscribe footer — and assembles this line itself. It is repeated here so
 * the studio shows the real subject beside the real body rather than a guess.
 */
export const triggerDigestSubject = ({ triggerType, triggerName }: TriggerDigestMail): string =>
  `${triggerType ? `(${triggerType}) ` : ""}Trigger - ${triggerName}`;

export const TriggerDigestEmail = (input: TriggerDigestMail) => {
  const shown = input.entries.slice(0, DIGEST_ROW_LIMIT);
  const hidden = input.entries.length - shown.length;
  const rows: DataRow[] = shown.map((entry, index) => ({
    key: `${entry.graphId ?? entry.traceId ?? "row"}-${index}`,
    href: linkFor(entry, input),
    cells: {
      what: entry.preview ? truncate(entry.preview) : textFor(entry),
      when: entry.occurredAt ?? "",
      value: entry.value ? `${entry.value}${entry.unit ? ` ${entry.unit}` : ""}` : "",
      open: entry.graphId ? "View graph" : "View trace",
    },
  }));

  return (
    <EmailLayout
      eyebrow="TRIGGER"
      preview={`${input.entries.length} matches from ${input.triggerName}`}
      heading={input.triggerName}
      footNote="You are receiving this because an automation in this project sends it."
    >
      <Paragraph>
        {`This automation settled ${input.entries.length.toLocaleString()} ${input.entries.length === 1 ? "match" : "matches"}${input.triggerType ? ` on ${input.triggerType}` : ""}.`}
      </Paragraph>
      {input.triggerMessage && <Paragraph>{input.triggerMessage}</Paragraph>}
      <CountTiles
        tiles={[
          { label: "Matched", value: input.entries.length.toLocaleString() },
          { label: "Listed here", value: shown.length.toLocaleString() },
          ...(hidden > 0 ? [{ label: "Not listed", value: hidden.toLocaleString() }] : []),
        ]}
      />
      <DataTable
        columns={[
          { key: "what", label: "What matched", width: "46%" },
          { key: "when", label: "When", secondary: true, width: "14%" },
          { key: "value", label: "Value", align: "right", width: "22%" },
          { key: "open", label: "Open", align: "right", secondary: true, width: "18%" },
        ]}
        rows={rows}
      />
      {hidden > 0 && (
        <Muted>
          {`${hidden.toLocaleString()} more ${hidden === 1 ? "match is" : "matches are"} not listed here. All of them are in the product.`}
        </Muted>
      )}
      {input.triggerId && (
        <ActionRow
          primary={{
            href: automationEditUrl({
              baseHost: input.baseHost,
              projectSlug: input.projectSlug,
              triggerId: input.triggerId,
            }),
            label: "Write your own message",
          }}
          note="Replaces this digest with whatever you want the automation to say, to whoever it notifies."
        />
      )}
    </EmailLayout>
  );
};

export const triggerDigestEmailTemplate = defineTemplate({
  id: "trigger-digest",
  title: "Automation digest",
  sentWhen: "An automation settles matches and its author wrote no template of their own.",
  schema: triggerDigestMail,
  subject: triggerDigestSubject,
  Component: TriggerDigestEmail,
  fixtures: {
    default: {
      triggerName: "Low satisfaction on checkout",
      triggerType: "alert",
      triggerMessage: "Three or more low-satisfaction answers in the checkout flow.",
      projectSlug: "support-agent",
      baseHost: "https://app.langwatch.ai",
      entries: [
        {
          traceId: "trace_4KpQ2mXv9dLbR7",
          occurredAt: "09:14",
          preview: "My order still has not arrived and nobody will tell me why",
          value: "0.21",
          unit: "satisfaction",
        },
        {
          traceId: "trace_8ZnT1cWy3fJhU0",
          occurredAt: "09:41",
          preview: "This is the third time I am asking about the same refund",
          value: "0.18",
          unit: "satisfaction",
        },
        {
          graphId: "graph_5RmB6qEs2vNkP4",
          occurredAt: "10:02",
          preview: "Checkout satisfaction, hourly",
          value: "0.24",
          unit: "satisfaction",
        },
      ],
      triggerId: "auto_7Kd2ppQ4",
    },
    "identifiers only": {
      triggerName: "Low satisfaction on checkout",
      triggerType: "alert",
      triggerMessage: "",
      projectSlug: "support-agent",
      baseHost: "https://app.langwatch.ai",
      entries: [{ traceId: "trace_4KpQ2mXv9dLbR7" }, { graphId: "graph_5RmB6qEs2vNkP4" }],
      triggerId: "auto_7Kd2ppQ4",
    },
    "truncated at ten": {
      triggerName: "Every failed evaluation",
      triggerType: null,
      triggerMessage: "",
      projectSlug: "support-agent",
      baseHost: "https://app.langwatch.ai",
      entries: Array.from({ length: 24 }, (_unused, index) => ({
        traceId: `trace_${String(index).padStart(4, "0")}aXcVbNmQwE`,
      })),
    },
  },
});

export const renderTriggerDigestEmail = async (input: TriggerDigestMail): Promise<string> =>
  (await renderMailTemplate(triggerDigestEmailTemplate, input)).html;
