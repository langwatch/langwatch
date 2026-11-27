import type { SuiteTemplate } from "@langwatch/suite-contract";

/** Everyday behaviour tests for an agent that talks to customers on the phone. */
export const voiceSupportAgentTemplate: SuiteTemplate = {
  id: "voice-support-agent",
  version: 1,
  kind: "archetype",
  title: "Voice support agent",
  description:
    "Five everyday phone calls for {{agentName}}: a caller who switches language, a caller who interrupts, dates and numbers read back, a booking with a callback and a noisy line.",
  criteria: [
    "The agent speaks in short sentences that work on the phone, without lists or formatting",
    "The agent never does any of these: {{mustNever}}",
  ],
  scenarios: [
    {
      key: "language-switch",
      name: "Caller switches language mid-call",
      situation:
        "A caller starts the call in English, then switches to Spanish halfway through because they find it easier.",
      criteria: [
        "The agent continues in Spanish after the caller switches",
        "The agent keeps the details already collected and does not restart the call",
      ],
      labels: ["voice"],
    },
    {
      key: "caller-interrupts",
      name: "Caller interrupts the agent",
      situation:
        "While {{agentName}} explains the options, the caller cuts in to say they only want the earliest appointment.",
      criteria: [
        "The agent stops and answers what the caller asked instead of finishing its list",
        "The agent does not repeat the options the caller already rejected",
      ],
      labels: ["voice"],
    },
    {
      key: "read-back",
      name: "Agent reads back dates and numbers",
      situation:
        "A caller gives their customer number and asks to move their appointment to the 14th at half past three.",
      criteria: [
        "The agent reads the customer number, the date and the time back to the caller",
        "The agent changes the appointment only after the caller confirms they are right",
      ],
      labels: ["voice"],
    },
    {
      key: "book-and-callback",
      name: "Caller books a slot and asks for a callback",
      situation:
        "A caller books a service appointment for Thursday morning and asks to be called back the day before to confirm.",
      criteria: [
        "The agent books the slot with {{tools}} and confirms the day and the time",
        "The agent registers the callback for the day before and says when it will come",
      ],
      labels: ["voice"],
    },
    {
      key: "noisy-line",
      name: "Noisy line, caller has to repeat",
      situation: "A caller is on a busy street and part of their postcode is lost in the noise.",
      criteria: [
        "The agent asks the caller to repeat the missing part instead of guessing",
        "The agent reads the full postcode back before using it",
      ],
      labels: ["voice"],
    },
  ],
};
