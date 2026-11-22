import { z } from "zod";

import { DigestFrame, digestCommonFields, formatCount, formatPercent } from "./digest-parts.tsx";
import { ActionRow, DetailTable } from "./email-layout.tsx";
import { defineTemplate } from "./registry.ts";

export const digestScenariosTrendProps = z.object({
  ...digestCommonFields,
  projectName: z.string().min(1),
  direction: z.enum(["worse", "better"]).describe("Which way the failure rate moved"),
  failureRatePercent: z.number().min(0).max(100).describe("This week"),
  baselinePercent: z.number().min(0).max(100).describe("The average of the four weeks before"),
  runs: z.number().int().positive().describe("Scenario runs this week"),
  failed: z.number().int().nonnegative(),
  topFailing: z
    .object({ name: z.string().min(1), failed: z.number().int().positive() })
    .optional()
    .describe("The scenario that failed most this week"),
  scenariosUrl: z.url().describe("Already a tracked redirect"),
});

export type DigestScenariosTrendProps = z.infer<typeof digestScenariosTrendProps>;

export const digestScenariosTrendSubject = ({
  projectName,
  direction,
}: DigestScenariosTrendProps): string =>
  direction === "worse"
    ? `${projectName}: more scenarios are failing than usual`
    : `${projectName}: scenarios are getting better`;

export const DigestScenariosTrend = (props: DigestScenariosTrendProps) => {
  const { projectName, direction, failureRatePercent, baselinePercent, runs, failed, topFailing } =
    props;
  const worse = direction === "worse";
  const points = Math.round(Math.abs(failureRatePercent - baselinePercent));

  return (
    <DigestFrame
      preview={`${formatPercent(failureRatePercent)} of scenario runs failed, against ${formatPercent(baselinePercent)} usually`}
      heading={
        worse
          ? `More of ${projectName}'s scenarios are failing than usual`
          : `${projectName}'s scenarios are getting better`
      }
      hero={{
        value: formatPercent(failureRatePercent),
        caption: `of scenario runs failed in ${props.weekLabel}, ${worse ? "up" : "down"} ${points} points on the ${formatPercent(baselinePercent)} of the last four weeks`,
      }}
      whatsNew={props.whatsNew}
      reason={`You are a member of ${projectName}.`}
      unsubscribeUrl={props.unsubscribeUrl}
    >
      <DetailTable
        rows={[
          { label: "Runs this week", value: formatCount(runs) },
          { label: "Failed", value: formatCount(failed) },
          { label: "Passed", value: formatCount(runs - failed) },
          ...(topFailing
            ? [{ label: topFailing.name, value: `${formatCount(topFailing.failed)} failures` }]
            : []),
        ]}
      />
      <ActionRow
        primary={{
          href: props.scenariosUrl,
          label: worse ? "See what is failing" : "See the scenarios",
        }}
      />
    </DigestFrame>
  );
};

const links = {
  unsubscribeUrl: "https://app.langwatch.ai/api/digest/c/tk_unsub4Zr1",
  scenariosUrl: "https://app.langwatch.ai/api/digest/c/tk_scena9Bx2",
} as const;

export const digestScenariosTrendTemplate = defineTemplate({
  id: "digest-scenarios-trend",
  title: "Weekly digest: scenarios trend",
  sentWhen:
    "A project member's week, when the scenario failure rate moved 10 points or more from its four-week baseline, either way.",
  schema: digestScenariosTrendProps,
  subject: digestScenariosTrendSubject,
  Component: DigestScenariosTrend,
  fixtures: {
    "more failing than usual": {
      weekLabel: "Sep 22 to 28",
      projectName: "Support agent",
      direction: "worse",
      failureRatePercent: 30,
      baselinePercent: 10,
      runs: 240,
      failed: 72,
      topFailing: { name: "Refund request with a missing order", failed: 19 },
      whatsNew: {
        title: "Scenario suites in CI",
        body: "Run a suite on every pull request and see the diff against main.",
        gradient: "sky",
        linkLabel: "Set up CI runs",
        linkUrl: "https://app.langwatch.ai/api/digest/c/tk_ciruns7Yt4",
      },
      ...links,
    },
    "getting better": {
      weekLabel: "Sep 22 to 28",
      projectName: "Sales copilot",
      direction: "better",
      failureRatePercent: 10,
      baselinePercent: 30,
      runs: 180,
      failed: 18,
      ...links,
    },
    "down to a clean week": {
      weekLabel: "Sep 22 to 28",
      projectName: "Internal tools",
      direction: "better",
      failureRatePercent: 0,
      baselinePercent: 14,
      runs: 52,
      failed: 0,
      ...links,
    },
  },
});
