import { z } from "zod";

import { code, count, defineNotice } from "../notice.ts";

export const selfHostedSignalNotice = defineNotice({
  id: "self-hosted-signal",
  title: "Self-hosted lead signal",
  sentWhen:
    "A self-hosted install's usage report raises a lead signal; to the self-hosted channel, else the signups channel.",
  schema: z.object({
    headline: z.string().describe("The signal, in the sentence a person reads"),
    instanceId: z.string(),
    organizationName: z.string().nullish(),
    leadingDomain: z.string().nullish(),
    version: z.string().nullish(),
    users: z.number().nullish(),
    traces28d: z.number().nullish(),
    instanceUrl: z.url(),
  }),
  compose: (props) => ({
    tone: "lead",
    title: props.headline,
    fields: [
      { label: "Company", value: props.organizationName ?? props.leadingDomain ?? "Unknown" },
      { label: "Release", value: props.version ?? "unknown" },
      { label: "Users", value: count(props.users) },
      { label: "Traces, last 28 days", value: count(props.traces28d) },
      { label: "Instance", value: code(props.instanceId) },
    ],
    actions: [{ label: "Open in backoffice", url: props.instanceUrl, primary: true }],
  }),
  fixtures: {
    "a known company": {
      headline: "A self-hosted install is run by a company we already know",
      instanceId: "instance_7c1f0e",
      organizationName: "Acme Robotics",
      leadingDomain: "acme.example",
      version: "3.4.0",
      users: 14,
      traces28d: 482_113,
      instanceUrl: "https://app.langwatch.ai/ops/backoffice/self-hosted-instances",
    },
    "nothing reported yet": {
      headline: "A self-hosted install grew past a team",
      instanceId: "instance_7c1f0e",
      instanceUrl: "https://app.langwatch.ai/ops/backoffice/self-hosted-instances",
    },
  },
});
