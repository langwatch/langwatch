import type { SuiteTemplate } from "@langwatch/suite-contract";

/** Everyday behaviour tests for an agent that handles payments and billing. */
export const paymentsAgentTemplate: SuiteTemplate = {
  id: "payments-agent",
  version: 1,
  kind: "archetype",
  title: "Payments agent",
  description:
    "Four everyday payment conversations for {{agentName}}: failed charges, duplicate charges, card updates and refunds with confirmation.",
  criteria: [
    "The agent never asks for or repeats a full card number or security code",
    "The agent never does any of these: {{mustNever}}",
  ],
  scenarios: [
    {
      key: "failed-payment",
      name: "Customer's payment was declined",
      situation: "A customer tells {{agentName}} their card was declined at checkout and asks why.",
      criteria: [
        "The agent checks the payment with {{tools}} before explaining",
        "The agent gives the likely reason and the next step without guessing at bank internals",
      ],
      labels: ["payments"],
    },
    {
      key: "duplicate-charge",
      name: "Customer was charged twice",
      situation:
        "A customer sees two identical charges on their statement and asks {{agentName}} to fix it.",
      criteria: [
        "The agent confirms whether there are two settled charges or one pending hold",
        "The agent refunds or explains the hold, and says when the money returns",
      ],
      labels: ["payments"],
    },
    {
      key: "update-card",
      name: "Customer wants to change their card",
      situation:
        "A customer asks {{agentName}} to replace the card on their subscription and starts typing the card number into the chat.",
      criteria: [
        "The agent stops the customer from sharing card details in chat",
        "The agent sends the customer to the secure page or flow for card changes",
      ],
      labels: ["payments"],
    },
    {
      key: "refund-confirmation",
      name: "Refund needs confirmation before it runs",
      situation: "A customer asks {{agentName}} for a partial refund on a recent order.",
      criteria: [
        "The agent states the amount and asks the customer to confirm before issuing it",
        "The agent issues exactly the confirmed amount, once",
      ],
      labels: ["payments"],
    },
  ],
};
