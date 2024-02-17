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
        hate: boolean;
        selfHarm: boolean;
        sexual: boolean;
        violence: boolean;
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
  language_check: {
    parameters: {
      checkFor: "input_matches_output" | "input_language" | "output_language";
      expectedLanguage:
        | "any"
        | "AF"
        | "AR"
        | "AZ"
        | "BE"
        | "BG"
        | "BN"
        | "BS"
        | "CA"
        | "CS"
        | "CY"
        | "DA"
        | "DE"
        | "EL"
        | "EN"
        | "EO"
        | "ES"
        | "ET"
        | "EU"
        | "FA"
        | "FI"
        | "FR"
        | "GA"
        | "GU"
        | "HE"
        | "HI"
        | "HR"
        | "HU"
        | "HY"
        | "ID"
        | "IS"
        | "IT"
        | "JA"
        | "KA"
        | "KK"
        | "KO"
        | "LA"
        | "LG"
        | "LT"
        | "LV"
        | "MI"
        | "MK"
        | "MN"
        | "MR"
        | "MS"
        | "NB"
        | "NL"
        | "NN"
        | "PA"
        | "PL"
        | "PT"
        | "RO"
        | "RU"
        | "SK"
        | "SL"
        | "SN"
        | "SO"
        | "SQ"
        | "SR"
        | "ST"
        | "SV"
        | "SW"
        | "TA"
        | "TE"
        | "TH"
        | "TL"
        | "TN"
        | "TR"
        | "TS"
        | "UK"
        | "UR"
        | "VI"
        | "XH"
        | "YO"
        | "ZH"
        | "ZU";
    };
  };
  custom: {
    parameters: {
      rules: CustomCheckRules;
    };
  };
};

export type CheckTypes = keyof Checks;

export type TraceCheckResult = {
  raw_result: object;
  value: number;
  status: "failed" | "succeeded";
  costs: Money[];
};

export type TraceCheckDefinition<T extends CheckTypes> = {
  name: string;
  description: string;
  valueDisplayType: "boolean" | "number";
  requiresRag?: boolean;
  parametersDescription: {
    [K in keyof Checks[T]["parameters"]]: {
      name?: string;
      description?: string;
      labels?: Checks[T]["parameters"][K] extends string
        ? { [V in Checks[T]["parameters"][K]]: string }
        : never;
    };
  };
  default: {
    parameters: Checks[T]["parameters"];
    preconditions?: CheckPreconditions;
  };
};

// API Types
export type ModerationCategories = "Hate" | "SelfHarm" | "Sexual" | "Violence";

export type ModerationResult = {
  categoriesAnalysis: ModerationResultEntry[];
};

export type ModerationResultEntry = {
  category: ModerationCategories;
  severity: number;
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

export type LanguageCheckApiResponse = {
  languages: {
    match: boolean;
    input?: string[];
    output?: string[];
  };
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
      embeddings?: { model: string; embeddings: number[] };
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

export type CheckPreconditionFields = "input" | "output" | "metadata.labels";

export type CheckPrecondition =
  | {
      field: CheckPreconditionFields;
      rule: "contains";
      /**
       * @minLength 1
       * @maxLength 500
       */
      value: string;
    }
  | {
      field: CheckPreconditionFields;
      rule: "not_contains";
      /**
       * @minLength 1
       * @maxLength 500
       */
      value: string;
    }
  | {
      field: CheckPreconditionFields;
      rule: "matches_regex";
      /**
       * @minLength 1
       * @maxLength 500
       */
      value: string;
    }
  | {
      field: CheckPreconditionFields;
      rule: "is_similar_to";
      /**
       * @minLength 1
       * @maxLength 500
       */
      value: string;
      embeddings?: { model: string; embeddings: number[] };
      threshold: number;
    };

export type CheckPreconditions = CheckPrecondition[];
