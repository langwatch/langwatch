import { z } from "zod";

import {
  DigestFrame,
  digestCommonFields,
  formatCompact,
  formatCount,
  formatMinutes,
  formatUsd,
} from "./digest-parts.tsx";
import { ActionRow, DetailTable } from "./email-layout.tsx";
import { defineTemplate, renderMailTemplate } from "./registry.ts";

export const digestCodingAgentWeekProps = z.object({
  ...digestCommonFields,
  sessions: z.number().int().positive().describe("Coding-agent sessions this week, 5 or more"),
  tokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  activeMinutes: z.number().nonnegative(),
  linesChanged: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Absent when the agent reports none"),
  commits: z.number().int().nonnegative().optional(),
  pullRequests: z.number().int().nonnegative().optional(),
  topRepo: z.string().min(1).optional().describe("The repository with the most sessions"),
  totalsAtLeast: z
    .boolean()
    .optional()
    .describe("The week held more metric series than it keeps, so each total is a floor"),
  weekUrl: z.url().describe("Already a tracked redirect"),
});

export type DigestCodingAgentWeekProps = z.infer<typeof digestCodingAgentWeekProps>;

/** A total missing the series the week dropped reads as a floor. */
const floorOf = ({
  totalsAtLeast,
  text,
}: {
  totalsAtLeast: boolean | undefined;
  text: string;
}): string => (totalsAtLeast ? `at least ${text}` : text);

export const digestCodingAgentWeekSubject = ({
  sessions,
  costUsd,
  totalsAtLeast,
}: DigestCodingAgentWeekProps): string => {
  const cost = floorOf({ totalsAtLeast, text: formatUsd(costUsd) });
  return `Your coding agents this week: ${formatCount(sessions)} sessions, ${cost}`;
};

export const DigestCodingAgentWeek = (props: DigestCodingAgentWeekProps) => {
  const { sessions, tokens, costUsd, activeMinutes, linesChanged, commits, pullRequests, topRepo } =
    props;
  const floor = (text: string) => floorOf({ totalsAtLeast: props.totalsAtLeast, text });
  const tokensText = floor(formatCompact(tokens));
  const costText = floor(formatUsd(costUsd));

  return (
    <DigestFrame
      preview={`${formatCount(sessions)} sessions, ${tokensText} tokens, ${costText}`}
      heading={`Your coding-agent week, ${props.weekLabel}`}
      hero={{
        value: formatCount(sessions),
        caption: `coding-agent sessions, ${floor(formatMinutes(activeMinutes))} active`,
      }}
      whatsNew={props.whatsNew}
      reason="You use coding agents with LangWatch."
      preferencesUrl={props.preferencesUrl}
    >
      <DetailTable
        rows={[
          { label: "Cost", value: costText },
          { label: "Tokens", value: tokensText },
          ...(linesChanged === undefined
            ? []
            : [{ label: "Lines changed", value: floor(formatCount(linesChanged)) }]),
          ...(commits === undefined
            ? []
            : [{ label: "Commits", value: floor(formatCount(commits)) }]),
          ...(pullRequests === undefined
            ? []
            : [{ label: "Pull requests", value: floor(formatCount(pullRequests)) }]),
          ...(topRepo ? [{ label: "Top repository", value: topRepo }] : []),
        ]}
      />
      <ActionRow primary={{ href: props.weekUrl, label: "See your sessions" }} />
    </DigestFrame>
  );
};

const links = {
  preferencesUrl: "https://app.langwatch.ai/api/digest/c/tk_unsub4Zr1",
  weekUrl: "https://app.langwatch.ai/api/digest/c/tk_agent3Wf8",
} as const;

export const digestCodingAgentWeekTemplate = defineTemplate({
  id: "digest-coding-agent-week",
  title: "Weekly digest: coding-agent week",
  sentWhen: "A person's week, when they had 5 or more coding-agent sessions.",
  schema: digestCodingAgentWeekProps,
  subject: digestCodingAgentWeekSubject,
  Component: DigestCodingAgentWeek,
  fixtures: {
    "heavy user": {
      weekLabel: "Sep 22 to 28",
      sessions: 64,
      tokens: 18_400_000,
      costUsd: 212.4,
      activeMinutes: 1_215,
      linesChanged: 9_870,
      commits: 41,
      pullRequests: 12,
      topRepo: "acme/support-agent",
      whatsNew: {
        title: "Budgets for coding agents",
        body: "Set a weekly spend limit per person and get warned before it is reached.",
        gradient: "meadow",
        linkLabel: "Set a budget",
        linkUrl: "https://app.langwatch.ai/api/digest/c/tk_budge6Hn1",
      },
      ...links,
    },
    "light user": {
      weekLabel: "Sep 22 to 28",
      sessions: 5,
      tokens: 420_000,
      costUsd: 3.85,
      activeMinutes: 48,
      ...links,
    },
    "agent that reports only sessions and commits": {
      weekLabel: "Sep 22 to 28",
      sessions: 17,
      tokens: 2_900_000,
      costUsd: 27.1,
      activeMinutes: 312,
      commits: 9,
      topRepo: "northwind/billing",
      ...links,
    },
  },
});

/** Rendered by the digest module, which owns the envelope and its one-click unsubscribe. */
export const renderDigestCodingAgentWeekEmail = async (
  props: DigestCodingAgentWeekProps,
): Promise<{ subject: string; html: string }> => {
  const { subject, html } = await renderMailTemplate(digestCodingAgentWeekTemplate, props);
  return { subject, html };
};
