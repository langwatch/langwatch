import { z } from "zod";
import { EmailLayout, InlineLink, Muted, Paragraph } from "./email-layout";
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

/** One settled match, as a row in the digest. */
export const triggerDigestEntry = z.object({
  traceId: z.string().optional(),
  graphId: z.string().optional(),
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

const textFor = (entry: TriggerDigestEntry): string =>
  entry.graphId ? "View graph" : (entry.traceId ?? "View");

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
  return (
    <EmailLayout
      preview={`${input.entries.length} matches from ${input.triggerName}`}
      heading={input.triggerName}
      footNote="You are receiving this because an automation in this project sends it."
    >
      <Paragraph>
        This automation matched {input.entries.length.toLocaleString()}{" "}
        {input.entries.length === 1 ? "message" : "messages"}
        {input.triggerType ? ` on ${input.triggerType}` : ""}. They are listed below.
      </Paragraph>
      {input.triggerMessage && <Paragraph>{input.triggerMessage}</Paragraph>}
      {shown.map((entry, index) => (
        <Paragraph
          key={`${entry.graphId ?? entry.traceId ?? "row"}-${index}`}
          style={{ margin: "0 0 8px" }}
        >
          <InlineLink href={linkFor(entry, input)}>{textFor(entry)}</InlineLink>
        </Paragraph>
      ))}
      {hidden > 0 && (
        <Muted>
          {hidden.toLocaleString()} more {hidden === 1 ? "match is" : "matches are"} not listed
          here. All of them are in the product.
        </Muted>
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
        { traceId: "trace_4KpQ2mXv9dLbR7" },
        { traceId: "trace_8ZnT1cWy3fJhU0" },
        { graphId: "graph_5RmB6qEs2vNkP4" },
      ],
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
