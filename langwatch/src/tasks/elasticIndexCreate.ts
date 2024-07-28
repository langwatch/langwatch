import {
  type MappingDenseVectorProperty,
  type MappingProperty,
} from "@elastic/elasticsearch/lib/api/types";
import {
  DSPY_STEPS_INDEX,
  esClient,
  OPENAI_EMBEDDING_DIMENSION,
  TRACE_INDEX,
} from "../server/elasticsearch";
import type { DSPyStep } from "../server/experiments/types";
import {
  type ElasticSearchEvent,
  type ElasticSearchSpan,
  type ElasticSearchTrace,
  type TraceCheck,
} from "../server/tracer/types";

type NonNestedMappingProperty =
  | Omit<MappingProperty, "properties">
  | MappingDenseVectorProperty;

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
    properties: {
      temperature: { type: "float" },
      stream: { type: "boolean" },
      functions: { type: "flattened" } as any, // TODO: change to flattened
      tools: { type: "flattened" } as any, // TODO implement
      tool_choice: { type: "flattened" }, // TODO implement
      max_tokens: { type: "long" }, // TODO implement
      n: { type: "integer" }, // TODO implement
      top_p: { type: "float" }, // TODO implement
      frequency_penalty: { type: "float" }, // TODO implement
      presence_penalty: { type: "float" }, // TODO implement
    } as any, // TODO: remove this any
  },
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

const traceChecksMapping: ElasticSearchMappingFrom<TraceCheck> = {
  trace_id: { type: "keyword" },
  check_id: { type: "keyword" },
  project_id: { type: "keyword" },
  check_type: { type: "keyword" },
  check_name: { type: "keyword" },
  is_guardrail: { type: "boolean" },
  status: { type: "keyword" },
  passed: { type: "boolean" },
  score: { type: "float" },
  details: { type: "text" },
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

const traceMapping: ElasticSearchMappingFrom<ElasticSearchTrace> = {
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

      custom: { type: "flattened" } as any,
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
          embeddings: {
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
          embeddings: {
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
    properties: traceChecksMapping,
  },
  events: {
    type: "nested",
    properties: eventsMapping,
  },
};

const dspyStepsMapping: ElasticSearchMappingFrom<DSPyStep> = {
  project_id: { type: "keyword" },
  experiment_id: { type: "keyword" },
  run_id: { type: "keyword" },
  index: { type: "keyword" },
  score: { type: "float" },
  label: { type: "keyword" },
  optimizer: {
    properties: {
      name: { type: "keyword" },
      parameters: { type: "flattened" } as any,
    },
  },
  predictors: {
    type: "nested",
    properties: {
      name: { type: "keyword" },
      predictor: { type: "flattened" } as any,
    },
  },
  examples: {
    type: "nested",
    properties: {
      hash: { type: "keyword" },
      example: { type: "flattened" } as any,
      pred: { type: "flattened" } as any,
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
      response: { type: "flattened" } as any,
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

export const createIndexes = async () => {
  const traceExists = await esClient.indices.exists({ index: TRACE_INDEX });
  if (!traceExists) {
    await esClient.indices.create({
      index: TRACE_INDEX,
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
      },
      mappings: { properties: traceMapping as Record<string, MappingProperty> },
    });
  }
  await esClient.indices.putMapping({
    index: TRACE_INDEX,
    properties: traceMapping as Record<string, MappingProperty>,
  });

  const dspyStepExists = await esClient.indices.exists({
    index: DSPY_STEPS_INDEX,
  });
  if (!dspyStepExists) {
    await esClient.indices.create({
      index: DSPY_STEPS_INDEX,
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
      },
      mappings: {
        properties: dspyStepsMapping as Record<string, MappingProperty>,
      },
    });
  }
};

export default async function execute() {
  await createIndexes();
}
