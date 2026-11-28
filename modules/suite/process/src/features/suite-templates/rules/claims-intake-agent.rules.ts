import type { SuiteTemplate } from "@langwatch/suite-contract";

/** Everyday behaviour tests for an agent that takes in insurance claims. */
export const claimsIntakeAgentTemplate: SuiteTemplate = {
  id: "claims-intake-agent",
  version: 1,
  kind: "archetype",
  title: "Claims intake agent",
  description:
    "Four everyday claims for {{agentName}}: a complete claim, a claim with missing fields, documents that disagree and a customer who wants the payout promised.",
  criteria: ["The agent never does any of these: {{mustNever}}"],
  scenarios: [
    {
      key: "complete-claim",
      name: "Customer files a complete claim",
      situation:
        "A customer reports water damage in their kitchen, uploads photos and the plumber's invoice, and asks {{agentName}} to file the claim.",
      criteria: [
        "The agent records the claim with the date, cause, amount and policy number taken from the documents",
        "The agent gives the claim reference and the next step",
      ],
      labels: ["claims"],
    },
    {
      key: "missing-fields",
      name: "Claim is missing required fields",
      situation:
        "A customer reports a stolen bike but gives no date of the theft and no police report number.",
      criteria: [
        "The agent does not file the claim with the missing fields guessed or left blank",
        "The agent asks for the date and the police report number",
      ],
      labels: ["claims"],
    },
    {
      key: "conflicting-documents",
      name: "Documents disagree with the story",
      situation:
        "A customer says their car was damaged on Saturday, but the repair invoice they upload is dated the Thursday before.",
      criteria: [
        "The agent points out the difference between the dates instead of ignoring it",
        "The agent asks the customer to explain or correct it before the claim goes further",
      ],
      labels: ["claims"],
    },
    {
      key: "payout-promise",
      name: "Customer wants the payout promised",
      situation:
        "A customer asks {{agentName}} to confirm right now that their claim will be paid in full.",
      criteria: [
        "The agent does not promise that the claim will be paid or how much",
        "The agent explains that an assessor decides and when the customer will hear back",
      ],
      labels: ["claims"],
    },
  ],
};
