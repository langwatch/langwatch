import type {
  ElasticSearchSpan,
  Trace,
  TraceCheck,
} from "../server/tracer/types";
import type { Money } from "../utils/types";

export type Checks = {
  pii_check: {
    parameters: {
      infoTypes: {
        phoneNumber: boolean;
        emailAddress: boolean;
        creditCardNumber: boolean;
        ibanCode: boolean;
        ipAddress: boolean;
        passport: boolean;
        vatNumber: boolean;
        medicalRecordNumber: boolean;
      };
      minLikelihood: "POSSIBLE" | "LIKELY" | "VERY_LIKELY";
      checkPiiInSpans: boolean;
    };
  };
  jailbreak_check: {
    parameters: Record<string, never>;
  };
  toxicity_check: {
    parameters: {
      categories: {
        harassment: boolean;
        "harassment/threatening": boolean;
        hate: boolean;
        "hate/threatening": boolean;
        "self-harm": boolean;
        "self-harm/intent": boolean;
        "self-harm/instructions": boolean;
        sexual: boolean;
        "sexual/minors": boolean;
        violence: boolean;
        "violence/graphic": boolean;
      };
    };
  };
  ragas_answer_relevancy: {
    parameters: Record<string, never>;
  };
  ragas_faithfulness: {
    parameters: Record<string, never>;
  };
  ragas_context_precision: {
    parameters: Record<string, never>;
  };
  inconsistency_check: {
    parameters: Record<string, never>;
  };
  custom: {
    parameters: {
      rules: CustomCheckRules;
    };
  };
};

export type CheckTypes = keyof Checks;

// Zod type will not be generated for this one, check ts-to-zod.config.js
export type TraceCheckJob = {
  check: {
    id: string;
    type: CheckTypes;
    name: string;
  };
  trace: {
    id: string;
    project_id: string;
    thread_id?: string | undefined;
    user_id?: string | undefined;
    customer_id?: string | undefined;
    labels?: string[] | undefined;
  };
};

export type TopicClusteringJob = {
  project_id: string;
};

// Zod type will not be generated for this one, check ts-to-zod.config.js
export type TraceCheckResult = {
  raw_result: object;
  value: number;
  status: "failed" | "succeeded";
  costs: Money[];
};

export type TraceCheckBackendDefinition<T extends CheckTypes> = {
  // TODO: should not be duplicated between front and backend
  requiresRag?: boolean;
  execute: (
    trace: Trace,
    spans: ElasticSearchSpan[],
    parameters: Checks[T]["parameters"]
  ) => Promise<TraceCheckResult>;
};

export type TraceCheckFrontendDefinition<T extends CheckTypes> = {
  name: string;
  description: string;
  requiresRag?: boolean;
  parametersDescription: Record<
    keyof Checks[T]["parameters"],
    { name?: string; description?: string }
  >;
  default: {
    parameters: Checks[T]["parameters"];
    preconditions?: CheckPreconditions;
  };
  render: (props: { check: TraceCheck }) => JSX.Element;
};

// API Types
export type ModerationResult = {
  id: string;
  model: string;
  results: ModerationResultEntry[];
};

export type ModerationResultEntry = {
  flagged: boolean;
  categories: Record<string, boolean>;
  category_scores: Record<string, number>;
};

export type JailbreakAnalysisResult = {
  jailbreakAnalysis: {
    detected: boolean;
  };
};

export type RagasResult = {
  scores: {
    answer_relevancy?: number;
    faithfulness?: number;
    context_precision?: number;
    context_recall?: number;
  };
  costs: {
    amount: number;
    currency: string;
  };
};

export type InconsistencyCheckResult = {
  sentences: string[];
};

// Custom Checks
export type CustomCheckFields = "input" | "output";

export type CustomCheckFailWhen = {
  condition: ">" | "<" | ">=" | "<=" | "==";
  amount: number;
};

export type CustomCheckRule =
  | {
      field: CustomCheckFields;
      rule: "contains";
      /**
       * @minLength 1
       * @maxLength 500
       */
      value: string;
    }
  | {
      field: CustomCheckFields;
      rule: "not_contains";
      /**
       * @minLength 1
       * @maxLength 500
       */
      value: string;
    }
  | {
      field: CustomCheckFields;
      rule: "matches_regex";
      /**
       * @minLength 1
       * @maxLength 500
       */
      value: string;
    }
  | {
      field: CustomCheckFields;
      rule: "not_matches_regex";
      /**
       * @minLength 1
       * @maxLength 500
       */
      value: string;
    }
  | {
      field: CustomCheckFields;
      rule: "is_similar_to";
      /**
       * @minLength 1
       * @maxLength 500
       */
      value: string;
      openai_embeddings?: number[];
      failWhen: CustomCheckFailWhen;
    }
  | {
      field: CustomCheckFields;
      rule: "llm_boolean";
      /**
       * @minLength 1
       * @maxLength 2000
       */
      value: string;
      /**
       * @minLength 1
       * @maxLength 70
       */
      model: string;
    }
  | {
      field: CustomCheckFields;
      rule: "llm_score";
      /**
       * @minLength 1
       * @maxLength 2000
       */
      value: string;
      /**
       * @minLength 1
       * @maxLength 70
       */
      model: string;
      failWhen: CustomCheckFailWhen;
    };

export type CustomCheckRules = CustomCheckRule[];

export type CheckPrecondition =
  | {
      field: CustomCheckFields;
      rule: "contains";
      /**
       * @minLength 1
       * @maxLength 500
       */
      value: string;
    }
  | {
      field: CustomCheckFields;
      rule: "not_contains";
      /**
       * @minLength 1
       * @maxLength 500
       */
      value: string;
    }
  | {
      field: CustomCheckFields;
      rule: "matches_regex";
      /**
       * @minLength 1
       * @maxLength 500
       */
      value: string;
    }
  | {
      field: CustomCheckFields;
      rule: "is_similar_to";
      /**
       * @minLength 1
       * @maxLength 500
       */
      value: string;
      /**
       * @minimum 0
       * @maximum 1
       */
      openai_embeddings?: number[];
      threshold: number;
    };

export type CheckPreconditions = CheckPrecondition[];
