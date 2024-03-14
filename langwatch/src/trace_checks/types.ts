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
