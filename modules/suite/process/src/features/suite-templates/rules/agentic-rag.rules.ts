import type { SuiteTemplate } from "@langwatch/suite-contract";

/** Behaviour tests for an agent that searches, reads and cross-checks documents in steps. */
export const agenticRagTemplate: SuiteTemplate = {
  id: "agentic-rag",
  version: 1,
  kind: "archetype",
  title: "Agentic RAG",
  description:
    "Five tender checks for an agent that searches and cross-checks documents: a bid against the requirements, a missing document, a requirement spread across files, a conflict and a question with no answer.",
  criteria: [
    "The agent cites the clause or section each statement relies on",
    "The agent never does any of these: {{mustNever}}",
  ],
  scenarios: [
    {
      key: "bid-against-requirements",
      name: "Check a bid against the tender requirements",
      situation:
        "A bid manager asks {{agentName}} whether their bid meets the selection criteria of the tender, with the tender documents and the bid both available through {{tools}}.",
      criteria: [
        "The agent checks each selection criterion against the bid and says which are met and which are not",
        "The agent cites the tender clause for every criterion it reports",
      ],
      labels: ["agentic-rag", "tender"],
    },
    {
      key: "missing-mandatory-document",
      name: "A mandatory document is missing",
      situation:
        "A bid manager asks {{agentName}} whether the bid package is complete, and the bid has no insurance certificate although the tender lists it as mandatory.",
      criteria: [
        "The agent reports that the insurance certificate is missing",
        "The agent cites the tender clause that makes the document mandatory",
      ],
      labels: ["agentic-rag", "tender"],
    },
    {
      key: "multi-step-requirement",
      name: "Requirement spread across several documents",
      situation:
        "A bid manager asks whether the bid meets the minimum turnover, and the tender notice sets the threshold while a later clarification note changes how it is calculated.",
      criteria: [
        "The agent searches more than once and reads both the tender notice and the clarification note before answering",
        "The agent combines the two documents in its answer and cites both",
      ],
      labels: ["agentic-rag", "tender"],
    },
    {
      key: "conflicting-statements",
      name: "Two documents contradict each other",
      situation:
        "A bid manager asks for the submission deadline, and the tender notice and the specifications give different dates.",
      criteria: [
        "The agent points out that the two documents give different dates and cites both",
        "The agent does not pick one silently, and suggests confirming with the contracting authority",
      ],
      labels: ["agentic-rag", "tender"],
    },
    {
      key: "not-in-documents",
      name: "Documents do not answer the question",
      situation:
        "A bid manager asks {{agentName}} whether subcontracting is allowed for the maintenance lot, and none of the tender documents mention it.",
      criteria: [
        "The agent says the documents do not answer the question and does not guess",
        "The agent suggests asking the contracting authority through the clarification process",
      ],
      labels: ["agentic-rag", "tender"],
    },
  ],
};
