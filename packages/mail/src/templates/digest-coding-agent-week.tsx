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
import { defineTemplate } from "./registry.ts";

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
  weekUrl: z.url().describe("Already a tracked redirect"),
});

export type DigestCodingAgentWeekProps = z.infer<typeof digestCodingAgentWeekProps>;

export const digestCodingAgentWeekSubject = ({
  sessions,
  costUsd,
}: DigestCodingAgentWeekProps): string =>
  `Your coding agents this week: ${formatCount(sessions)} sessions, ${formatUsd(costUsd)}`;

export const DigestCodingAgentWeek = (props: DigestCodingAgentWeekProps) => {
  const { sessions, tokens, costUsd, activeMinutes, linesChanged, commits, pullRequests, topRepo } =
    props;

  return (
    <DigestFrame
      preview={`${formatCount(sessions)} sessions, ${formatCompact(tokens)} tokens, ${formatUsd(costUsd)}`}
      heading={`Your coding-agent week, ${props.weekLabel}`}
      hero={{
        value: formatCount(sessions),
        caption: `coding-agent sessions, ${formatMinutes(activeMinutes)} active`,
      }}
      whatsNew={props.whatsNew}
      reason="You use coding agents with LangWatch."
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <DetailTable
        rows={[
          { label: "Cost", value: formatUsd(costUsd) },
          { label: "Tokens", value: formatCompact(tokens) },
          ...(linesChanged === undefined
            ? []
            : [{ label: "Lines changed", value: formatCount(linesChanged) }]),
          ...(commits === undefined ? [] : [{ label: "Commits", value: formatCount(commits) }]),
          ...(pullRequests === undefined
            ? []
            : [{ label: "Pull requests", value: formatCount(pullRequests) }]),
          ...(topRepo ? [{ label: "Top repository", value: topRepo }] : []),
        ]}
      />
      <ActionRow primary={{ href: props.weekUrl, label: "See your sessions" }} />
    </DigestFrame>
  );
};

const links = {
  unsubscribeUrl: "https://app.langwatch.ai/api/digest/c/tk_unsub4Zr1",
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
