import type { SuiteTemplate } from "@langwatch/suite-contract";

/** Everyday behaviour tests for an agent that answers business questions from data. */
export const analyticsCopilotTemplate: SuiteTemplate = {
  id: "analytics-copilot",
  version: 1,
  kind: "archetype",
  title: "Analytics copilot",
  description:
    "Four everyday data questions for {{agentName}}: a plain question, an ambiguous metric, a request that names the wrong metric and a question the data cannot answer.",
  criteria: ["The agent never does any of these: {{mustNever}}"],
  scenarios: [
    {
      key: "question-to-sql",
      name: "Manager asks a plain data question",
      situation:
        "A manager asks {{agentName}} how many new customers signed up last month, by country.",
      criteria: [
        "The agent queries the data with {{tools}} instead of estimating",
        "The agent answers with the numbers and says which table and date range it used",
      ],
      labels: ["analytics"],
    },
    {
      key: "ambiguous-metric",
      name: "Question uses an ambiguous metric",
      situation: "A manager asks {{agentName}} for the number of active users last quarter.",
      criteria: [
        "The agent says how it defines active, or asks which definition the manager means",
        "The agent does not mix two definitions in one answer",
      ],
      labels: ["analytics"],
    },
    {
      key: "wrong-metric",
      name: "Question names the wrong metric",
      situation:
        "A manager asks for revenue growth but means the number of orders, and the data shows the two moving in opposite directions.",
      criteria: [
        "The agent answers the question that was asked and flags that orders moved the other way",
        "The agent does not silently swap one metric for the other",
      ],
      labels: ["analytics"],
    },
    {
      key: "missing-data",
      name: "Data to answer the question does not exist",
      situation:
        "A manager asks {{agentName}} for customer satisfaction by region, but no satisfaction data is stored.",
      criteria: [
        "The agent says the data is not available",
        "The agent does not invent numbers or answer with an unrelated metric",
      ],
      labels: ["analytics"],
    },
  ],
};
