import type { CheckTypes, TraceCheckDefinition } from "./types";

export const AVAILABLE_TRACE_CHECKS: {
  [K in CheckTypes]: TraceCheckDefinition<K>;
} = {
  pii_check: {
    name: "Google DLP PII Detection",
    description:
      "Detects Personal Identifiable Information (PII) such as email addresses, phone numbers, credit card numbers, and more",
    parametersDescription: {
      infoTypes: {
        name: "PII types to check",
        description: "The types of PII that are relevant to check for",
      },
      minLikelihood: {
        name: "PII probability threshold",
        description:
          "The minimum confidence that a PII was found to fail the check",
      },
      checkPiiInSpans: {
        name: "Fail for PII in spans",
        description:
          "Whether this check fail is PII is identified in the inner spans of a message, or just in the final input and output",
      },
    },
    default: {
      parameters: {
        infoTypes: {
          phoneNumber: true,
          emailAddress: true,
          creditCardNumber: true,
          ibanCode: true,
          ipAddress: true,
          passport: true,
          vatNumber: true,
          medicalRecordNumber: true,
        },
        minLikelihood: "POSSIBLE",
        checkPiiInSpans: false,
      },
    },
  },
  toxicity_check: {
    name: "Azure Content Safety Moderation",
    description:
      "Detects hate speech, self-harm, sexual and violent content",
    parametersDescription: {
      categories: {
        name: "Categories to check",
        description: "The categories of moderation to check for",
      },
    },
    default: {
      parameters: {
        categories: {
          hate: true,
          selfHarm: true,
          sexual: true,
          violence: true,
        },
      },
    },
  },
  jailbreak_check: {
    name: "Azure Jailbreak Detection",
    description:
      "Detects if the input attempts to Jailbreak the LLM to produce answers and execute tasks that it was not supposed to",
    parametersDescription: {},
    default: {
      parameters: {},
    },
  },
  ragas_answer_relevancy: {
    name: "Ragas Answer Relevancy",
    description: "Evaluates how relevant the answer is to the input",
    parametersDescription: {},
    default: {
      parameters: {},
      preconditions: [{ field: "input", rule: "contains", value: "?" }],
    },
  },
  ragas_faithfulness: {
    name: "Ragas Faithfulness",
    requiresRag: true,
    description:
      "For RAG messages, evaluates the factual consistency of the generated answer against the RAG provided context",
    parametersDescription: {},
    default: {
      parameters: {},
    },
  },
  ragas_context_precision: {
    name: "Ragas Context Precision",
    requiresRag: true,
    description:
      "For RAG messages, evaluates the ratio of relevance from the RAG provided contexts to the input",
    parametersDescription: {},
    default: {
      parameters: {},
    },
  },
  inconsistency_check: {
    name: "(Beta) Inconsistency Detection",
    description:
      "Detects inconsistencies between input and output text for hallucination prevention",
    parametersDescription: {},
    default: {
      parameters: {},
    },
  },
  custom: {
    name: "Custom",
    description:
      "Build your own guardrails and measurements using heuristics or LLMs-on-LLMs evalution",
    parametersDescription: {
      rules: {},
    },
    default: {
      parameters: {
        rules: [
          {
            field: "output",
            rule: "not_contains",
            value: "",
            model: "gpt-4-1106-preview",
            ...({ failWhen: { condition: "<", amount: 0.7 } } as any),
          },
        ],
      },
    },
  },
};

export const getTraceCheckDefinitions = (name: string) => {
  for (const [key, val] of Object.entries(AVAILABLE_TRACE_CHECKS)) {
    if (key === name) return val;
  }
  return undefined;
};
