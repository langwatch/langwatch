import type {
  QueryDslBoolQuery,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "../../trace_checks/evaluators.generated";
import type { FilterDefinition, FilterField } from "./types";

export const availableFilters: { [K in FilterField]: FilterDefinition } = {
  "topics.topics": {
    name: "Topic",
    urlKey: "topics",
    query: (values) => ({
      terms: { "metadata.topic_id": values },
    }),
    listMatch: {
      aggregation: (query) => ({
        unique_values: {
          filter: query
            ? {
                prefix: {
                  "metadata.topic_id": {
                    value: query,
                    case_insensitive: true,
                  },
                },
              }
            : {
                match_all: {},
              },
          aggs: {
            child: {
              terms: {
                field: "metadata.topic_id",
                size: 100,
                order: { _key: "asc" },
              },
            },
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        return (
          result.unique_values?.child?.buckets?.map((bucket: any) => ({
            field: bucket.key,
            label: bucket.key,
            count: bucket.doc_count,
          })) ?? []
        );
      },
    },
  },
  "topics.subtopics": {
    name: "Subtopic",
    urlKey: "subtopics",
    query: (values) => ({
      terms: { "metadata.subtopic_id": values },
    }),
    listMatch: {
      aggregation: (query) => ({
        unique_values: {
          filter: query
            ? {
                prefix: {
                  "metadata.subtopic_id": {
                    value: query,
                    case_insensitive: true,
                  },
                },
              }
            : {
                match_all: {},
              },
          aggs: {
            child: {
              terms: {
                field: "metadata.subtopic_id",
                size: 100,
                order: { _key: "asc" },
              },
            },
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        return (
          result.unique_values?.child?.buckets?.map((bucket: any) => ({
            field: bucket.key,
            label: bucket.key,
            count: bucket.doc_count,
          })) ?? []
        );
      },
    },
  },
  "metadata.user_id": {
    name: "User ID",
    urlKey: "user_id",
    query: (values) => ({
      terms: { "metadata.user_id": values },
    }),
    listMatch: {
      aggregation: (query) => ({
        unique_values: {
          filter: query
            ? {
                prefix: {
                  "metadata.user_id": {
                    value: query,
                    case_insensitive: true,
                  },
                },
              }
            : {
                match_all: {},
              },
          aggs: {
            child: {
              terms: {
                field: "metadata.user_id",
                size: 100,
                order: { _key: "asc" },
              },
            },
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        return (
          result.unique_values?.child?.buckets?.map((bucket: any) => ({
            field: bucket.key,
            label: bucket.key,
            count: bucket.doc_count,
          })) ?? []
        );
      },
    },
  },
  "metadata.thread_id": {
    name: "Thread ID",
    urlKey: "thread_id",
    query: (values) => ({
      terms: { "metadata.thread_id": values },
    }),
    listMatch: {
      aggregation: (query) => ({
        unique_values: {
          filter: query
            ? {
                prefix: {
                  "metadata.thread_id": {
                    value: query,
                    case_insensitive: true,
                  },
                },
              }
            : {
                match_all: {},
              },
          aggs: {
            child: {
              terms: {
                field: "metadata.thread_id",
                size: 100,
                order: { _key: "asc" },
              },
            },
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        return (
          result.unique_values?.child?.buckets?.map((bucket: any) => ({
            field: bucket.key,
            label: bucket.key,
            count: bucket.doc_count,
          })) ?? []
        );
      },
    },
  },
  "metadata.customer_id": {
    name: "Customer ID",
    urlKey: "customer_id",
    query: (values) => ({
      terms: { "metadata.customer_id": values },
    }),
    listMatch: {
      aggregation: (query) => ({
        unique_values: {
          filter: query
            ? {
                prefix: {
                  "metadata.customer_id": {
                    value: query,
                    case_insensitive: true,
                  },
                },
              }
            : {
                match_all: {},
              },
          aggs: {
            child: {
              terms: {
                field: "metadata.customer_id",
                size: 100,
                order: { _key: "asc" },
              },
            },
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        return (
          result.unique_values?.child?.buckets?.map((bucket: any) => ({
            field: bucket.key,
            label: bucket.key,
            count: bucket.doc_count,
          })) ?? []
        );
      },
    },
  },
  "metadata.labels": {
    name: "Label",
    urlKey: "labels",
    query: (values) => ({
      terms: { "metadata.labels": values },
    }),
    listMatch: {
      aggregation: (query) => ({
        unique_values: {
          filter: query
            ? {
                prefix: {
                  "metadata.labels": {
                    value: query,
                    case_insensitive: true,
                  },
                },
              }
            : {
                match_all: {},
              },
          aggs: {
            child: {
              terms: {
                ...(query
                  ? {
                      script: {
                        source: `
                          for (label in doc['trace.metadata.labels']) {
                            if (label.toLowerCase().startsWith(params.query.toLowerCase())) {
                              return label;
                            }
                          }
                          return null;
                        `,
                        params: {
                          query: query,
                        },
                      },
                    }
                  : { field: "metadata.labels" }),
                size: 100,
                order: { _key: "asc" },
              },
            },
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        return (
          result.unique_values?.child?.buckets?.map((bucket: any) => ({
            field: bucket.key,
            label: bucket.key,
            count: bucket.doc_count,
          })) ?? []
        );
      },
    },
  },
  "traces.error": {
    name: "Contains Error",
    urlKey: "has_error",
    query: (values) => {
      if (values.includes("true") && !values.includes("false")) {
        return {
          term: {
            "error.has_error": true,
          },
        };
      } else if (values.includes("false") && !values.includes("true")) {
        return {
          bool: {
            must_not: {
              term: {
                "error.has_error": true,
              },
            } as QueryDslQueryContainer,
          } as QueryDslBoolQuery,
        };
      } else {
        return {
          match_all: {},
        };
      }
    },
    listMatch: {
      aggregation: (_query) => ({
        unique_values: {
          terms: {
            field: "error.has_error",
            size: 2,
            order: { _key: "asc" },
            missing: false,
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        return (
          result.unique_values?.buckets?.map((bucket: any) => ({
            field: bucket.key ? "true" : "false",
            label: bucket.key
              ? "Messages with error"
              : "Messages without error",
            count: bucket.doc_count,
          })) ?? []
        );
      },
    },
  },
  "spans.type": {
    name: "Span Type",
    urlKey: "span_type",
    query: (values) => ({
      nested: {
        path: "spans",
        query: {
          terms: { "spans.type": values },
        },
      },
    }),
    listMatch: {
      aggregation: (query) => ({
        unique_values: {
          nested: { path: "spans" },
          aggs: {
            child: {
              filter: query
                ? {
                    prefix: {
                      "spans.type": {
                        value: query,
                        case_insensitive: true,
                      },
                    },
                  }
                : {
                    match_all: {},
                  },
              aggs: {
                child: {
                  terms: {
                    field: "spans.type",
                    size: 100,
                    order: { _key: "asc" },
                  },
                },
              },
            },
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        return (
          result.unique_values?.child?.child?.buckets?.map((bucket: any) => ({
            field: bucket.key,
            label: bucket.key,
            count: bucket.doc_count,
          })) ?? []
        );
      },
    },
  },
  "spans.model": {
    name: "Model",
    urlKey: "model",
    query: (values) => ({
      nested: {
        path: "spans",
        query: {
          terms: { "spans.model": values },
        },
      },
    }),
    listMatch: {
      aggregation: (query) => ({
        unique_values: {
          nested: { path: "spans" },
          aggs: {
            child: {
              filter: query
                ? {
                    prefix: {
                      "spans.model": {
                        value: query,
                        case_insensitive: true,
                      },
                    },
                  }
                : {
                    match_all: {},
                  },
              aggs: {
                child: {
                  terms: {
                    field: "spans.model",
                    size: 100,
                    order: { _key: "asc" },
                  },
                },
              },
            },
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        return (
          result.unique_values?.child?.child?.buckets?.map((bucket: any) => ({
            field: bucket.key,
            label: bucket.key,
            count: bucket.doc_count,
          })) ?? []
        );
      },
    },
  },
  "evaluations.evaluator_id": {
    name: "Contains Evaluation",
    urlKey: "evaluator_id",
    query: (values) => ({
      nested: {
        path: "evaluations",
        query: {
          terms: { "evaluations.evaluator_id": values },
        },
      },
    }),
    listMatch: {
      aggregation: (query) => ({
        unique_evaluator_ids: {
          nested: { path: "evaluations" },
          aggs: {
            child: {
              terms: {
                field: "evaluations.evaluator_id",
                size: 100,
                order: { _key: "asc" },
              },
              aggs: {
                labels: {
                  filter: query
                    ? {
                        prefix: {
                          "evaluations.name": {
                            value: query,
                            case_insensitive: true,
                          },
                        },
                      }
                    : {
                        match_all: {},
                      },
                  aggs: {
                    name: {
                      terms: {
                        field: "evaluations.name",
                        size: 1,
                      },
                    },
                    type: {
                      terms: {
                        field: "evaluations.type",
                        size: 1,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        return (
          result.unique_evaluator_ids?.child?.buckets
            ?.filter(
              (bucket: any) =>
                bucket.labels.type.buckets?.[0]?.key !== undefined
            )
            ?.map((bucket: any) => {
              const type: string = bucket.labels.type.buckets?.[0]?.key;
              const name: string = bucket.labels.name.buckets?.[0]?.key;
              const checkDefinition =
                AVAILABLE_EVALUATORS[type as EvaluatorTypes];

              return {
                field: bucket.key,
                label: `[${checkDefinition?.name ?? type ?? "custom"}] ${name}`,
                count: bucket.doc_count,
              };
            }) ?? []
        );
      },
    },
  },
  "evaluations.evaluator_id.guardrails_only": {
    name: "Contains Evaluation (guardrails only)",
    urlKey: "guardrail_evaluator_id",
    query: (values) => ({
      nested: {
        path: "evaluations",
        query: {
          terms: { "evaluations.evaluator_id": values },
        },
      },
    }),
    listMatch: {
      aggregation: (query) => ({
        unique_evaluator_ids: {
          nested: { path: "evaluations" },
          aggs: {
            child: {
              terms: {
                field: "evaluations.evaluator_id",
                size: 100,
                order: { _key: "asc" },
              },
              aggs: {
                labels: {
                  filter: query
                    ? {
                        prefix: {
                          "evaluations.name": {
                            value: query,
                            case_insensitive: true,
                          },
                        },
                      }
                    : {
                        match_all: {},
                      },
                  aggs: {
                    name: {
                      terms: {
                        field: "evaluations.name",
                        size: 1,
                      },
                    },
                    type: {
                      terms: {
                        field: "evaluations.type",
                        size: 1,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        return (
          result.unique_evaluator_ids?.child?.buckets
            ?.map((bucket: any) => {
              const type: string = bucket.labels.type.buckets?.[0]?.key;
              const name: string = bucket.labels.name.buckets?.[0]?.key;
              const checkDefinition =
                AVAILABLE_EVALUATORS[type as EvaluatorTypes];

              if (!checkDefinition?.isGuardrail) {
                return;
              }

              return {
                field: bucket.key,
                label: `[${checkDefinition?.name ?? type ?? "custom"}] ${name}`,
                count: bucket.doc_count,
              };
            })
            .filter((option: any) => option?.label !== undefined) ?? []
        );
      },
    },
  },
  "evaluations.passed": {
    name: "Evaluation Passed",
    urlKey: "evaluation_passed",
    single: true,
    requiresKey: {
      filter: "evaluations.evaluator_id.guardrails_only",
    },
    query: (values, key) => ({
      nested: {
        path: "evaluations",
        query: {
          bool: {
            must: [
              {
                term: {
                  "evaluations.evaluator_id": key,
                },
              },
              {
                terms: {
                  "evaluations.passed": values.map(
                    (value) => value === "true" || value === "1"
                  ),
                },
              },
            ] as QueryDslQueryContainer[],
          } as QueryDslBoolQuery,
        },
      },
    }),
    listMatch: {
      aggregation: (query, key) => ({
        unique_values: {
          nested: { path: "evaluations" },
          aggs: {
            child: {
              filter: {
                term: { "evaluations.evaluator_id": key },
              },
              aggs: {
                child: {
                  terms: {
                    field: "evaluations.passed",
                  },
                  aggs: {
                    child: {
                      filter: query
                        ? {
                            term: {
                              "evaluations.passed": query === "true",
                            },
                          }
                        : {
                            match_all: {},
                          },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        return (
          result.unique_values?.child?.child?.buckets?.map((bucket: any) => ({
            field: bucket.key,
            label: bucket.key ? "Passed" : "Failed",
            count: bucket.doc_count,
          })) ?? []
        );
      },
    },
  },
  "evaluations.score": {
    name: "Evaluation Score",
    urlKey: "evaluation_score",
    type: "numeric",
    single: true,
    requiresKey: {
      filter: "evaluations.evaluator_id",
    },
    query: (values, key) => ({
      nested: {
        path: "evaluations",
        query: {
          bool: {
            must: [
              {
                term: {
                  "evaluations.evaluator_id": key,
                },
              },
              {
                range: {
                  "evaluations.score": {
                    gte: values[0],
                    lte: values[1],
                  },
                },
              },
            ] as QueryDslQueryContainer[],
          } as QueryDslBoolQuery,
        },
      },
    }),
    listMatch: {
      aggregation: (query, key) => ({
        unique_values: {
          nested: { path: "evaluations" },
          aggs: {
            child: {
              filter: {
                term: { "evaluations.evaluator_id": key },
              },
              aggs: {
                child: {
                  stats: {
                    field: "evaluations.score",
                  },
                },
              },
            },
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        return [
          {
            field: result.unique_values?.child?.child?.min,
            label: "min",
            count: 0,
          },
          {
            field: result.unique_values?.child?.child?.max,
            label: "max",
            count: 0,
          },
        ];
      },
    },
  },
  "evaluations.state": {
    name: "Evaluation Execution State",
    urlKey: "evaluation_state",
    requiresKey: {
      filter: "evaluations.evaluator_id",
    },
    query: (values, key) => ({
      nested: {
        path: "evaluations",
        query: {
          bool: {
            must: [
              {
                term: {
                  "evaluations.evaluator_id": key,
                },
              },
              {
                terms: {
                  "evaluations.status": values,
                },
              },
            ] as QueryDslQueryContainer[],
          } as QueryDslBoolQuery,
        },
      },
    }),
    listMatch: {
      aggregation: (query, key) => ({
        unique_values: {
          nested: { path: "evaluations" },
          aggs: {
            child: {
              filter: {
                term: { "evaluations.evaluator_id": key },
              },
              aggs: {
                child: {
                  terms: {
                    field: "evaluations.status",
                  },
                  aggs: {
                    child: {
                      filter: query
                        ? {
                            term: {
                              "evaluations.status": query,
                            },
                          }
                        : {
                            match_all: {},
                          },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        return (
          result.unique_values?.child?.child?.buckets
            ?.filter(
              (bucket: any) => !["succeeded", "failed"].includes(bucket.key)
            )
            .map((bucket: any) => ({
              field: bucket.key,
              label: bucket.key,
              count: bucket.doc_count,
            })) ?? []
        );
      },
    },
  },
  "events.event_type": {
    name: "Event",
    urlKey: "event_type",
    single: true,
    query: (values) => ({
      nested: {
        path: "events",
        query: {
          terms: { "events.event_type": values },
        },
      },
    }),
    listMatch: {
      aggregation: (query) => ({
        unique_values: {
          nested: { path: "events" },
          aggs: {
            child: {
              filter: query
                ? {
                    prefix: {
                      "events.event_type": {
                        value: query,
                        case_insensitive: true,
                      },
                    },
                  }
                : {
                    match_all: {},
                  },
              aggs: {
                child: {
                  terms: {
                    field: "events.event_type",
                    size: 100,
                    order: { _key: "asc" },
                  },
                },
              },
            },
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        return (
          result.unique_values?.child?.child?.buckets?.map((bucket: any) => ({
            field: bucket.key,
            label: bucket.key,
            count: bucket.doc_count,
          })) ?? []
        );
      },
    },
  },
  "events.metrics.key": {
    name: "Metric",
    urlKey: "event_metric",
    single: true,
    requiresKey: {
      filter: "events.event_type",
    },
    query: (values, key) => ({
      nested: {
        path: "events",
        query: {
          bool: {
            must: [
              {
                term: { "events.event_type": key ?? "" },
              },
              {
                nested: {
                  path: "events.metrics",
                  query: {
                    terms: { "events.metrics.key": values },
                  },
                },
              },
            ] as QueryDslQueryContainer[],
          } as QueryDslBoolQuery,
        },
      },
    }),
    listMatch: {
      aggregation: (query, key) => ({
        unique_values: {
          nested: { path: "events" },
          aggs: {
            child: {
              filter: {
                term: { "events.event_type": key },
              },
              aggs: {
                child: {
                  nested: {
                    path: "events.metrics",
                  },
                  aggs: {
                    child: {
                      filter: query
                        ? {
                            prefix: {
                              "events.metrics.key": {
                                value: query,
                                case_insensitive: true,
                              },
                            },
                          }
                        : {
                            match_all: {},
                          },
                      aggs: {
                        child: {
                          terms: {
                            field: "events.metrics.key",
                            size: 100,
                            order: { _key: "asc" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        return (
          result.unique_values?.child?.child?.child?.child?.buckets?.map(
            (bucket: any) => ({
              field: bucket.key,
              label: bucket.key,
              count: bucket.doc_count,
            })
          ) ?? []
        );
      },
    },
  },
  "events.metrics.value": {
    name: "Event Metric",
    urlKey: "event_metric_value",
    single: true,
    type: "numeric",
    requiresKey: {
      filter: "events.event_type",
    },
    requiresSubkey: {
      filter: "events.metrics.key",
    },
    query: (values, key, subkey) => ({
      nested: {
        path: "events",
        query: {
          bool: {
            must: [
              {
                term: { "events.event_type": key ?? "" },
              },
              {
                nested: {
                  path: "events.metrics",
                  query: {
                    bool: {
                      must: [
                        {
                          term: { "events.metrics.key": subkey },
                        },
                        {
                          range: {
                            "events.metrics.value": {
                              gte: values[0],
                              lte: values[1],
                            },
                          },
                        },
                      ] as QueryDslQueryContainer[],
                    } as QueryDslBoolQuery,
                  },
                },
              },
            ] as QueryDslQueryContainer[],
          } as QueryDslBoolQuery,
        },
      },
    }),
    listMatch: {
      aggregation: (query, key, subkey) => ({
        unique_values: {
          nested: { path: "events" },
          aggs: {
            child: {
              filter: {
                term: { "events.event_type": key },
              },
              aggs: {
                child: {
                  nested: {
                    path: "events.metrics",
                  },
                  aggs: {
                    child: {
                      filter: {
                        term: { "events.metrics.key": subkey },
                      },
                      aggs: {
                        child: {
                          stats: {
                            field: "events.metrics.value",
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        return [
          {
            field: Math.ceil(
              result.unique_values?.child?.child?.child?.child?.min
            ).toString(),
            label: "min",
            count: 0,
          },
          {
            field: Math.ceil(
              result.unique_values?.child?.child?.child?.child?.max
            ).toString(),
            label: "max",
            count: 0,
          },
        ];
      },
    },
  },
  "events.event_details.key": {
    name: "Event Detail",
    urlKey: "event_detail",
    requiresKey: {
      filter: "events.event_type",
    },
    query: (values) => ({
      nested: {
        path: "events.event_details",
        query: {
          nested: {
            path: "events",
            query: {
              terms: { "events.event_details.key": values },
            },
          },
        },
      },
    }),
    listMatch: {
      aggregation: (query, key) => ({
        unique_values: {
          nested: { path: "events" },
          aggs: {
            child: {
              filter: {
                term: { "events.event_type": key },
              },
              aggs: {
                child: {
                  nested: {
                    path: "events.event_details",
                  },
                  aggs: {
                    child: {
                      filter: query
                        ? {
                            prefix: {
                              "events.metrics.key": {
                                value: query,
                                case_insensitive: true,
                              },
                            },
                          }
                        : {
                            match_all: {},
                          },
                      aggs: {
                        child: {
                          terms: {
                            field: "events.event_details.key",
                            size: 100,
                            order: { _key: "asc" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        return (
          result.unique_values?.child?.child?.child?.child?.buckets?.map(
            (bucket: any) => ({
              field: bucket.key,
              label: bucket.key,
              count: bucket.doc_count,
            })
          ) ?? []
        );
      },
    },
  },
};
