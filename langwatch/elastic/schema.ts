import {
  type MappingDenseVectorProperty,
  type MappingProperty,
} from "@elastic/elasticsearch/lib/api/types";
import { FLATENNED_TYPE } from "../src/server/elasticsearch";
import type {
  DSPyStep,
  ESBatchEvaluation,
} from "../src/server/experiments/types";
import {
  type ElasticSearchEvent,
  type ElasticSearchSpan,
  type ElasticSearchTrace,
  type ElasticSearchEvaluation,
} from "../src/server/tracer/types";
import { OPENAI_EMBEDDING_DIMENSION } from "../src/utils/constants";

type NonNestedMappingProperty =
  | Omit<MappingProperty, "properties">
  | MappingDenseVectorProperty
  | { type: "knn_vector"; [key: string]: any };

type ElasticSearchMappingFrom<T> = NonNullable<T> extends (infer U)[]
  ? {
      type?: "nested";
      include_in_parent?: boolean;
      properties: ElasticSearchMappingFrom<U>;
    }
  : {
      [K in keyof Required<T>]: NonNullable<T[K]> extends string[] | number[]
        ? NonNestedMappingProperty
        : NonNullable<T[K]> extends object[]
        ? ElasticSearchMappingFrom<T[K]>
        : NonNullable<T[K]> extends object
        ? { properties: ElasticSearchMappingFrom<T[K]> }
        : NonNestedMappingProperty;
    };

export type ElasticSearchMigration = {
  migration_name: string;
  applied_at: number;
};

export const elasticMigrations: ElasticSearchMappingFrom<ElasticSearchMigration> =
  {
    migration_name: { type: "keyword" },
    applied_at: { type: "date" },
  };

const spanMapping: ElasticSearchMappingFrom<ElasticSearchSpan> = {
  project_id: { type: "keyword" },
  type: { type: "keyword" },
  name: { type: "text" },
  span_id: { type: "keyword" },
  parent_id: { type: "keyword" },
  trace_id: { type: "keyword" },
  input: {
    properties: {
      type: {
        type: "keyword",
      },
      value: { type: "text" },
    },
  },
  output: {
    properties: {
      type: {
        type: "keyword",
      },
      value: { type: "text" },
    } as any,
  },
  error: {
    properties: {
      has_error: { type: "boolean" }, // workaround to make has_error available on pivot index since text fields are not
      message: { type: "text" },
      stacktrace: { type: "text" },
    },
  },
  timestamps: {
    properties: {
      inserted_at: { type: "date" },
      started_at: { type: "date" },
      first_token_at: { type: "date" },
      finished_at: { type: "date" },
      updated_at: { type: "date" },
    },
  },
  vendor: { type: "keyword" },
  model: { type: "keyword" },
  params: {
    type: FLATENNED_TYPE,
  } as any,
  metrics: {
    properties: {
      prompt_tokens: { type: "integer" },
      completion_tokens: { type: "integer" },
      tokens_estimated: { type: "boolean" },
      cost: { type: "float" },
    },
  },
  contexts: {
    properties: {
      document_id: { type: "keyword" },
      chunk_id: { type: "keyword" },
      content: { type: "text" },
    },
  },
};

const evaluationsMapping: ElasticSearchMappingFrom<ElasticSearchEvaluation> = {
  evaluation_id: { type: "keyword" },
  evaluator_id: { type: "keyword" },
  span_id: { type: "keyword" },
  name: { type: "keyword" },
  type: { type: "keyword" },
  is_guardrail: { type: "boolean" },
  status: { type: "keyword" },
  passed: { type: "boolean" },
  score: { type: "float" },
  details: { type: "text" },
  label: { type: "keyword" },
  error: {
    properties: {
      has_error: { type: "boolean" }, // workaround to make has_error available on pivot index since text fields are not
      message: { type: "text" },
      stacktrace: { type: "text" },
    },
  },
  retries: { type: "integer" },
  timestamps: {
    properties: {
      started_at: { type: "date" },
      finished_at: { type: "date" },
      inserted_at: { type: "date" },
      updated_at: { type: "date" },
    },
  },
};

const eventsMapping: ElasticSearchMappingFrom<ElasticSearchEvent> = {
  event_id: { type: "keyword" },
  project_id: { type: "keyword" },
  trace_id: { type: "keyword" }, // latter we might offer thread_id events as well, but probably a separate index then
  event_type: { type: "keyword" },
  metrics: {
    type: "nested",
    include_in_parent: true,
    properties: {
      key: { type: "keyword" },
      value: { type: "float" },
    },
  },
  event_details: {
    type: "nested",
    include_in_parent: true,
    properties: {
      key: { type: "keyword" },
      value: { type: "keyword" },
    },
  },
  timestamps: {
    properties: {
      started_at: { type: "date" },
      inserted_at: { type: "date" },
      updated_at: { type: "date" },
    },
  },
};

export const traceMapping: ElasticSearchMappingFrom<ElasticSearchTrace> = {
  trace_id: { type: "keyword" },
  project_id: { type: "keyword" },
  metadata: {
    properties: {
      thread_id: { type: "keyword" },
      user_id: { type: "keyword" },
      customer_id: { type: "keyword" },
      labels: { type: "keyword" },
      topic_id: { type: "keyword" },
      subtopic_id: { type: "keyword" },
      sdk_version: { type: "keyword" },
      sdk_language: { type: "keyword" },

      custom: { type: FLATENNED_TYPE } as any,
      all_keys: { type: "keyword" },
    },
  },
  timestamps: {
    properties: {
      started_at: { type: "date" },
      inserted_at: { type: "date" },
      updated_at: { type: "date" },
    },
  },
  input: {
    properties: {
      value: { type: "text" },
      satisfaction_score: { type: "float" },
      embeddings: {
        properties: {
          model: { type: "keyword" },
          embeddings: process.env.IS_OPENSEARCH
            ? {
                type: "knn_vector",
                dimension: OPENAI_EMBEDDING_DIMENSION,
                method: {
                  name: "hnsw",
                  space_type: "l2",
                  engine: "nmslib",
                  parameters: {
                    ef_construction: 128,
                    m: 24,
                  },
                },
              }
            : {
                index: true,
                type: "dense_vector",
                dims: OPENAI_EMBEDDING_DIMENSION,
                similarity: "cosine",
              },
        },
      },
    },
  },
  output: {
    properties: {
      value: { type: "text" },
      embeddings: {
        properties: {
          model: { type: "keyword" },
          embeddings: process.env.IS_OPENSEARCH
            ? {
                type: "knn_vector",
                dimension: OPENAI_EMBEDDING_DIMENSION,
                method: {
                  name: "hnsw",
                  space_type: "l2",
                  engine: "nmslib",
                  parameters: {
                    ef_construction: 128,
                    m: 24,
                  },
                },
              }
            : {
                index: true,
                type: "dense_vector",
                dims: OPENAI_EMBEDDING_DIMENSION,
                similarity: "cosine",
              },
        },
      },
    },
  },
  metrics: {
    properties: {
      first_token_ms: { type: "integer" },
      total_time_ms: { type: "integer" },
      prompt_tokens: { type: "integer" },
      completion_tokens: { type: "integer" },
      tokens_estimated: { type: "boolean" },
      total_cost: { type: "float" },
    },
  },
  error: {
    properties: {
      has_error: { type: "boolean" }, // workaround to make has_error available on pivot index since text fields are not
      message: { type: "text" },
      stacktrace: { type: "text" } as any,
    },
  },
  indexing_md5s: {
    type: "keyword",
  },
  contexts: {
    type: "nested",
    properties: {
      document_id: { type: "keyword" },
      chunk_id: { type: "keyword" },
      content: { type: "text" },
    },
  },
  expected_output: {
    properties: {
      value: { type: "text" },
    },
  },

  spans: {
    type: "nested",
    properties: spanMapping,
  },
  evaluations: {
    type: "nested",
    properties: evaluationsMapping,
  },
  events: {
    type: "nested",
    properties: eventsMapping,
  },
};

export const dspyStepsMapping: ElasticSearchMappingFrom<DSPyStep> = {
  project_id: { type: "keyword" },
  experiment_id: { type: "keyword" },
  run_id: { type: "keyword" },
  workflow_version_id: { type: "keyword" },
  index: { type: "keyword" },
  score: { type: "float" },
  label: { type: "keyword" },
  optimizer: {
    properties: {
      name: { type: "keyword" },
      parameters: { type: FLATENNED_TYPE } as any,
    },
  },
  predictors: {
    type: "nested",
    properties: {
      name: { type: "keyword" },
      predictor: { type: FLATENNED_TYPE } as any,
    },
  },
  examples: {
    type: "nested",
    properties: {
      hash: { type: "keyword" },
      example: { type: FLATENNED_TYPE } as any,
      pred: { type: FLATENNED_TYPE } as any,
      score: { type: "float" },
      trace: { type: "nested" } as any,
    },
  },
  llm_calls: {
    type: "nested",
    properties: {
      hash: { type: "keyword" },
      __class__: { type: "keyword" },
      model: { type: "keyword" },
      prompt_tokens: { type: "integer" },
      completion_tokens: { type: "integer" },
      cost: { type: "float" },
      response: { type: FLATENNED_TYPE } as any,
    },
  },
  timestamps: {
    properties: {
      created_at: { type: "date" },
      inserted_at: { type: "date" },
      updated_at: { type: "date" },
    },
  },
};

export const batchEvaluationMapping: ElasticSearchMappingFrom<ESBatchEvaluation> =
  {
    project_id: { type: "keyword" },
    experiment_id: { type: "keyword" },
    run_id: { type: "keyword" },
    workflow_version_id: { type: "keyword" },
    progress: { type: "integer" },
    total: { type: "integer" },
    dataset: {
      properties: {
        index: { type: "integer" },
        entry: { type: FLATENNED_TYPE } as any,
        cost: { type: "float" },
        duration: { type: "integer" },
        error: { type: "text" },
      },
    },
    evaluations: {
      type: "nested",
      properties: {
        evaluator: { type: "keyword" },
        name: { type: "keyword" },
        status: { type: "keyword" },
        index: { type: "integer" },
        score: { type: "float" },
        label: { type: "keyword" },
        passed: { type: "boolean" },
        details: { type: "text" },
        cost: { type: "float" },
        duration: { type: "integer" },
        inputs: { type: FLATENNED_TYPE } as any,
      },
    },
    timestamps: {
      properties: {
        created_at: { type: "date" },
        inserted_at: { type: "date" },
        updated_at: { type: "date" },
        stopped_at: { type: "date" },
        finished_at: { type: "date" },
      },
    },
  };
