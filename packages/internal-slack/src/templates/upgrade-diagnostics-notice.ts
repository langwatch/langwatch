import { z } from "zod";

import { code, defineNotice, moment } from "../notice.ts";

/** Metadata only: the bundle's error text and log lines stay in Cloud admin, never in Slack. */
export const upgradeDiagnosticsNotice = defineNotice({
  id: "upgrade-diagnostics",
  title: "Self-hosted upgrade step failed",
  sentWhen:
    "A self-hosted install sends the diagnostics of a failed upgrade step, the first time for that step and release; to the upgrade diagnostics channel.",
  schema: z.object({
    instanceId: z.string(),
    organizationName: z.string().nullish(),
    release: z.string().nullish(),
    stepId: z.string(),
    stepDescription: z.string().nullish(),
    attempt: z.number().int(),
    trigger: z.enum(["operator", "automatic"]),
    firstReportAt: z.number().int().describe("Epoch milliseconds"),
    latestReportAt: z.number().int().describe("Epoch milliseconds"),
    instanceUrl: z.url(),
  }),
  compose: (props) => ({
    tone: "failure",
    title: `Upgrade step ${props.stepId} failed on ${props.release ?? "an unknown release"}`,
    ...(props.stepDescription ? { summary: props.stepDescription } : {}),
    fields: [
      { label: "Company", value: props.organizationName ?? "Unknown" },
      { label: "Release", value: props.release ?? "unknown" },
      { label: "Step", value: code(props.stepId) },
      { label: "Attempt", value: String(props.attempt) },
      {
        label: "Sent",
        value: props.trigger === "automatic" ? "automatically" : "by the operator",
      },
      { label: "First report", value: moment(props.firstReportAt) },
      { label: "Latest report", value: moment(props.latestReportAt) },
      { label: "Instance", value: code(props.instanceId) },
    ],
    actions: [{ label: "Open in Admin", url: props.instanceUrl, primary: true }],
  }),
  fixtures: {
    "an automatic report": {
      instanceId: "instance_7c1f0e",
      organizationName: "Acme Robotics",
      release: "3.23.0",
      stepId: "trace:backfill-span-costs",
      stepDescription: "Fills the cost of every span stored before costs were recorded.",
      attempt: 2,
      trigger: "automatic",
      firstReportAt: 1_792_400_000_000,
      latestReportAt: 1_792_403_600_000,
      instanceUrl: "https://app.langwatch.ai/ops/cloud/self-hosted-instances?instance=shi_1",
    },
    "an unlicensed name and no description": {
      instanceId: "instance_7c1f0e",
      stepId: "licensing:copy-organization-licenses",
      attempt: 1,
      trigger: "operator",
      firstReportAt: 1_792_400_000_000,
      latestReportAt: 1_792_400_000_000,
      instanceUrl: "https://app.langwatch.ai/ops/cloud/self-hosted-instances",
    },
  },
});
