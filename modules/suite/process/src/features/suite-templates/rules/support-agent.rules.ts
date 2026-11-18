import type { SuiteTemplate } from "@langwatch/suite-contract";

/** Everyday behaviour tests for a general customer support agent. */
export const supportAgentTemplate: SuiteTemplate = {
  id: "support-agent",
  version: 2,
  kind: "archetype",
  title: "Customer support agent",
  description:
    "Five everyday conversations {{agentName}} handles as a general support agent: how-to questions, account problems, escalation, frustration and out-of-scope asks.",
  criteria: ["The agent never does any of these: {{mustNever}}"],
  scenarios: [
    {
      key: "how-to-question",
      name: "Customer asks how to do something",
      situation:
        "A customer asks {{agentName}} how to change a setting they cannot find in the product.",
      criteria: [
        "The agent answers from the help content or {{tools}} instead of guessing at menus that may not exist",
        "The agent gives the steps in order and checks whether they worked",
      ],
      labels: ["support"],
    },
    {
      key: "account-locked",
      name: "Customer cannot get into their account",
      situation:
        "A customer tells {{agentName}} they are locked out of their account after too many sign-in attempts.",
      criteria: [
        "The agent verifies who the customer is before changing anything on the account",
        "The agent explains how to get back in and how long it takes",
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
      name: "Frustrated customer after a problem came back",
      situation:
        "A customer is angry because the same problem came back a week after it was fixed and writes to {{agentName}} in capitals.",
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
