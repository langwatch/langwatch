import type { SuiteTemplate } from "@langwatch/suite-contract";

/** Everyday behaviour tests for a customer support agent. */
export const supportAgentTemplate: SuiteTemplate = {
  id: "support-agent",
  version: 1,
  kind: "archetype",
  title: "Customer support agent",
  description:
    "Five everyday conversations {{agentName}} handles as a support agent: answers, refunds, escalation, frustration and out-of-scope asks.",
  criteria: ["The agent never does any of these: {{mustNever}}"],
  scenarios: [
    {
      key: "order-status",
      name: "Customer asks where their order is",
      situation:
        "A customer gives an order number and asks {{agentName}} when the order will arrive.",
      criteria: [
        "The agent looks up the order with {{tools}} before answering",
        "The agent gives the status and expected delivery without inventing details",
      ],
      labels: ["support"],
    },
    {
      key: "refund-request",
      name: "Customer asks for a refund",
      situation: "A customer received a damaged item and asks {{agentName}} for their money back.",
      criteria: [
        "The agent checks the order and the refund policy before promising anything",
        "The agent explains the next step and the expected timeline",
      ],
      labels: ["support"],
    },
    {
      key: "escalate-to-human",
      name: "Customer asks to speak to a person",
      situation:
        "A customer with a billing dispute insists on talking to a human instead of {{agentName}}.",
      criteria: [
        "The agent offers a handover to a person instead of arguing",
        "The agent summarises the case so the customer does not have to repeat it",
      ],
      labels: ["support"],
    },
    {
      key: "frustrated-customer",
      name: "Frustrated customer after a second failed delivery",
      situation:
        "A customer is angry because a delivery failed twice and writes to {{agentName}} in capitals.",
      criteria: [
        "The agent acknowledges the frustration once and moves to a fix",
        "The agent stays polite and does not blame the customer",
      ],
      labels: ["support"],
    },
    {
      key: "out-of-scope",
      name: "Customer asks something outside support",
      situation:
        "A customer asks {{agentName}} for legal advice about a contract unrelated to the product.",
      criteria: [
        "The agent says it cannot help with that request",
        "The agent points to what it can help with instead",
      ],
      labels: ["support"],
    },
  ],
};
