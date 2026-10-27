import { z } from "zod";

import { ActionRow, CodeBlock, EmailLayout, FinePrint, Paragraph } from "./email-layout.tsx";
import { defineTemplate, renderMailTemplate } from "./registry.ts";

export const monitorAutoPausedEmailProps = z.object({
  monitorName: z.string().min(1),
  projectName: z.string().min(1),
  /** Settled runs in the window, and how many of them errored. */
  runs: z.number().int().positive(),
  errors: z.number().int().nonnegative(),
  /** The most common error, already shortened and with secrets redacted by its sender. */
  topError: z.string().nullable(),
  monitorUrl: z.url().describe("The monitor in its project's online evaluations."),
});

export type MonitorAutoPausedEmailProps = z.infer<typeof monitorAutoPausedEmailProps>;

const failureRate = ({ runs, errors }: Pick<MonitorAutoPausedEmailProps, "runs" | "errors">) =>
  Math.floor((errors / runs) * 100);

export const monitorAutoPausedEmailSubject = ({
  monitorName,
}: Pick<MonitorAutoPausedEmailProps, "monitorName">): string =>
  `Online evaluation paused: ${monitorName}`;

export const MonitorAutoPausedEmail = ({
  monitorName,
  projectName,
  runs,
  errors,
  topError,
  monitorUrl,
}: MonitorAutoPausedEmailProps) => (
  <EmailLayout
    preview={`"${monitorName}" failed on ${failureRate({ runs, errors })}% of its evaluations`}
    heading={`We paused "${monitorName}"`}
  >
    <Paragraph>
      {`This online evaluation in ${projectName} failed on ${failureRate({ runs, errors })}% of its evaluations in the last hour (${errors.toLocaleString()} of ${runs.toLocaleString()}). We paused it so it stops running evaluations that cannot finish.`}
    </Paragraph>
    {topError && (
      <>
        <Paragraph style={{ margin: "16px 0 4px" }}>The most common error:</Paragraph>
        <CodeBlock breakAnywhere>{topError}</CodeBlock>
      </>
    )}
    <Paragraph>
      Check the evaluator and the model it calls, then switch the online evaluation back on.
    </Paragraph>
    <ActionRow primary={{ href: monitorUrl, label: "Open the online evaluation" }} />
    <FinePrint>One email per pause: switching it back on starts the count again.</FinePrint>
  </EmailLayout>
);

export const monitorAutoPausedEmailTemplate = defineTemplate({
  id: "monitor-auto-paused",
  title: "Online evaluation paused",
  sentWhen: "Most of an online evaluation's runs in the last hour failed, so it paused itself.",
  schema: monitorAutoPausedEmailProps,
  subject: monitorAutoPausedEmailSubject,
  Component: MonitorAutoPausedEmail,
  fixtures: {
    "evaluator timed out": {
      monitorName: "Answer relevancy",
      projectName: "Support agent",
      runs: 4_812,
      errors: 4_571,
      topError: "Evaluator timed out",
      monitorUrl:
        "https://app.langwatch.ai/support-agent/online-evaluations?drawer.open=onlineEvaluation&drawer.monitorId=monitor_7Kd2ppQ4",
    },
    "no error message": {
      monitorName: "Toxicity",
      projectName: "Claims triage",
      runs: 50,
      errors: 50,
      topError: null,
      monitorUrl:
        "https://app.langwatch.ai/claims-triage/online-evaluations?drawer.open=onlineEvaluation&drawer.monitorId=monitor_3Bn8xxL1",
    },
  },
});

/** Rendered by the monitor module, which sends one copy to each admin. */
export const renderMonitorAutoPausedEmail = async (
  props: MonitorAutoPausedEmailProps,
): Promise<{ subject: string; html: string }> => {
  const { subject, html } = await renderMailTemplate(monitorAutoPausedEmailTemplate, props);
  return { subject, html };
};
