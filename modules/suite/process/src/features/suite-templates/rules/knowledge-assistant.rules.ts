import type { SuiteTemplate } from "@langwatch/suite-contract";

/** Everyday behaviour tests for an assistant that answers from a document collection. */
export const knowledgeAssistantTemplate: SuiteTemplate = {
  id: "knowledge-assistant",
  version: 1,
  kind: "archetype",
  title: "Knowledge assistant",
  description:
    "Four everyday questions for {{agentName}}: an answer in the documents, a question the documents do not cover, documents that disagree and a follow-up that changes the question.",
  criteria: ["The agent never does any of these: {{mustNever}}"],
  scenarios: [
    {
      key: "grounded-answer",
      name: "Answer is in the documents",
      situation:
        "An employee asks {{agentName}} how many days of parental leave the company offers.",
      criteria: [
        "The agent answers from the documents found with {{tools}}",
        "The agent names the document the answer comes from",
      ],
      labels: ["knowledge"],
    },
    {
      key: "does-not-know",
      name: "Documents do not cover the question",
      situation:
        "An employee asks {{agentName}} about the travel allowance for a country the travel policy does not mention.",
      criteria: [
        "The agent says the documents do not answer the question",
        "The agent does not make up an amount, and points to who can answer",
      ],
      labels: ["knowledge"],
    },
    {
      key: "conflicting-documents",
      name: "Two documents disagree",
      situation:
        "An employee asks how many days of remote work are allowed, and an old handbook and a newer policy give different numbers.",
      criteria: [
        "The agent points out that the two documents disagree",
        "The agent prefers the newer document and says which one it used",
      ],
      labels: ["knowledge"],
    },
    {
      key: "follow-up-question",
      name: "Follow-up changes the question",
      situation:
        "After getting an answer about the expense limit for meals, the employee asks whether the same limit applies to client dinners.",
      criteria: [
        "The agent searches again for the new question instead of repeating the first answer",
        "The agent keeps the context of the conversation in its answer",
      ],
      labels: ["knowledge"],
    },
  ],
};
