import type { CheckTypes, TraceCheckDefinition } from "./types";

export const AVAILABLE_TRACE_CHECKS: {
  [K in CheckTypes]: TraceCheckDefinition<K>;
} = {
  pii_check: {
    name: "Google DLP PII Detection",
    description:
      "Detects Personal Identifiable Information (PII) such as email addresses, phone numbers, credit card numbers, and more",
    valueDisplayType: "boolean",
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
    description: "Detects hate speech, self-harm, sexual and violent content",
    valueDisplayType: "boolean",
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
    valueDisplayType: "boolean",
    parametersDescription: {},
    default: {
      parameters: {},
    },
  },
  ragas_answer_relevancy: {
    name: "Ragas Answer Relevancy",
    description: "Evaluates how relevant the answer is to the input",
    valueDisplayType: "number",
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
    valueDisplayType: "number",
    parametersDescription: {},
    default: {
      parameters: {},
    },
  },
  ragas_context_utilization: {
    name: "Ragas Context Utilization",
    requiresRag: true,
    description:
      "For RAG messages, evaluates the ratio of relevance from the RAG provided contexts to the input",
    valueDisplayType: "number",
    parametersDescription: {},
    default: {
      parameters: {},
    },
  },
  inconsistency_check: {
    name: "(Beta) Inconsistency Detection",
    description:
      "Detects inconsistencies between input and output text for hallucination prevention",
    valueDisplayType: "number",
    parametersDescription: {},
    default: {
      parameters: {},
    },
  },
  language_check: {
    name: "Language Detection",
    description:
      "Detects the input and output language and checks for consistency",
    valueDisplayType: "boolean",
    parametersDescription: {
      checkFor: {
        name: "Check for",
        description: "What should be checked",
        labels: {
          input_matches_output: "Input and output languages should match",
          input_language: "Input language",
          output_language: "Output language",
        },
      },
      expectedLanguage: {
        name: "Expected language",
        description: "The language that the input or output is expected to be",
        labels: {
          any: "Any language",
          AF: "Afrikaans (AF)",
          AR: "Arabic (AR)",
          AZ: "Azerbaijani (AZ)",
          BE: "Belarusian (BE)",
          BG: "Bulgarian (BG)",
          BN: "Bengali (BN)",
          BS: "Bosnian (BS)",
          CA: "Catalan (CA)",
          CS: "Czech (CS)",
          CY: "Welsh (CY)",
          DA: "Danish (DA)",
          DE: "German (DE)",
          EL: "Greek (EL)",
          EN: "English (EN)",
          EO: "Esperanto (EO)",
          ES: "Spanish (ES)",
          ET: "Estonian (ET)",
          EU: "Basque (EU)",
          FA: "Persian (FA)",
          FI: "Finnish (FI)",
          FR: "French (FR)",
          GA: "Irish (GA)",
          GU: "Gujarati (GU)",
          HE: "Hebrew (HE)",
          HI: "Hindi (HI)",
          HR: "Croatian (HR)",
          HU: "Hungarian (HU)",
          HY: "Armenian (HY)",
          ID: "Indonesian (ID)",
          IS: "Icelandic (IS)",
          IT: "Italian (IT)",
          JA: "Japanese (JA)",
          KA: "Georgian (KA)",
          KK: "Kazakh (KK)",
          KO: "Korean (KO)",
          LA: "Latin (LA)",
          LG: "Ganda (LG)",
          LT: "Lithuanian (LT)",
          LV: "Latvian (LV)",
          MI: "Maori (MI)",
          MK: "Macedonian (MK)",
          MN: "Mongolian (MN)",
          MR: "Marathi (MR)",
          MS: "Malay (MS)",
          NB: "Norwegian Bokmål (NB)",
          NL: "Dutch (NL)",
          NN: "Norwegian Nynorsk (NN)",
          PA: "Punjabi (PA)",
          PL: "Polish (PL)",
          PT: "Portuguese (PT)",
          RO: "Romanian (RO)",
          RU: "Russian (RU)",
          SK: "Slovak (SK)",
          SL: "Slovenian (SL)",
          SN: "Shona (SN)",
          SO: "Somali (SO)",
          SQ: "Albanian (SQ)",
          SR: "Serbian (SR)",
          ST: "Southern Sotho (ST)",
          SV: "Swedish (SV)",
          SW: "Swahili (SW)",
          TA: "Tamil (TA)",
          TE: "Telugu (TE)",
          TH: "Thai (TH)",
          TL: "Tagalog (TL)",
          TN: "Tswana (TN)",
          TR: "Turkish (TR)",
          TS: "Tsonga (TS)",
          UK: "Ukrainian (UK)",
          UR: "Urdu (UR)",
          VI: "Vietnamese (VI)",
          XH: "Xhosa (XH)",
          YO: "Yoruba (YO)",
          ZH: "Chinese (ZH)",
          ZU: "Zulu (ZU)",
        },
      },
    },
    default: {
      parameters: {
        checkFor: "input_matches_output",
        expectedLanguage: "any",
      },
    },
  },
  custom: {
    name: "Custom",
    description:
      "Build your own guardrails and measurements using heuristics or LLMs-on-LLMs evalution",
    valueDisplayType: "boolean", // TODO: handle custom llm value score
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
