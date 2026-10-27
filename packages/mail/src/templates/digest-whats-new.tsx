import { z } from "zod";

import {
  DigestFrame,
  WhatsNewCard,
  digestCommonFields,
  digestUpdateSchema,
} from "./digest-parts.tsx";
import { ActionRow, Paragraph } from "./email-layout.tsx";
import { defineTemplate } from "./registry.ts";

export const digestWhatsNewProps = z.object({
  weekLabel: digestCommonFields.weekLabel,
  unsubscribeUrl: digestCommonFields.unsubscribeUrl,
  update: digestUpdateSchema.describe("This week's update, always present in this template"),
  nudge: z.object({
    text: z.string().min(1).describe("One sentence suggesting the next useful thing to do"),
    label: z.string().min(1),
    url: z.url().describe("Already a tracked redirect"),
  }),
});

export type DigestWhatsNewProps = z.infer<typeof digestWhatsNewProps>;

export const digestWhatsNewSubject = ({ update }: DigestWhatsNewProps): string =>
  `New on LangWatch: ${update.title}`;

export const DigestWhatsNew = ({
  weekLabel,
  unsubscribeUrl,
  update,
  nudge,
}: DigestWhatsNewProps) => (
  <DigestFrame
    preview={update.body}
    heading={`What is new on LangWatch, ${weekLabel}`}
    reason="You have a LangWatch account."
    unsubscribeUrl={unsubscribeUrl}
  >
    <WhatsNewCard update={update} />
    <Paragraph>{nudge.text}</Paragraph>
    <ActionRow primary={{ href: nudge.url, label: nudge.label }} />
  </DigestFrame>
);

export const digestWhatsNewTemplate = defineTemplate({
  id: "digest-whats-new",
  title: "Weekly digest: what's new",
  sentWhen:
    "Anyone else's week: the fallback when no other digest applies. This week's update and one nudge.",
  schema: digestWhatsNewProps,
  subject: digestWhatsNewSubject,
  Component: DigestWhatsNew,
  fixtures: {
    "update with a setup nudge": {
      weekLabel: "Sep 22 to 28",
      unsubscribeUrl: "https://app.langwatch.ai/api/digest/c/tk_unsub4Zr1",
      update: {
        title: "Scenario suites in CI",
        body: "Run a suite on every pull request and see the diff against main.",
        gradient: "ember",
        linkLabel: "Set up CI runs",
        linkUrl: "https://app.langwatch.ai/api/digest/c/tk_ciruns7Yt4",
      },
      nudge: {
        text: "You have not written a scenario yet. One takes about five minutes.",
        label: "Write your first scenario",
        url: "https://app.langwatch.ai/api/digest/c/tk_first2Rs8",
      },
    },
    "update with an evaluation nudge": {
      weekLabel: "Sep 29 to Oct 5",
      unsubscribeUrl: "https://app.langwatch.ai/api/digest/c/tk_unsub9Ab3",
      update: {
        title: "Budgets for coding agents",
        body: "Set a weekly spend limit per person and get warned before it is reached.",
        gradient: "meadow",
        linkLabel: "Set a budget",
        linkUrl: "https://app.langwatch.ai/api/digest/c/tk_budge6Hn1",
      },
      nudge: {
        text: "Your traces have no evaluations yet. Add one to see how often answers hold up.",
        label: "Add an evaluation",
        url: "https://app.langwatch.ai/api/digest/c/tk_evalu4Mp7",
      },
    },
  },
});
