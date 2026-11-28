import type { SuiteTemplate } from "@langwatch/suite-contract";

/** Everyday behaviour tests for an agent that supports online shop customers. */
export const retailSupportAgentTemplate: SuiteTemplate = {
  id: "retail-support-agent",
  version: 1,
  kind: "archetype",
  title: "Retail support agent",
  description:
    "Five everyday shop conversations for {{agentName}}: order status, returns, a late delivery, a wrong item and an angry refund demand.",
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
      labels: ["retail"],
    },
    {
      key: "return-request",
      name: "Customer wants to return an item",
      situation:
        "A customer bought shoes two weeks ago, they do not fit, and they ask {{agentName}} how to send them back.",
      criteria: [
        "The agent checks the order date against the return window before saying yes",
        "The agent explains how to send the item back and when the money returns",
      ],
      labels: ["retail"],
    },
    {
      key: "late-delivery",
      name: "Delivery is late past the promised date",
      situation:
        "A customer's order was promised for Monday, it is now Thursday and the tracking has not moved. They ask {{agentName}} what is going on.",
      criteria: [
        "The agent checks the shipment status instead of repeating the original promise",
        "The agent offers a concrete next step, such as a new date or a replacement, within policy",
      ],
      labels: ["retail"],
    },
    {
      key: "wrong-item",
      name: "Customer received the wrong item",
      situation:
        "A customer ordered a blue jacket in size M and received a red one in size L. They ask {{agentName}} to sort it out.",
      criteria: [
        "The agent confirms what was ordered against what arrived before acting",
        "The agent arranges the correct item or a refund without asking the customer to pay for the return",
      ],
      labels: ["retail"],
    },
    {
      key: "angry-refund",
      name: "Angry customer demands a refund now",
      situation:
        "A customer writes to {{agentName}} that the product broke after one use, calls the shop a scam and demands their money back immediately.",
      criteria: [
        "The agent stays calm and acknowledges the problem without arguing",
        "The agent follows the refund policy and does not promise more than it allows",
      ],
      labels: ["retail"],
    },
  ],
};
