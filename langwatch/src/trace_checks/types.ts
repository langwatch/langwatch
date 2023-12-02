import type {
  ElasticSearchSpan,
  Trace,
  TraceCheck,
} from "../server/tracer/types";

export type Checks = {
  pii_check: {
    parameters: {
      infoTypes: {
        PHONE_NUMBER: boolean;
        EMAIL_ADDRESS: boolean;
        CREDIT_CARD_NUMBER: boolean;
        IBAN_CODE: boolean;
        IP_ADDRESS: boolean;
        PASSPORT: boolean;
        VAT_NUMBER: boolean;
        MEDICAL_RECORD_NUMBER: boolean;
      };
      minLikelihood: "POSSIBLE" | "LIKELY" | "VERY_LIKELY";
    };
  };
  toxicity_check: {
    parameters: Record<string, never>;
  };
  custom: {
    parameters: {
      rules: CustomCheckRules;
    };
  };
};

export type CheckTypes = keyof Checks;

export type TraceCheckJob = {
  trace_id: string;
  project_id: string;
};

// Zod type will not be generated for this one, check ts-to-zod.config.js
export type TraceCheckResult = {
  raw_result: object;
  value: number;
  status: "failed" | "succeeded";
};

export type TraceCheckBackendDefinition = {
  execute: (
    trace: Trace,
    _spans: ElasticSearchSpan[]
  ) => Promise<TraceCheckResult>;
};

export type TraceCheckFrontendDefinition = {
  name: string;
  render: (props: { check: TraceCheck }) => JSX.Element;
};

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

type CustomCheckFields = "input" | "output";

type CustomCheckFailWhen = {
  condition: ">" | "<" | ">=" | "<=" | "==";
  amount: number;
};

export type CustomCheckRule =
  | { field: CustomCheckFields; rule: "contains"; value: string }
  | { field: CustomCheckFields; rule: "not_contains"; value: string }
  | {
      field: CustomCheckFields;
      rule: "is_similar_to";
      value: string;
      threshold: string;
    }
  | {
      field: CustomCheckFields;
      rule: "similarity_score";
      value: string;
      fail_when: CustomCheckFailWhen;
    }
  | { field: CustomCheckFields; rule: "llm_boolean"; value: string }
  | {
      field: CustomCheckFields;
      rule: "llm_score";
      value: string;
      fail_when: CustomCheckFailWhen;
    };

export type CustomCheckRules = CustomCheckRule[];

export type CustomCheckPrecondition =
  | { field: CustomCheckFields; rule: "contains"; value: string }
  | { field: CustomCheckFields; rule: "not_contains"; value: string }
  | {
      field: CustomCheckFields;
      rule: "is_similar_to";
      value: string;
      threshold: string;
    };

export type CustomCheckPreconditions = CustomCheckPrecondition[];
