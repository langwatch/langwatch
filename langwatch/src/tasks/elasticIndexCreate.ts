import {
  type MappingDenseVectorProperty,
  type MappingProperty,
} from "@elastic/elasticsearch/lib/api/types";
import {
  EVENTS_INDEX,
  OPENAI_EMBEDDING_DIMENSION,
  SPAN_INDEX,
  TRACE_CHECKS_INDEX,
  TRACE_INDEX,
  TRACES_PIVOT_INDEX,
  esClient,
  TRACES_PIVOT_TRANSFORM,
} from "../server/elasticsearch";
import {
  type ElasticSearchSpan,
  type TraceCheck,
  type ElasticSearchEvent,
  type ElasticSearchTrace,
} from "../server/tracer/types";
import omit from "lodash.omit";
import type { TracesPivot } from "../server/analytics/types";

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
      message: { type: "text" },
      stacktrace: { type: "text" } as any,
    },
  },
  indexing_md5s: {
    type: "keyword",
  },
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
  outputs: {
    type: "nested",
    properties: {
      type: {
        type: "keyword",
      },
      value: { type: "text" },
    } as any,
  },
  error: {
    properties: {
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
      functions: { type: "nested" } as any, // TODO: change to flattened
      // tools: { type: "flattened" } as any, // TODO implement
      // tool_choice: { type: "keyword" }, // TODO implement
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
  status: { type: "keyword" },
  passed: { type: "boolean" },
  score: { type: "float" },
  details: { type: "text" },
  error: {
    properties: {
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
  trace_metadata: {
    properties: {
      thread_id: { type: "keyword" },
      user_id: { type: "keyword" },
      customer_id: { type: "keyword" },
      labels: { type: "keyword" },
      topics: { type: "keyword" },
    },
  },
};

const eventsMapping: ElasticSearchMappingFrom<ElasticSearchEvent> = {
  event_id: { type: "keyword" },
  project_id: { type: "keyword" },
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
  trace_id: { type: "keyword" }, // optional, later we will have events on thread or user level
  trace_metadata: {
    properties: {
      thread_id: { type: "keyword" },
      user_id: { type: "keyword" },
      customer_id: { type: "keyword" },
      labels: { type: "keyword" },
      topics: { type: "keyword" },
    },
  },
};

const tracesPivotMapping: ElasticSearchMappingFrom<
  TracesPivot & { project_trace_id: string }
> = {
  project_trace_id: {
    type: "keyword",
  },
  trace: {
    properties: {
      ...omit(traceMapping, "input", "output", "error", "indexing_md5s"),
      input: { properties: { satisfaction_score: { type: "float" } } },
      has_error: {
        type: "boolean",
      },
    },
  },
  spans: {
    type: "nested",
    properties: {
      ...omit(
        spanMapping,
        "name",
        "input",
        "outputs",
        "error",
        "params",
        "contexts"
      ),
      has_error: {
        type: "boolean",
      },
      params: {
        properties: {
          temperature: { type: "float" },
          stream: { type: "boolean" },
        },
      },
    },
  },
  contexts: {
    type: "nested",
    properties: {
      document_id: { type: "keyword" },
      chunk_id: { type: "keyword" },
    },
  },
  trace_checks: {
    type: "nested",
    properties: {
      ...omit(traceChecksMapping, "error", "trace_metadata"),
      has_error: {
        type: "boolean",
      },
    },
  },
  events: {
    type: "nested",
    properties: {
      ...omit(eventsMapping, "trace_metadata", "metrics", "event_details"),
      metrics: {
        ...omit(eventsMapping.metrics, "include_in_parent"),
      },
      event_details: {
        ...omit(eventsMapping.event_details, "include_in_parent"),
      },
    },
  },
};

async function createPivotTableTransform() {
  const getCopyScript = (
    mapping: Record<string, MappingProperty>,
    stateKey: string,
    namespacePrefix = "",
    parents: string[] = []
  ) => {
    let copyScript = "";
    for (const [key, value] of Object.entries(mapping)) {
      if (
        "properties" in value &&
        value.properties &&
        value.type === "nested"
      ) {
        const propertyKeys = Object.keys(value.properties);
        const keyPath = [...parents, key].join(".");

        copyScript += `
            List ${key}_list = new ArrayList();

            for (int i = 0; i < doc['${namespacePrefix}${key}.${
              propertyKeys[0]
            }'].size(); ++i) {
              Map ${key}_item = new HashMap();
              ${propertyKeys
                .map((propertyKey) => {
                  return `
                    if (doc.containsKey('${namespacePrefix}${key}.${propertyKey}') && doc['${namespacePrefix}${key}.${propertyKey}'].size() > i) {
                      if (doc['${namespacePrefix}${key}.${propertyKey}'].size() > 1) {
                        ${key}_item.put('${propertyKey}', doc['${namespacePrefix}${key}.${propertyKey}'][i]);
                      } else {
                        ${key}_item.put('${propertyKey}', doc['${namespacePrefix}${key}.${propertyKey}'].value);
                      }

                    }
                  `;
                })
                .join("\n")}

              ${key}_list.add(${key}_item);
            }

            ${stateKey}.put('${keyPath}', ${key}_list);
        `;
      } else if ("properties" in value && value.properties) {
        copyScript += getCopyScript(
          value.properties,
          stateKey,
          namespacePrefix,
          [...parents, key]
        );
      } else if (key == "has_error") {
        copyScript += `
          if (doc.containsKey('error') && !doc['error'].empty) {
            ${stateKey}.put('has_error', true);
          }
        `;
      } else {
        const keyPath = [...parents, key].join(".");
        if (parents.includes("timestamps")) {
          copyScript += `
            if (doc.containsKey('${namespacePrefix}${keyPath}') && !doc['${namespacePrefix}${keyPath}'].empty) {
              ${stateKey}.put('${keyPath}', doc['${namespacePrefix}${keyPath}'].value.toInstant().toEpochMilli());
            }
          `;
        } else {
          copyScript += `
            if (doc.containsKey('${namespacePrefix}${keyPath}') && !doc['${namespacePrefix}${keyPath}'].empty) {
              ${stateKey}.put('${keyPath}', doc['${namespacePrefix}${keyPath}'].value);
            }
          `;
        }
      }
    }

    return copyScript;
  };

  const { trace, spans, contexts, trace_checks, events } = tracesPivotMapping;

  const traceMappingScript = getCopyScript(
    trace.properties as Record<string, MappingProperty>,
    "state.trace"
  );
  const spansMappingScript = getCopyScript(
    spans.properties as Record<string, MappingProperty>,
    "span"
  );
  const contextsMappingScript = getCopyScript(
    contexts.properties as Record<string, MappingProperty>,
    "context",
    "contexts."
  );
  const traceChecksMappingScript = getCopyScript(
    trace_checks.properties as Record<string, MappingProperty>,
    "trace_check"
  );
  const eventsMappingScript = getCopyScript(
    events.properties as Record<string, MappingProperty>,
    "event"
  );

  const reduceListScript = `
    List all = new ArrayList();
    for (state in states) {
      all.addAll(state);
    }
    return all;
  `;

  try {
    const transform = await esClient.transform.getTransform({
      transform_id: TRACES_PIVOT_TRANSFORM,
    });
    if (transform) {
      console.log(TRACES_PIVOT_TRANSFORM, "already exists, skipping");
      return;
    }
  } catch {}

  await esClient.transform.putTransform({
    transform_id: TRACES_PIVOT_TRANSFORM,
    body: {
      source: {
        index: [TRACE_INDEX, SPAN_INDEX, TRACE_CHECKS_INDEX, EVENTS_INDEX],
      },
      dest: {
        index: TRACES_PIVOT_INDEX,
      },
      pivot: {
        group_by: {
          project_trace_id: {
            terms: {
              script: {
                source: "doc['project_id'].value + '/' + doc['trace_id'].value",
              },
            },
          },
        },
        aggregations: {
          trace: {
            scripted_metric: {
              init_script: "state.trace = new HashMap();",
              map_script: `
                  if (doc['_index'].value == '${TRACE_INDEX}') {
                    ${traceMappingScript}
                  }
                `,
              combine_script: "return state.trace;",
              reduce_script: `
                  Map result = new HashMap();
                  for (state in states) {
                    result.putAll(state);
                  }
                  return result;
                `,
            },
          },
          spans: {
            scripted_metric: {
              init_script: "state.spans = new ArrayList();",
              map_script: `
                  if (doc['_index'].value == '${SPAN_INDEX}') {
                    Map span = new HashMap();
                    ${spansMappingScript}
                    state.spans.add(span);
                  }
                `,
              combine_script: "return state.spans;",
              reduce_script: reduceListScript,
            },
          },
          contexts: {
            scripted_metric: {
              init_script: "state.contexts = new ArrayList();",
              map_script: `
                      if (doc['_index'].value == '${SPAN_INDEX}') {
                        Map context = new HashMap();
                        ${contextsMappingScript}
                        if (!context.empty) {
                          state.contexts.add(context);
                        }
                      }
                    `,
              combine_script: "return state.contexts;",
              reduce_script: reduceListScript,
            },
          },
          trace_checks: {
            scripted_metric: {
              init_script: "state.trace_checks = new ArrayList();",
              map_script: `
                  if (doc['_index'].value == '${TRACE_CHECKS_INDEX}') {
                    Map trace_check = new HashMap();
                    ${traceChecksMappingScript}
                    state.trace_checks.add(trace_check);
                  }
                `,
              combine_script: "return state.trace_checks;",
              reduce_script: reduceListScript,
            },
          },
          events: {
            scripted_metric: {
              init_script: "state.events = new ArrayList();",
              map_script: `
                  if (doc['_index'].value == '${EVENTS_INDEX}') {
                    Map event = new HashMap();
                    ${eventsMappingScript}
                    state.events.add(event);
                  }
                `,
              combine_script: "return state.events;",
              reduce_script: reduceListScript,
            },
          },
        },
      },
      sync: {
        time: {
          field: "timestamps.updated_at",
          delay: "60s",
        },
      },
      settings: {
        max_page_search_size: 100,
      },
    },
  });

  await esClient.transform.startTransform({
    transform_id: TRACES_PIVOT_TRANSFORM,
  });
}

export const createIndexes = async () => {
  const spanExists = await esClient.indices.exists({ index: SPAN_INDEX });
  if (!spanExists) {
    await esClient.indices.create({
      index: SPAN_INDEX,
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
      },
      mappings: { properties: spanMapping as Record<string, MappingProperty> },
    });
  }
  await esClient.indices.putMapping({
    index: SPAN_INDEX,
    properties: spanMapping as Record<string, MappingProperty>,
  });

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

  const traceChecksExists = await esClient.indices.exists({
    index: TRACE_CHECKS_INDEX,
  });
  if (!traceChecksExists) {
    await esClient.indices.create({
      index: TRACE_CHECKS_INDEX,
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
      },
      mappings: {
        properties: traceChecksMapping as Record<string, MappingProperty>,
      },
    });
  }
  await esClient.indices.putMapping({
    index: TRACE_CHECKS_INDEX,
    properties: traceChecksMapping as Record<string, MappingProperty>,
  });

  const eventsExists = await esClient.indices.exists({ index: EVENTS_INDEX });
  if (!eventsExists) {
    await esClient.indices.create({
      index: EVENTS_INDEX,
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
      },
      mappings: {
        properties: eventsMapping as Record<string, MappingProperty>,
      },
    });
  }
  await esClient.indices.putMapping({
    index: EVENTS_INDEX,
    properties: eventsMapping as Record<string, MappingProperty>,
  });

  const tracesPivotExists = await esClient.indices.exists({
    index: TRACES_PIVOT_INDEX,
  });
  if (!tracesPivotExists) {
    await esClient.indices.create({
      index: TRACES_PIVOT_INDEX,
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
      },
      mappings: {
        properties: tracesPivotMapping as Record<string, MappingProperty>,
      },
    });
  }
  await esClient.indices.putMapping({
    index: TRACES_PIVOT_INDEX,
    properties: tracesPivotMapping as Record<string, MappingProperty>,
  });

  await createPivotTableTransform();
};

export default async function execute() {
  await createIndexes();
}
