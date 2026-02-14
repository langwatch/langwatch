export type EvaluatorDefinition<T extends EvaluatorTypes> = {
    name: string;
    description: string;
    category: "quality" | "rag" | "safety" | "policy" | "other" | "custom" | "similarity";
    docsUrl?: string;
    isGuardrail: boolean;
    requiredFields: ("input" | "output" | "contexts" | "expected_output" | "expected_contexts" | "conversation")[];
    optionalFields: ("input" | "output" | "contexts" | "expected_output" | "expected_contexts" | "conversation")[];
    settings: {
        [K in keyof Evaluators[T]["settings"]]: {
        description?: string;
        default: Evaluators[T]["settings"][K];
        };
    };
    envVars: string[];
    result: {
        score?: {
        description: string;
        };
        passed?: {
        description: string;
        };
        label?: {
        description: string;
        };
    };
};

export type EvaluatorTypes = keyof Evaluators;

export type EvaluationResult = {
    status: 'processed';
    score?: number | undefined;
    passed?: boolean | undefined;
    label?: string | undefined;
    details?: string | undefined;
    cost?: Money | undefined;
    raw_response?: any;
};

export type EvaluationResultSkipped = {
    status: 'skipped';
    details?: string | undefined;
};

export type EvaluationResultError = {
    status: 'error';
    error_type: string;
    details: string;
    traceback: string[];
};

export type SingleEvaluationResult = EvaluationResult | EvaluationResultSkipped | EvaluationResultError;
export type BatchEvaluationResult = SingleEvaluationResult[];

export type Money = {
    currency: string;
    amount: number;
};

export type Evaluators = {
  "openai/moderation": {
    settings: {
        /**
        * @description The model version to use, `text-moderation-latest` will be automatically upgraded over time, while `text-moderation-stable` will only be updated with advanced notice by OpenAI.
        * @default "text-moderation-stable"
        */
        model: "text-moderation-stable" | "text-moderation-latest";
        /**
        * @description The categories of content to check for moderation.
        * @default {"harassment": true, "harassment_threatening": true, "hate": true, "hate_threatening": true, "self_harm": true, "self_harm_instructions": true, "self_harm_intent": true, "sexual": true, "sexual_minors": true, "violence": true, "violence_graphic": true}
        */
        categories: {
        /**
        * @default true
        */
        harassment: boolean;
        /**
        * @default true
        */
        harassment_threatening: boolean;
        /**
        * @default true
        */
        hate: boolean;
        /**
        * @default true
        */
        hate_threatening: boolean;
        /**
        * @default true
        */
        self_harm: boolean;
        /**
        * @default true
        */
        self_harm_instructions: boolean;
        /**
        * @default true
        */
        self_harm_intent: boolean;
        /**
        * @default true
        */
        sexual: boolean;
        /**
        * @default true
        */
        sexual_minors: boolean;
        /**
        * @default true
        */
        violence: boolean;
        /**
        * @default true
        */
        violence_graphic: boolean;
      };
      };
  };
  "langevals/basic": {
    settings: {
        /**
        * @description List of rules to check, the message must pass all of them
        * @default [{"field": "output", "rule": "not_contains", "value": "artificial intelligence"}]
        */
        rules: {
        /**
        * @default "output"
        */
        field: "input" | "output";
        rule: "contains" | "not_contains" | "matches_regex" | "not_matches_regex";
        value: string;
      }[];
      };
  };
  "langevals/competitor_blocklist": {
    settings: {
        /**
        * @description The competitors that must not be mentioned.
        * @default ["OpenAI", "Google", "Microsoft"]
        */
        competitors: string[];
      };
  };
  "langevals/competitor_llm": {
    settings: {
        /**
        * @description The model to use for evaluation
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description Max tokens allowed for evaluation
        * @default 128000
        */
        max_tokens: number;
        /**
        * @description The name of your company
        * @default "LangWatch"
        */
        name: string;
        /**
        * @description Description of what your company is specializing at
        * @default "We are providing an LLM observability and evaluation platform"
        */
        description: string;
      };
  };
  "langevals/competitor_llm_function_call": {
    settings: {
        /**
        * @description The model to use for evaluation
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description Max tokens allowed for evaluation
        * @default 128000
        */
        max_tokens: number;
        /**
        * @description The name of your company
        * @default "LangWatch"
        */
        name: string;
        /**
        * @description Description of what your company is specializing at
        * @default "We are providing an LLM observability and evaluation platform"
        */
        description: string;
        /**
        * @description The competitors that must not be mentioned.
        * @default ["OpenAI", "Google", "Microsoft"]
        */
        competitors: string[];
      };
  };
  "langevals/exact_match": {
    settings: {
        /**
        * @description True if the comparison should be case-sensitive, False otherwise
        * @default false
        */
        case_sensitive: boolean;
        /**
        * @description True if the comparison should trim whitespace, False otherwise
        * @default true
        */
        trim_whitespace: boolean;
        /**
        * @description True if the comparison should remove punctuation, False otherwise
        * @default true
        */
        remove_punctuation: boolean;
      };
  };
  "langevals/llm_answer_match": {
    settings: {
        /**
        * @description The model to use for evaluation
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description Max tokens allowed for evaluation
        * @default 128000
        */
        max_tokens: number;
        /**
        * @description Prompt for the comparison
        * @default "Verify that the predicted answer matches the gold answer for the question. Style does not matter, for example the gold answer may be more direct while the predicted answer more verbose and still be correct."
        */
        prompt: string;
      };
  };
  "langevals/llm_boolean": {
    settings: {
        /**
        * @description The model to use for evaluation
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description Max tokens allowed for evaluation
        * @default 128000
        */
        max_tokens: number;
        /**
        * @description The system prompt to use for the LLM to run the evaluation
        * @default "You are an LLM evaluator. We need the guarantee that the output answers what is being asked on the input, please evaluate as False if it doesn't"
        */
        prompt: string;
      };
  };
  "langevals/llm_category": {
    settings: {
        /**
        * @description The model to use for evaluation
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description Max tokens allowed for evaluation
        * @default 128000
        */
        max_tokens: number;
        /**
        * @description The system prompt to use for the LLM to run the evaluation
        * @default "You are an LLM category evaluator. Please categorize the message in one of the following categories"
        */
        prompt: string;
        /**
        * @description The categories to use for the evaluation
        * @default [{"name": "smalltalk", "description": "Smalltalk with the user"}, {"name": "company", "description": "Questions about the company, what we do, etc"}]
        */
        categories: {
        name: string;
        description: string;
      }[];
      };
  };
  "langevals/llm_score": {
    settings: {
        /**
        * @description The model to use for evaluation
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description Max tokens allowed for evaluation
        * @default 128000
        */
        max_tokens: number;
        /**
        * @description The system prompt to use for the LLM to run the evaluation
        * @default "You are an LLM evaluator. Please score from 0.0 to 1.0 how likely the user is to be satisfied with this answer, from 0.0 being not satisfied at all to 1.0 being completely satisfied"
        */
        prompt: string;
      };
  };
  "langevals/off_topic": {
    settings: {
        /**
        * @description The model to use for evaluation
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description Max tokens allowed for evaluation
        * @default 128000
        */
        max_tokens: number;
        /**
        * @description The list of topics and their short descriptions that the chatbot is allowed to talk about
        * @default [{"topic": "simple_chat", "description": "Smalltalk with the user"}, {"topic": "company", "description": "Questions about the company, what we do, etc"}]
        */
        allowed_topics: {
        topic: string;
        description: string;
      }[];
      };
  };
  "langevals/query_resolution": {
    settings: {
        /**
        * @description The model to use for evaluation
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description Max tokens allowed for evaluation
        * @default 128000
        */
        max_tokens: number;
      };
  };
  "langevals/similarity": {
    settings: {
        /**
        * @default "output"
        */
        field: "input" | "output";
        /**
        * @default "is_not_similar_to"
        */
        rule: "is_not_similar_to" | "is_similar_to";
        /**
        * @default "example"
        */
        value: string;
        /**
        * @default 0.3
        */
        threshold: number;
        /**
        * @default "openai/text-embedding-3-small"
        */
        embeddings_model: string;
      };
  };
  "langevals/valid_format": {
    settings: {
        /**
        * @default "json"
        */
        format: "json" | "markdown" | "python" | "sql";
        /**
        * @description JSON schema to validate against when format is 'json'
        */
        json_schema?: string;
      };
  };
  "ragas/bleu_score": {
    settings: Record<string, never>;
  };
  "ragas/context_f1": {
    settings: {
        /**
        * @default "levenshtein"
        */
        distance_measure: "levenshtein" | "hamming" | "jaro" | "jaro_winkler";
      };
  };
  "ragas/context_precision": {
    settings: {
        /**
        * @default "levenshtein"
        */
        distance_measure: "levenshtein" | "hamming" | "jaro" | "jaro_winkler";
      };
  };
  "ragas/context_recall": {
    settings: {
        /**
        * @default "levenshtein"
        */
        distance_measure: "levenshtein" | "hamming" | "jaro" | "jaro_winkler";
      };
  };
  "ragas/factual_correctness": {
    settings: {
        /**
        * @description The model to use for evaluation.
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.
        * @default 2048
        */
        max_tokens: number;
        /**
        * @description The mode to use for the factual correctness metric.
        * @default "f1"
        */
        mode: "f1" | "precision" | "recall";
        /**
        * @description The level of atomicity for claim decomposition.
        * @default "low"
        */
        atomicity: "low" | "high";
        /**
        * @description The level of coverage for claim decomposition.
        * @default "low"
        */
        coverage: "low" | "high";
      };
  };
  "ragas/faithfulness": {
    settings: {
        /**
        * @description The model to use for evaluation.
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.
        * @default 2048
        */
        max_tokens: number;
        /**
        * @description Whether to autodetect 'I don't know' in the output to avoid failing the evaluation.
        * @default true
        */
        autodetect_dont_know: boolean;
      };
  };
  "ragas/response_context_precision": {
    settings: {
        /**
        * @description The model to use for evaluation.
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.
        * @default 2048
        */
        max_tokens: number;
      };
  };
  "ragas/response_context_recall": {
    settings: {
        /**
        * @description The model to use for evaluation.
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.
        * @default 2048
        */
        max_tokens: number;
      };
  };
  "ragas/response_relevancy": {
    settings: {
        /**
        * @description The model to use for evaluation.
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.
        * @default 2048
        */
        max_tokens: number;
        /**
        * @description The model to use for embeddings.
        * @default "openai/text-embedding-ada-002"
        */
        embeddings_model: string;
      };
  };
  "ragas/rouge_score": {
    settings: {
        /**
        * @description ROUGE type
        * @default "rouge1"
        */
        rouge_type: "rouge1" | "rougeL";
        /**
        * @description ROUGE measure type
        * @default "fmeasure"
        */
        measure_type: "fmeasure" | "precision" | "recall";
      };
  };
  "ragas/rubrics_based_scoring": {
    settings: {
        /**
        * @description The model to use for evaluation.
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.
        * @default 2048
        */
        max_tokens: number;
        /**
        * @default [{"description": "The response is incorrect, irrelevant."}, {"description": "The response partially answers the question but includes significant errors, omissions, or irrelevant information."}, {"description": "The response partially answers the question but includes minor errors, omissions, or irrelevant information."}, {"description": "The response fully answers the question and includes minor errors, omissions, or irrelevant information."}, {"description": "The response fully answers the question and includes no errors, omissions, or irrelevant information."}]
        */
        rubrics: {
        description: string;
      }[];
      };
  };
  "ragas/sql_query_equivalence": {
    settings: {
        /**
        * @description The model to use for evaluation.
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.
        * @default 2048
        */
        max_tokens: number;
      };
  };
  "ragas/summarization_score": {
    settings: {
        /**
        * @description The model to use for evaluation.
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.
        * @default 2048
        */
        max_tokens: number;
      };
  };
  "lingua/language_detection": {
    settings: {
        /**
        * @description What should be checked
        * @default "input_matches_output"
        */
        check_for: "input_matches_output" | "output_matches_language";
        /**
        * @description The specific language that the output is expected to be
        */
        expected_language?: "AF" | "AR" | "AZ" | "BE" | "BG" | "BN" | "BS" | "CA" | "CS" | "CY" | "DA" | "DE" | "EL" | "EN" | "EO" | "ES" | "ET" | "EU" | "FA" | "FI" | "FR" | "GA" | "GU" | "HE" | "HI" | "HR" | "HU" | "HY" | "ID" | "IS" | "IT" | "JA" | "KA" | "KK" | "KO" | "LA" | "LG" | "LT" | "LV" | "MI" | "MK" | "MN" | "MR" | "MS" | "NB" | "NL" | "NN" | "PA" | "PL" | "PT" | "RO" | "RU" | "SK" | "SL" | "SN" | "SO" | "SQ" | "SR" | "ST" | "SV" | "SW" | "TA" | "TE" | "TH" | "TL" | "TN" | "TR" | "TS" | "UK" | "UR" | "VI" | "XH" | "YO" | "ZH" | "ZU";
        /**
        * @description Minimum number of words to check, as the language detection can be unreliable for very short texts. Inputs shorter than the minimum will be skipped.
        * @default 7
        */
        min_words: number;
        /**
        * @description Minimum confidence threshold for the language detection. If the confidence is lower than this, the evaluation will be skipped.
        * @default 0.25
        */
        threshold: number;
      };
  };
  "legacy/ragas_answer_correctness": {
    settings: {
        /**
        * @description The model to use for evaluation.
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description The model to use for embeddings.
        * @default "openai/text-embedding-ada-002"
        */
        embeddings_model: string;
        /**
        * @description The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.
        * @default 2048
        */
        max_tokens: number;
      };
  };
  "legacy/ragas_answer_relevancy": {
    settings: {
        /**
        * @description The model to use for evaluation.
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description The model to use for embeddings.
        * @default "openai/text-embedding-ada-002"
        */
        embeddings_model: string;
        /**
        * @description The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.
        * @default 2048
        */
        max_tokens: number;
      };
  };
  "legacy/ragas_context_precision": {
    settings: {
        /**
        * @description The model to use for evaluation.
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description The model to use for embeddings.
        * @default "openai/text-embedding-ada-002"
        */
        embeddings_model: string;
        /**
        * @description The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.
        * @default 2048
        */
        max_tokens: number;
      };
  };
  "legacy/ragas_context_recall": {
    settings: {
        /**
        * @description The model to use for evaluation.
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description The model to use for embeddings.
        * @default "openai/text-embedding-ada-002"
        */
        embeddings_model: string;
        /**
        * @description The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.
        * @default 2048
        */
        max_tokens: number;
      };
  };
  "legacy/ragas_context_relevancy": {
    settings: {
        /**
        * @description The model to use for evaluation.
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description The model to use for embeddings.
        * @default "openai/text-embedding-ada-002"
        */
        embeddings_model: string;
        /**
        * @description The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.
        * @default 2048
        */
        max_tokens: number;
      };
  };
  "legacy/ragas_context_utilization": {
    settings: {
        /**
        * @description The model to use for evaluation.
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description The model to use for embeddings.
        * @default "openai/text-embedding-ada-002"
        */
        embeddings_model: string;
        /**
        * @description The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.
        * @default 2048
        */
        max_tokens: number;
      };
  };
  "legacy/ragas_faithfulness": {
    settings: {
        /**
        * @description The model to use for evaluation.
        * @default "openai/gpt-5"
        */
        model: string;
        /**
        * @description The model to use for embeddings.
        * @default "openai/text-embedding-ada-002"
        */
        embeddings_model: string;
        /**
        * @description The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.
        * @default 2048
        */
        max_tokens: number;
      };
  };
  "azure/content_safety": {
    settings: {
        /**
        * @description The minimum severity level to consider content as unsafe, from 1 to 7.
        * @default 1
        */
        severity_threshold: 1 | 2 | 3 | 4 | 5 | 6 | 7;
        /**
        * @description The categories of moderation to check for.
        * @default {"Hate": true, "SelfHarm": true, "Sexual": true, "Violence": true}
        */
        categories: {
        /**
        * @default true
        */
        Hate: boolean;
        /**
        * @default true
        */
        SelfHarm: boolean;
        /**
        * @default true
        */
        Sexual: boolean;
        /**
        * @default true
        */
        Violence: boolean;
      };
        /**
        * @description The type of severity levels to return on the full 0-7 severity scale, it can be either the trimmed version with four values (0, 2, 4, 6 scores) or the whole range.
        * @default "FourSeverityLevels"
        */
        output_type: "FourSeverityLevels" | "EightSeverityLevels";
      };
  };
  "azure/jailbreak": {
    settings: Record<string, never>;
  };
  "azure/prompt_injection": {
    settings: Record<string, never>;
  };
  "presidio/pii_detection": {
    settings: {
        /**
        * @description The types of PII to check for in the input.
        * @default {"credit_card": true, "crypto": true, "email_address": true, "iban_code": true, "ip_address": true, "location": false, "person": false, "phone_number": true, "medical_license": true, "us_bank_number": false, "us_driver_license": false, "us_itin": false, "us_passport": false, "us_ssn": false, "uk_nhs": false, "sg_nric_fin": false, "au_abn": false, "au_acn": false, "au_tfn": false, "au_medicare": false, "in_pan": false, "in_aadhaar": false, "in_vehicle_registration": false, "in_voter": false, "in_passport": false}
        */
        entities: {
        /**
        * @default true
        */
        credit_card: boolean;
        /**
        * @default true
        */
        crypto: boolean;
        /**
        * @default true
        */
        email_address: boolean;
        /**
        * @default true
        */
        iban_code: boolean;
        /**
        * @default true
        */
        ip_address: boolean;
        /**
        * @default false
        */
        location: boolean;
        /**
        * @default false
        */
        person: boolean;
        /**
        * @default true
        */
        phone_number: boolean;
        /**
        * @default true
        */
        medical_license: boolean;
        /**
        * @default false
        */
        us_bank_number: boolean;
        /**
        * @default false
        */
        us_driver_license: boolean;
        /**
        * @default false
        */
        us_itin: boolean;
        /**
        * @default false
        */
        us_passport: boolean;
        /**
        * @default false
        */
        us_ssn: boolean;
        /**
        * @default false
        */
        uk_nhs: boolean;
        /**
        * @default false
        */
        sg_nric_fin: boolean;
        /**
        * @default false
        */
        au_abn: boolean;
        /**
        * @default false
        */
        au_acn: boolean;
        /**
        * @default false
        */
        au_tfn: boolean;
        /**
        * @default false
        */
        au_medicare: boolean;
        /**
        * @default false
        */
        in_pan: boolean;
        /**
        * @default false
        */
        in_aadhaar: boolean;
        /**
        * @default false
        */
        in_vehicle_registration: boolean;
        /**
        * @default false
        */
        in_voter: boolean;
        /**
        * @default false
        */
        in_passport: boolean;
      };
        /**
        * @description The minimum confidence required for failing the evaluation on a PII match.
        * @default 0.5
        */
        min_threshold: number;
      };
  };
};

export const AVAILABLE_EVALUATORS: {
  [K in EvaluatorTypes]: EvaluatorDefinition<K>;
} = {
  "openai/moderation": {
    name: `OpenAI Moderation`,
    description: `
This evaluator uses OpenAI's moderation API to detect potentially harmful content in text,
including harassment, hate speech, self-harm, sexual content, and violence.
`,
    category: "safety",
    docsUrl: "https://platform.openai.com/docs/guides/moderation/overview",
    isGuardrail: true,
    requiredFields: [],
    optionalFields: ["input", "output"],
    settings: {
      "model": {
            "description": "The model version to use, `text-moderation-latest` will be automatically upgraded over time, while `text-moderation-stable` will only be updated with advanced notice by OpenAI.",
            "default": "text-moderation-stable"
      },
      "categories": {
            "description": "The categories of content to check for moderation.",
            "default": {
                  "harassment": true,
                  "harassment_threatening": true,
                  "hate": true,
                  "hate_threatening": true,
                  "self_harm": true,
                  "self_harm_instructions": true,
                  "self_harm_intent": true,
                  "sexual": true,
                  "sexual_minors": true,
                  "violence": true,
                  "violence_graphic": true
            }
      }
},
    envVars: ["OPENAI_API_KEY"],
    result: {
      "score": {
            "description": "The model's confidence on primary category where the input violates the OpenAI's policy. The value is between 0 and 1, where higher values denote higher confidence."
      },
      "passed": {
            "description": "Fails if any moderation category is flagged"
      }
}
  },
  "langevals/basic": {
    name: `Custom Basic Evaluator`,
    description: `
Allows you to check for simple text matches or regex evaluation.
`,
    category: "custom",
    docsUrl: "",
    isGuardrail: true,
    requiredFields: [],
    optionalFields: ["input", "output"],
    settings: {
      "rules": {
            "description": "List of rules to check, the message must pass all of them",
            "default": [
                  {
                        "field": "output",
                        "rule": "not_contains",
                        "value": "artificial intelligence"
                  }
            ]
      }
},
    envVars: [],
    result: {
      "passed": {
            "description": "True if all rules pass, False if any rule fails"
      }
}
  },
  "langevals/competitor_blocklist": {
    name: `Competitor Blocklist`,
    description: `
This evaluator checks if any of the specified competitors was mentioned
`,
    category: "policy",
    docsUrl: "https://path/to/official/docs",
    isGuardrail: true,
    requiredFields: [],
    optionalFields: ["output", "input"],
    settings: {
      "competitors": {
            "description": "The competitors that must not be mentioned.",
            "default": [
                  "OpenAI",
                  "Google",
                  "Microsoft"
            ]
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "Number of competitors mentioned in the input and output"
      },
      "passed": {
            "description": "Is the message containing explicit mention of competitor"
      }
}
  },
  "langevals/competitor_llm": {
    name: `Competitor Allowlist Check`,
    description: `
This evaluator use an LLM-as-judge to check if the conversation is related to competitors, without having to name them explicitly
`,
    category: "policy",
    docsUrl: "",
    isGuardrail: true,
    requiredFields: [],
    optionalFields: ["output", "input"],
    settings: {
      "model": {
            "description": "The model to use for evaluation",
            "default": "openai/gpt-5"
      },
      "max_tokens": {
            "description": "Max tokens allowed for evaluation",
            "default": 128000
      },
      "name": {
            "description": "The name of your company",
            "default": "LangWatch"
      },
      "description": {
            "description": "Description of what your company is specializing at",
            "default": "We are providing an LLM observability and evaluation platform"
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "Confidence that the message is competitor free"
      },
      "passed": {
            "description": "Is the message related to the competitors"
      }
}
  },
  "langevals/competitor_llm_function_call": {
    name: `Competitor LLM Check`,
    description: `
This evaluator implements LLM-as-a-judge with a function call approach to check if the message contains a mention of a competitor.
`,
    category: "policy",
    docsUrl: "",
    isGuardrail: true,
    requiredFields: [],
    optionalFields: ["output", "input"],
    settings: {
      "model": {
            "description": "The model to use for evaluation",
            "default": "openai/gpt-5"
      },
      "max_tokens": {
            "description": "Max tokens allowed for evaluation",
            "default": 128000
      },
      "name": {
            "description": "The name of your company",
            "default": "LangWatch"
      },
      "description": {
            "description": "Description of what your company is specializing at",
            "default": "We are providing an LLM observability and evaluation platform"
      },
      "competitors": {
            "description": "The competitors that must not be mentioned.",
            "default": [
                  "OpenAI",
                  "Google",
                  "Microsoft"
            ]
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "Number of unique competitors mentioned"
      },
      "passed": {
            "description": "Is the message related to the competitors"
      }
}
  },
  "langevals/exact_match": {
    name: `Exact Match Evaluator`,
    description: `
A simple evaluator that checks if the output matches the expected_output exactly.
`,
    category: "quality",
    docsUrl: "",
    isGuardrail: false,
    requiredFields: ["output", "expected_output"],
    optionalFields: [],
    settings: {
      "case_sensitive": {
            "description": "True if the comparison should be case-sensitive, False otherwise",
            "default": false
      },
      "trim_whitespace": {
            "description": "True if the comparison should trim whitespace, False otherwise",
            "default": true
      },
      "remove_punctuation": {
            "description": "True if the comparison should remove punctuation, False otherwise",
            "default": true
      }
},
    envVars: [],
    result: {
      "passed": {
            "description": "True if the output matched the expected_output exactly, False otherwise"
      }
}
  },
  "langevals/llm_answer_match": {
    name: `LLM Answer Match`,
    description: `
Uses an LLM to check if the generated output answers a question correctly the same way as the expected output, even if their style is different.
`,
    category: "quality",
    docsUrl: "",
    isGuardrail: false,
    requiredFields: ["output", "expected_output"],
    optionalFields: ["input"],
    settings: {
      "model": {
            "description": "The model to use for evaluation",
            "default": "openai/gpt-5"
      },
      "max_tokens": {
            "description": "Max tokens allowed for evaluation",
            "default": 128000
      },
      "prompt": {
            "description": "Prompt for the comparison",
            "default": "Verify that the predicted answer matches the gold answer for the question. Style does not matter, for example the gold answer may be more direct while the predicted answer more verbose and still be correct."
      }
},
    envVars: [],
    result: {
      "passed": {
            "description": "Whether the predicted answer matches the gold answer"
      }
}
  },
  "langevals/llm_boolean": {
    name: `LLM-as-a-Judge Boolean Evaluator`,
    description: `
Use an LLM as a judge with a custom prompt to do a true/false boolean evaluation of the message.
`,
    category: "custom",
    docsUrl: "",
    isGuardrail: true,
    requiredFields: [],
    optionalFields: ["input", "output", "contexts"],
    settings: {
      "model": {
            "description": "The model to use for evaluation",
            "default": "openai/gpt-5"
      },
      "max_tokens": {
            "description": "Max tokens allowed for evaluation",
            "default": 128000
      },
      "prompt": {
            "description": "The system prompt to use for the LLM to run the evaluation",
            "default": "You are an LLM evaluator. We need the guarantee that the output answers what is being asked on the input, please evaluate as False if it doesn't"
      }
},
    envVars: [],
    result: {
      "passed": {
            "description": "The veredict given by the LLM"
      }
}
  },
  "langevals/llm_category": {
    name: `LLM-as-a-Judge Category Evaluator`,
    description: `
Use an LLM as a judge with a custom prompt to classify the message into custom defined categories.
`,
    category: "custom",
    docsUrl: "",
    isGuardrail: false,
    requiredFields: [],
    optionalFields: ["input", "output", "contexts"],
    settings: {
      "model": {
            "description": "The model to use for evaluation",
            "default": "openai/gpt-5"
      },
      "max_tokens": {
            "description": "Max tokens allowed for evaluation",
            "default": 128000
      },
      "prompt": {
            "description": "The system prompt to use for the LLM to run the evaluation",
            "default": "You are an LLM category evaluator. Please categorize the message in one of the following categories"
      },
      "categories": {
            "description": "The categories to use for the evaluation",
            "default": [
                  {
                        "name": "smalltalk",
                        "description": "Smalltalk with the user"
                  },
                  {
                        "name": "company",
                        "description": "Questions about the company, what we do, etc"
                  }
            ]
      }
},
    envVars: [],
    result: {
      "label": {
            "description": "The detected category of the message"
      }
}
  },
  "langevals/llm_score": {
    name: `LLM-as-a-Judge Score Evaluator`,
    description: `
Use an LLM as a judge with custom prompt to do a numeric score evaluation of the message.
`,
    category: "custom",
    docsUrl: "",
    isGuardrail: false,
    requiredFields: [],
    optionalFields: ["input", "output", "contexts"],
    settings: {
      "model": {
            "description": "The model to use for evaluation",
            "default": "openai/gpt-5"
      },
      "max_tokens": {
            "description": "Max tokens allowed for evaluation",
            "default": 128000
      },
      "prompt": {
            "description": "The system prompt to use for the LLM to run the evaluation",
            "default": "You are an LLM evaluator. Please score from 0.0 to 1.0 how likely the user is to be satisfied with this answer, from 0.0 being not satisfied at all to 1.0 being completely satisfied"
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "The score given by the LLM, according to the prompt"
      }
}
  },
  "langevals/off_topic": {
    name: `Off Topic Evaluator`,
    description: `
This evaluator checks if the user message is concerning one of the allowed topics of the chatbot
`,
    category: "policy",
    docsUrl: "",
    isGuardrail: true,
    requiredFields: ["input"],
    optionalFields: [],
    settings: {
      "model": {
            "description": "The model to use for evaluation",
            "default": "openai/gpt-5"
      },
      "max_tokens": {
            "description": "Max tokens allowed for evaluation",
            "default": 128000
      },
      "allowed_topics": {
            "description": "The list of topics and their short descriptions that the chatbot is allowed to talk about",
            "default": [
                  {
                        "topic": "simple_chat",
                        "description": "Smalltalk with the user"
                  },
                  {
                        "topic": "company",
                        "description": "Questions about the company, what we do, etc"
                  }
            ]
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "Confidence level of the intent prediction"
      },
      "passed": {
            "description": "Is the message concerning allowed topic"
      },
      "label": {
            "description": "The detected intent or 'other' if the intent is not in the allowed topics"
      }
}
  },
  "langevals/query_resolution": {
    name: `Query Resolution`,
    description: `
This evaluator checks if all the user queries in the conversation were resolved. Useful to detect when the bot doesn't know how to answer or can't help the user.
`,
    category: "quality",
    docsUrl: "",
    isGuardrail: false,
    requiredFields: ["conversation"],
    optionalFields: [],
    settings: {
      "model": {
            "description": "The model to use for evaluation",
            "default": "openai/gpt-5"
      },
      "max_tokens": {
            "description": "Max tokens allowed for evaluation",
            "default": 128000
      }
},
    envVars: [],
    result: {}
  },
  "langevals/similarity": {
    name: `Semantic Similarity Evaluator`,
    description: `
Allows you to check for semantic similarity or dissimilarity between input and output and a
target value, so you can avoid sentences that you don't want to be present without having to
match on the exact text.
`,
    category: "custom",
    docsUrl: "",
    isGuardrail: true,
    requiredFields: [],
    optionalFields: ["input", "output"],
    settings: {
      "field": {
            "description": undefined,
            "default": "output"
      },
      "rule": {
            "description": undefined,
            "default": "is_not_similar_to"
      },
      "value": {
            "description": undefined,
            "default": "example"
      },
      "threshold": {
            "description": undefined,
            "default": 0.3
      },
      "embeddings_model": {
            "description": undefined,
            "default": "openai/text-embedding-3-small"
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "How similar the input and output semantically, from 0.0 to 1.0, with 1.0 meaning the sentences are identical"
      },
      "passed": {
            "description": "Passes if the cosine similarity crosses the threshold for the defined rule"
      }
}
  },
  "langevals/valid_format": {
    name: `Valid Format Evaluator`,
    description: `
Allows you to check if the output is a valid json, markdown, python, sql, etc.
For JSON, can optionally validate against a provided schema.
`,
    category: "quality",
    docsUrl: "",
    isGuardrail: true,
    requiredFields: [],
    optionalFields: ["output"],
    settings: {
      "format": {
            "description": undefined,
            "default": "json"
      },
      "json_schema": {
            "description": "JSON schema to validate against when format is 'json'",
            "default": undefined
      }
},
    envVars: [],
    result: {
      "passed": {
            "description": "True if the output is formatted correctly, False otherwise"
      }
}
  },
  "ragas/bleu_score": {
    name: `BLEU Score`,
    description: `
Traditional NLP metric. BLEU score for evaluating the similarity between two strings.
`,
    category: "quality",
    docsUrl: "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/traditional/#bleu-score",
    isGuardrail: false,
    requiredFields: ["output", "expected_output"],
    optionalFields: [],
    settings: {},
    envVars: [],
    result: {
      "score": {
            "description": "BLEU similarity score"
      }
}
  },
  "ragas/context_f1": {
    name: `Context F1`,
    description: `
Balances between precision and recall for context retrieval, increasing it means a better signal-to-noise ratio. Uses traditional string distance metrics.
`,
    category: "rag",
    docsUrl: "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_F1/#non-llm-based-context-F1",
    isGuardrail: false,
    requiredFields: ["contexts", "expected_contexts"],
    optionalFields: [],
    settings: {
      "distance_measure": {
            "description": undefined,
            "default": "levenshtein"
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "A score between 0.0 and 1.0 indicating the F1 score."
      }
}
  },
  "ragas/context_precision": {
    name: `Context Precision`,
    description: `
Measures how accurate is the retrieval compared to expected contexts, increasing it means less noise in the retrieval. Uses traditional string distance metrics.
`,
    category: "rag",
    docsUrl: "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/#non-llm-based-context-precision",
    isGuardrail: false,
    requiredFields: ["contexts", "expected_contexts"],
    optionalFields: [],
    settings: {
      "distance_measure": {
            "description": undefined,
            "default": "levenshtein"
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "A score between 0.0 and 1.0 indicating the precision score."
      }
}
  },
  "ragas/context_recall": {
    name: `Context Recall`,
    description: `
Measures how many relevant contexts were retrieved compared to expected contexts, increasing it means more signal in the retrieval. Uses traditional string distance metrics.
`,
    category: "rag",
    docsUrl: "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_recall/#non-llm-based-context-recall",
    isGuardrail: false,
    requiredFields: ["contexts", "expected_contexts"],
    optionalFields: [],
    settings: {
      "distance_measure": {
            "description": undefined,
            "default": "levenshtein"
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "A score between 0.0 and 1.0 indicating the Recall score."
      }
}
  },
  "ragas/factual_correctness": {
    name: `LLM Factual Match`,
    description: `
Computes with an LLM how factually similar the generated answer is to the expected output.
`,
    category: "quality",
    docsUrl: "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/factual_correctness/",
    isGuardrail: false,
    requiredFields: ["output", "expected_output"],
    optionalFields: [],
    settings: {
      "model": {
            "description": "The model to use for evaluation.",
            "default": "openai/gpt-5"
      },
      "max_tokens": {
            "description": "The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.",
            "default": 2048
      },
      "mode": {
            "description": "The mode to use for the factual correctness metric.",
            "default": "f1"
      },
      "atomicity": {
            "description": "The level of atomicity for claim decomposition.",
            "default": "low"
      },
      "coverage": {
            "description": "The level of coverage for claim decomposition.",
            "default": "low"
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "A score between 0.0 and 1.0 indicating how factually similar the generated answer is to the expected output."
      }
}
  },
  "ragas/faithfulness": {
    name: `Ragas Faithfulness`,
    description: `
This evaluator assesses the extent to which the generated answer is consistent with the provided context. Higher scores indicate better faithfulness to the context, useful for detecting hallucinations.
`,
    category: "rag",
    docsUrl: "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/",
    isGuardrail: false,
    requiredFields: ["output", "contexts"],
    optionalFields: ["input"],
    settings: {
      "model": {
            "description": "The model to use for evaluation.",
            "default": "openai/gpt-5"
      },
      "max_tokens": {
            "description": "The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.",
            "default": 2048
      },
      "autodetect_dont_know": {
            "description": "Whether to autodetect 'I don't know' in the output to avoid failing the evaluation.",
            "default": true
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "A score between 0.0 and 1.0 indicating the faithfulness of the answer."
      }
}
  },
  "ragas/response_context_precision": {
    name: `Ragas Response Context Precision`,
    description: `
Uses an LLM to measure the proportion of chunks in the retrieved context that were relevant to generate the output or the expected output.
`,
    category: "rag",
    docsUrl: "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_precision/#context-precision-without-reference",
    isGuardrail: false,
    requiredFields: ["input", "contexts"],
    optionalFields: ["output", "expected_output"],
    settings: {
      "model": {
            "description": "The model to use for evaluation.",
            "default": "openai/gpt-5"
      },
      "max_tokens": {
            "description": "The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.",
            "default": 2048
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "A score between 0.0 and 1.0 indicating the precision of the retrieved context."
      }
}
  },
  "ragas/response_context_recall": {
    name: `Ragas Response Context Recall`,
    description: `
Uses an LLM to measure how many of relevant documents attributable the claims in the output were successfully retrieved in order to generate an expected output.
`,
    category: "rag",
    docsUrl: "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/context_recall/#llm-based-context-recall",
    isGuardrail: false,
    requiredFields: ["input", "output", "contexts", "expected_output"],
    optionalFields: [],
    settings: {
      "model": {
            "description": "The model to use for evaluation.",
            "default": "openai/gpt-5"
      },
      "max_tokens": {
            "description": "The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.",
            "default": 2048
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "A score between 0.0 and 1.0 indicating the recall of the retrieved context."
      }
}
  },
  "ragas/response_relevancy": {
    name: `Ragas Response Relevancy`,
    description: `
Evaluates how pertinent the generated answer is to the given prompt. Higher scores indicate better relevancy.
`,
    category: "quality",
    docsUrl: "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/answer_relevance/",
    isGuardrail: false,
    requiredFields: ["input", "output"],
    optionalFields: [],
    settings: {
      "model": {
            "description": "The model to use for evaluation.",
            "default": "openai/gpt-5"
      },
      "max_tokens": {
            "description": "The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.",
            "default": 2048
      },
      "embeddings_model": {
            "description": "The model to use for embeddings.",
            "default": "openai/text-embedding-ada-002"
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "A score between 0.0 and 1.0 indicating the relevance of the answer."
      }
}
  },
  "ragas/rouge_score": {
    name: `ROUGE Score`,
    description: `
Traditional NLP metric. ROUGE score for evaluating the similarity between two strings.
`,
    category: "quality",
    docsUrl: "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/traditional/#rouge-score",
    isGuardrail: false,
    requiredFields: ["output", "expected_output"],
    optionalFields: [],
    settings: {
      "rouge_type": {
            "description": "ROUGE type",
            "default": "rouge1"
      },
      "measure_type": {
            "description": "ROUGE measure type",
            "default": "fmeasure"
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "ROUGE similarity score"
      }
}
  },
  "ragas/rubrics_based_scoring": {
    name: `Rubrics Based Scoring`,
    description: `
Rubric-based evaluation metric that is used to evaluate responses. The rubric consists of descriptions for each score, typically ranging from 1 to 5
`,
    category: "quality",
    docsUrl: "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/general_purpose/#rubrics-based-criteria-scoring",
    isGuardrail: false,
    requiredFields: ["input", "output"],
    optionalFields: ["expected_output"],
    settings: {
      "model": {
            "description": "The model to use for evaluation.",
            "default": "openai/gpt-5"
      },
      "max_tokens": {
            "description": "The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.",
            "default": 2048
      },
      "rubrics": {
            "description": undefined,
            "default": [
                  {
                        "description": "The response is incorrect, irrelevant."
                  },
                  {
                        "description": "The response partially answers the question but includes significant errors, omissions, or irrelevant information."
                  },
                  {
                        "description": "The response partially answers the question but includes minor errors, omissions, or irrelevant information."
                  },
                  {
                        "description": "The response fully answers the question and includes minor errors, omissions, or irrelevant information."
                  },
                  {
                        "description": "The response fully answers the question and includes no errors, omissions, or irrelevant information."
                  }
            ]
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "A score according to the rubrics, typically between 1 and 5."
      }
}
  },
  "ragas/sql_query_equivalence": {
    name: `SQL Query Equivalence`,
    description: `
Checks if the SQL query is equivalent to a reference one by using an LLM to infer if it would generate the same results given the table schemas.
`,
    category: "quality",
    docsUrl: "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/sql/#sql-query-semantic-equivalence",
    isGuardrail: false,
    requiredFields: ["output", "expected_output", "expected_contexts"],
    optionalFields: [],
    settings: {
      "model": {
            "description": "The model to use for evaluation.",
            "default": "openai/gpt-5"
      },
      "max_tokens": {
            "description": "The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.",
            "default": 2048
      }
},
    envVars: [],
    result: {
      "passed": {
            "description": "Whether the SQL query is equivalent to the expected one."
      }
}
  },
  "ragas/summarization_score": {
    name: `Summarization Score`,
    description: `
Measures how well the summary captures important information from the retrieved contexts.
`,
    category: "quality",
    docsUrl: "https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/summarization_score/",
    isGuardrail: false,
    requiredFields: ["output", "contexts"],
    optionalFields: [],
    settings: {
      "model": {
            "description": "The model to use for evaluation.",
            "default": "openai/gpt-5"
      },
      "max_tokens": {
            "description": "The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.",
            "default": 2048
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "A score between 0.0 and 1.0 indicating the summarization quality."
      }
}
  },
  "lingua/language_detection": {
    name: `Lingua Language Detection`,
    description: `
This evaluator detects the language of the input and output text to check for example if the generated answer is in the same language as the prompt,
or if it's in a specific expected language.
`,
    category: "quality",
    docsUrl: "https://github.com/pemistahl/lingua-py",
    isGuardrail: true,
    requiredFields: ["output"],
    optionalFields: ["input"],
    settings: {
      "check_for": {
            "description": "What should be checked",
            "default": "input_matches_output"
      },
      "expected_language": {
            "description": "The specific language that the output is expected to be",
            "default": undefined
      },
      "min_words": {
            "description": "Minimum number of words to check, as the language detection can be unreliable for very short texts. Inputs shorter than the minimum will be skipped.",
            "default": 7
      },
      "threshold": {
            "description": "Minimum confidence threshold for the language detection. If the confidence is lower than this, the evaluation will be skipped.",
            "default": 0.25
      }
},
    envVars: [],
    result: {
      "passed": {
            "description": "Passes if the detected language on the output matches the detected language on the input, or if the output matches the expected language"
      },
      "label": {
            "description": "Language detected on the input for input_matches_output, or language detected on the output for output_matches_language"
      }
}
  },
  "legacy/ragas_answer_correctness": {
    name: `Ragas Answer Correctness`,
    description: `
Computes with an LLM a weighted combination of factual as well as semantic similarity between the generated answer and the expected output.
`,
    category: "rag",
    docsUrl: "https://docs.ragas.io/en/latest/concepts/metrics/answer_correctness.html",
    isGuardrail: false,
    requiredFields: ["output", "expected_output"],
    optionalFields: ["input"],
    settings: {
      "model": {
            "description": "The model to use for evaluation.",
            "default": "openai/gpt-5"
      },
      "embeddings_model": {
            "description": "The model to use for embeddings.",
            "default": "openai/text-embedding-ada-002"
      },
      "max_tokens": {
            "description": "The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.",
            "default": 2048
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "A score between 0.0 and 1.0 indicating the correctness of the answer."
      }
}
  },
  "legacy/ragas_answer_relevancy": {
    name: `Ragas Answer Relevancy`,
    description: `
Evaluates how pertinent the generated answer is to the given prompt. Higher scores indicate better relevancy.
`,
    category: "rag",
    docsUrl: "https://docs.ragas.io/en/latest/concepts/metrics/answer_relevance.html",
    isGuardrail: false,
    requiredFields: ["input", "output"],
    optionalFields: [],
    settings: {
      "model": {
            "description": "The model to use for evaluation.",
            "default": "openai/gpt-5"
      },
      "embeddings_model": {
            "description": "The model to use for embeddings.",
            "default": "openai/text-embedding-ada-002"
      },
      "max_tokens": {
            "description": "The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.",
            "default": 2048
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "A score between 0.0 and 1.0 indicating the relevance of the answer."
      }
}
  },
  "legacy/ragas_context_precision": {
    name: `Ragas Context Precision`,
    description: `
This metric evaluates whether all of the ground-truth relevant items present in the contexts are ranked higher or not. Higher scores indicate better precision.
`,
    category: "rag",
    docsUrl: "https://docs.ragas.io/en/latest/concepts/metrics/context_precision.html",
    isGuardrail: false,
    requiredFields: ["input", "contexts", "expected_output"],
    optionalFields: [],
    settings: {
      "model": {
            "description": "The model to use for evaluation.",
            "default": "openai/gpt-5"
      },
      "embeddings_model": {
            "description": "The model to use for embeddings.",
            "default": "openai/text-embedding-ada-002"
      },
      "max_tokens": {
            "description": "The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.",
            "default": 2048
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "A score between 0.0 and 1.0 indicating the precision of the context."
      }
}
  },
  "legacy/ragas_context_recall": {
    name: `Ragas Context Recall`,
    description: `
This evaluator measures the extent to which the retrieved context aligns with the annotated answer, treated as the ground truth. Higher values indicate better performance.
`,
    category: "rag",
    docsUrl: "https://docs.ragas.io/en/latest/concepts/metrics/context_recall.html",
    isGuardrail: false,
    requiredFields: ["input", "contexts", "expected_output"],
    optionalFields: [],
    settings: {
      "model": {
            "description": "The model to use for evaluation.",
            "default": "openai/gpt-5"
      },
      "embeddings_model": {
            "description": "The model to use for embeddings.",
            "default": "openai/text-embedding-ada-002"
      },
      "max_tokens": {
            "description": "The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.",
            "default": 2048
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "A score between 0.0 and 1.0 indicating the recall of the context."
      }
}
  },
  "legacy/ragas_context_relevancy": {
    name: `Ragas Context Relevancy`,
    description: `
This metric gauges the relevancy of the retrieved context, calculated based on both the question and contexts. The values fall within the range of (0, 1), with higher values indicating better relevancy.
`,
    category: "rag",
    docsUrl: "https://docs.ragas.io/en/latest/concepts/metrics/context_relevancy.html",
    isGuardrail: false,
    requiredFields: ["output", "contexts"],
    optionalFields: [],
    settings: {
      "model": {
            "description": "The model to use for evaluation.",
            "default": "openai/gpt-5"
      },
      "embeddings_model": {
            "description": "The model to use for embeddings.",
            "default": "openai/text-embedding-ada-002"
      },
      "max_tokens": {
            "description": "The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.",
            "default": 2048
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "A score between 0.0 and 1.0 indicating the relevancy of the context."
      }
}
  },
  "legacy/ragas_context_utilization": {
    name: `Ragas Context Utilization`,
    description: `
This metric evaluates whether all of the output relevant items present in the contexts are ranked higher or not. Higher scores indicate better utilization.
`,
    category: "rag",
    docsUrl: "https://docs.ragas.io/en/latest/concepts/metrics/context_precision.html",
    isGuardrail: false,
    requiredFields: ["input", "output", "contexts"],
    optionalFields: [],
    settings: {
      "model": {
            "description": "The model to use for evaluation.",
            "default": "openai/gpt-5"
      },
      "embeddings_model": {
            "description": "The model to use for embeddings.",
            "default": "openai/text-embedding-ada-002"
      },
      "max_tokens": {
            "description": "The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.",
            "default": 2048
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "A score between 0.0 and 1.0 indicating the utilization of the context."
      }
}
  },
  "legacy/ragas_faithfulness": {
    name: `Ragas Faithfulness`,
    description: `
This evaluator assesses the extent to which the generated answer is consistent with the provided context. Higher scores indicate better faithfulness to the context, useful for detecting hallucinations.
`,
    category: "rag",
    docsUrl: "https://docs.ragas.io/en/latest/concepts/metrics/faithfulness.html",
    isGuardrail: false,
    requiredFields: ["output", "contexts"],
    optionalFields: [],
    settings: {
      "model": {
            "description": "The model to use for evaluation.",
            "default": "openai/gpt-5"
      },
      "embeddings_model": {
            "description": "The model to use for embeddings.",
            "default": "openai/text-embedding-ada-002"
      },
      "max_tokens": {
            "description": "The maximum number of tokens allowed for evaluation, a too high number can be costly. Entries above this amount will be skipped.",
            "default": 2048
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "A score between 0.0 and 1.0 indicating the faithfulness of the answer."
      }
}
  },
  "azure/content_safety": {
    name: `Azure Content Safety`,
    description: `
This evaluator detects potentially unsafe content in text, including hate speech,
self-harm, sexual content, and violence. It allows customization of the severity
threshold and the specific categories to check.
`,
    category: "safety",
    docsUrl: "https://learn.microsoft.com/en-us/azure/ai-services/content-safety/quickstart-text",
    isGuardrail: true,
    requiredFields: [],
    optionalFields: ["input", "output"],
    settings: {
      "severity_threshold": {
            "description": "The minimum severity level to consider content as unsafe, from 1 to 7.",
            "default": 1
      },
      "categories": {
            "description": "The categories of moderation to check for.",
            "default": {
                  "Hate": true,
                  "SelfHarm": true,
                  "Sexual": true,
                  "Violence": true
            }
      },
      "output_type": {
            "description": "The type of severity levels to return on the full 0-7 severity scale, it can be either the trimmed version with four values (0, 2, 4, 6 scores) or the whole range.",
            "default": "FourSeverityLevels"
      }
},
    envVars: ["AZURE_CONTENT_SAFETY_ENDPOINT", "AZURE_CONTENT_SAFETY_KEY"],
    result: {
      "score": {
            "description": "The severity level of the detected content from 0 to 7. A higher score indicates higher severity."
      }
}
  },
  "azure/jailbreak": {
    name: `Azure Jailbreak Detection`,
    description: `
This evaluator checks for jailbreak-attempt in the input using Azure's Content Safety API.
`,
    category: "safety",
    docsUrl: "",
    isGuardrail: true,
    requiredFields: ["input"],
    optionalFields: [],
    settings: {},
    envVars: ["AZURE_CONTENT_SAFETY_ENDPOINT", "AZURE_CONTENT_SAFETY_KEY"],
    result: {
      "passed": {
            "description": "If true then no jailbreak was detected, if false then a jailbreak was detected"
      }
}
  },
  "azure/prompt_injection": {
    name: `Azure Prompt Shield`,
    description: `
This evaluator checks for prompt injection attempt in the input and the contexts using Azure's Content Safety API.
`,
    category: "safety",
    docsUrl: "https://learn.microsoft.com/en-us/azure/ai-services/content-safety/concepts/jailbreak-detection",
    isGuardrail: true,
    requiredFields: ["input"],
    optionalFields: ["contexts"],
    settings: {},
    envVars: ["AZURE_CONTENT_SAFETY_ENDPOINT", "AZURE_CONTENT_SAFETY_KEY"],
    result: {
      "passed": {
            "description": "If true then no prompt injection was detected, if false then a prompt injection was detected"
      }
}
  },
  "presidio/pii_detection": {
    name: `Presidio PII Detection`,
    description: `
Detects personally identifiable information in text, including phone numbers, email addresses, and
social security numbers. It allows customization of the detection threshold and the specific types of PII to check.
`,
    category: "safety",
    docsUrl: "https://microsoft.github.io/presidio",
    isGuardrail: true,
    requiredFields: [],
    optionalFields: ["input", "output"],
    settings: {
      "entities": {
            "description": "The types of PII to check for in the input.",
            "default": {
                  "credit_card": true,
                  "crypto": true,
                  "email_address": true,
                  "iban_code": true,
                  "ip_address": true,
                  "location": false,
                  "person": false,
                  "phone_number": true,
                  "medical_license": true,
                  "us_bank_number": false,
                  "us_driver_license": false,
                  "us_itin": false,
                  "us_passport": false,
                  "us_ssn": false,
                  "uk_nhs": false,
                  "sg_nric_fin": false,
                  "au_abn": false,
                  "au_acn": false,
                  "au_tfn": false,
                  "au_medicare": false,
                  "in_pan": false,
                  "in_aadhaar": false,
                  "in_vehicle_registration": false,
                  "in_voter": false,
                  "in_passport": false
            }
      },
      "min_threshold": {
            "description": "The minimum confidence required for failing the evaluation on a PII match.",
            "default": 0.5
      }
},
    envVars: [],
    result: {
      "score": {
            "description": "Amount of PII detected, 0 means no PII detected"
      },
      "passed": {
            "description": "If true then no PII was detected, if false then at least one PII was detected"
      }
}
  },
};
