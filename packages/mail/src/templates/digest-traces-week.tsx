import { z } from "zod";

import {
  DigestFrame,
  digestCommonFields,
  formatCompact,
  formatCount,
  formatLatency,
  formatPercent,
  formatUsd,
} from "./digest-parts.tsx";
import { ActionRow, DataTable, DetailTable, Muted } from "./email-layout.tsx";
import { defineTemplate } from "./registry.ts";

export const digestTracesWeekProps = z.object({
  ...digestCommonFields,
  projectName: z.string().min(1),
  traces: z.number().int().positive().describe("Traces this week, 1,000 or more"),
  changePercent: z.number().optional().describe("Against last week, negative when down"),
  errors: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  tokens: z.number().int().nonnegative(),
  p50Milliseconds: z.number().nonnegative(),
  p95Milliseconds: z.number().nonnegative(),
  topModels: z
    .array(z.object({ name: z.string().min(1), traces: z.number().int().nonnegative() }))
    .max(3),
  evaluations: z
    .array(z.object({ name: z.string().min(1), passRatePercent: z.number().min(0).max(100) }))
    .max(3)
    .describe("Pass rate per evaluator, empty when none ran"),
  tracesUrl: z.url().describe("Already a tracked redirect"),
});

export type DigestTracesWeekProps = z.infer<typeof digestTracesWeekProps>;

export const digestTracesWeekSubject = ({ projectName, traces }: DigestTracesWeekProps): string =>
  `${projectName}: ${formatCompact(traces)} traces this week`;

const changeCaption = (changePercent: number | undefined): string => {
  if (changePercent === undefined) return "traces this week";
  const direction = changePercent < 0 ? "down" : "up";

  return `traces this week, ${direction} ${formatPercent(Math.abs(changePercent))} on last week`;
};

export const DigestTracesWeek = (props: DigestTracesWeekProps) => {
  const { projectName, traces, errors, costUsd, tokens, topModels, evaluations } = props;
  const errorRate = traces === 0 ? 0 : (errors / traces) * 100;

  return (
    <DigestFrame
      preview={`${formatCount(traces)} traces, ${formatCount(errors)} errors, ${formatUsd(costUsd)}`}
      heading={`${projectName} this week, ${props.weekLabel}`}
      hero={{ value: formatCount(traces), caption: changeCaption(props.changePercent) }}
      whatsNew={props.whatsNew}
      reason={`You are a member of ${projectName}.`}
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <DetailTable
        rows={[
          { label: "Errors", value: `${formatCount(errors)} (${errorRate.toFixed(1)}%)` },
          { label: "Cost", value: formatUsd(costUsd) },
          { label: "Tokens", value: formatCompact(tokens) },
          { label: "Latency p50", value: formatLatency(props.p50Milliseconds) },
          { label: "Latency p95", value: formatLatency(props.p95Milliseconds) },
        ]}
      />
      <DataTable
        columns={[
          { key: "model", label: "Top models", width: "70%" },
          { key: "traces", label: "Traces", align: "right", width: "30%" },
        ]}
        rows={topModels.map((model) => ({
          key: model.name,
          cells: { model: model.name, traces: formatCount(model.traces) },
        }))}
      />
      <DataTable
        columns={[
          { key: "evaluator", label: "Evaluations", width: "70%" },
          { key: "rate", label: "Pass rate", align: "right", width: "30%" },
        ]}
        rows={evaluations.map((evaluation) => ({
          key: evaluation.name,
          cells: { evaluator: evaluation.name, rate: formatPercent(evaluation.passRatePercent) },
        }))}
      />
      {evaluations.length === 0 && <Muted>No evaluations ran on these traces this week.</Muted>}
      <ActionRow primary={{ href: props.tracesUrl, label: "Open the traces" }} />
    </DigestFrame>
  );
};

const links = {
  unsubscribeUrl: "https://app.langwatch.ai/api/digest/c/tk_unsub4Zr1",
  tracesUrl: "https://app.langwatch.ai/api/digest/c/tk_trace1Jd5",
} as const;

export const digestTracesWeekTemplate = defineTemplate({
  id: "digest-traces-week",
  title: "Weekly digest: traces week",
  sentWhen: "A project member's week, when the project recorded 1,000 or more traces.",
  schema: digestTracesWeekProps,
  subject: digestTracesWeekSubject,
  Component: DigestTracesWeek,
  fixtures: {
    "busy project": {
      weekLabel: "Sep 22 to 28",
      projectName: "Support agent",
      traces: 128_430,
      changePercent: 18,
      errors: 1_284,
      costUsd: 642.18,
      tokens: 96_500_000,
      p50Milliseconds: 820,
      p95Milliseconds: 4_350,
      topModels: [
        { name: "gpt-4.1", traces: 71_200 },
        { name: "claude-sonnet-4", traces: 42_900 },
        { name: "gpt-4.1-mini", traces: 14_330 },
      ],
      evaluations: [
        { name: "Faithfulness", passRatePercent: 94 },
        { name: "PII leakage", passRatePercent: 99 },
        { name: "Tone", passRatePercent: 87 },
      ],
      whatsNew: {
        title: "Online evaluations on every trace",
        body: "Score live traffic with the same evaluators you test with.",
        gradient: "sky",
        linkLabel: "Turn them on",
        linkUrl: "https://app.langwatch.ai/api/digest/c/tk_onlin4Kc9",
      },
      ...links,
    },
    "just over the threshold, no evaluations": {
      weekLabel: "Sep 22 to 28",
      projectName: "Internal tools",
      traces: 1_120,
      errors: 0,
      costUsd: 4.3,
      tokens: 880_000,
      p50Milliseconds: 310,
      p95Milliseconds: 900,
      topModels: [{ name: "gpt-4.1-mini", traces: 1_120 }],
      evaluations: [],
      ...links,
    },
    "quiet week after a spike": {
      weekLabel: "Sep 22 to 28",
      projectName: "Sales copilot",
      traces: 9_860,
      changePercent: -42,
      errors: 310,
      costUsd: 58.9,
      tokens: 7_100_000,
      p50Milliseconds: 1_450,
      p95Milliseconds: 12_800,
      topModels: [
        { name: "claude-sonnet-4", traces: 6_100 },
        { name: "gpt-4.1", traces: 3_760 },
      ],
      evaluations: [{ name: "Faithfulness", passRatePercent: 71 }],
      ...links,
    },
  },
});
