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
      terms: { "trace.metadata.topic_id": values },
    }),
    listMatch: {
      aggregation: (query) => ({
        unique_values: {
          filter: query
            ? {
                prefix: {
                  "trace.metadata.topic_id": {
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
                field: "trace.metadata.topic_id",
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
      terms: { "trace.metadata.subtopic_id": values },
    }),
    listMatch: {
      aggregation: (query) => ({
        unique_values: {
          filter: query
            ? {
                prefix: {
                  "trace.metadata.subtopic_id": {
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
                field: "trace.metadata.subtopic_id",
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
      terms: { "trace.metadata.user_id": values },
    }),
    listMatch: {
      aggregation: (query) => ({
        unique_values: {
          filter: query
            ? {
                prefix: {
                  "trace.metadata.user_id": {
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
                field: "trace.metadata.user_id",
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
      terms: { "trace.metadata.thread_id": values },
    }),
    listMatch: {
      aggregation: (query) => ({
        unique_values: {
          filter: query
            ? {
                prefix: {
                  "trace.metadata.thread_id": {
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
                field: "trace.metadata.thread_id",
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
      terms: { "trace.metadata.customer_id": values },
    }),
    listMatch: {
      aggregation: (query) => ({
        unique_values: {
          filter: query
            ? {
                prefix: {
                  "trace.metadata.customer_id": {
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
                field: "trace.metadata.customer_id",
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
      terms: { "trace.metadata.labels": values },
    }),
    listMatch: {
      aggregation: (query) => ({
        unique_values: {
          filter: query
            ? {
                prefix: {
                  "trace.metadata.labels": {
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
                field: "trace.metadata.labels",
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
  "trace_checks.check_id": {
    name: "Contains Evaluation",
    urlKey: "check_id",
    query: (values) => ({
      nested: {
        path: "trace_checks",
        query: {
          terms: { "trace_checks.check_id": values },
        },
      },
    }),
    listMatch: {
      aggregation: (query) => ({
        unique_check_ids: {
          nested: { path: "trace_checks" },
          aggs: {
            child: {
              terms: {
                field: "trace_checks.check_id",
                size: 100,
                order: { _key: "asc" },
              },
              aggs: {
                labels: {
                  filter: query
                    ? {
                        prefix: {
                          "trace_checks.check_name": {
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
                        field: "trace_checks.check_name",
                        size: 1,
                      },
                    },
                    type: {
                      terms: {
                        field: "trace_checks.check_type",
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
          result.unique_check_ids?.child?.buckets
            ?.map((bucket: any) => {
              const checkType: string = bucket.labels.type.buckets?.[0]?.key;
              const checkName: string = bucket.labels.name.buckets?.[0]?.key;
              const checkDefinition =
                AVAILABLE_EVALUATORS[checkType as EvaluatorTypes];

              return {
                field: bucket.key,
                label: `[${checkDefinition?.name ?? checkType}] ${checkName}`,
                count: bucket.doc_count,
              };
            })
            .filter((option: any) => option.label !== undefined) ?? []
        );
      },
    },
  },
  "trace_checks.check_id.guardrails_only": {
    name: "Contains Evaluation (guardrails only)",
    urlKey: "guardrail_check_id",
    query: (values) => ({
      nested: {
        path: "trace_checks",
        query: {
          terms: { "trace_checks.check_id": values },
        },
      },
    }),
    listMatch: {
      aggregation: (query) => ({
        unique_check_ids: {
          nested: { path: "trace_checks" },
          aggs: {
            child: {
              terms: {
                field: "trace_checks.check_id",
                size: 100,
                order: { _key: "asc" },
              },
              aggs: {
                labels: {
                  filter: query
                    ? {
                        prefix: {
                          "trace_checks.check_name": {
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
                        field: "trace_checks.check_name",
                        size: 1,
                      },
                    },
                    type: {
                      terms: {
                        field: "trace_checks.check_type",
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
          result.unique_check_ids?.child?.buckets
            ?.map((bucket: any) => {
              const checkType: string = bucket.labels.type.buckets?.[0]?.key;
              const checkName: string = bucket.labels.name.buckets?.[0]?.key;
              const checkDefinition =
                AVAILABLE_EVALUATORS[checkType as EvaluatorTypes];

              if (!checkDefinition?.isGuardrail) {
                return;
              }

              return {
                field: bucket.key,
                label: `[${checkDefinition?.name ?? checkType}] ${checkName}`,
                count: bucket.doc_count,
              };
            })
            .filter((option: any) => option?.label !== undefined) ?? []
        );
      },
    },
  },
  "trace_checks.passed": {
    name: "Evaluation Passed",
    urlKey: "evaluation_passed",
    single: true,
    requiresKey: {
      filter: "trace_checks.check_id.guardrails_only",
    },
    query: (values, key) => ({
      nested: {
        path: "trace_checks",
        query: {
          bool: {
            must: [
              {
                term: {
                  "trace_checks.check_id": key,
                },
              },
              {
                terms: {
                  "trace_checks.passed": values.map(
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
          nested: { path: "trace_checks" },
          aggs: {
            child: {
              filter: {
                term: { "trace_checks.check_id": key },
              },
              aggs: {
                child: {
                  terms: {
                    field: "trace_checks.passed",
                  },
                  aggs: {
                    child: {
                      filter: query
                        ? {
                            term: {
                              "trace_checks.passed": query === "true",
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
  "trace_checks.state": {
    name: "Evaluation Execution State",
    urlKey: "evaluation_state",
    requiresKey: {
      filter: "trace_checks.check_id",
    },
    query: (values, key) => ({
      nested: {
        path: "trace_checks",
        query: {
          bool: {
            must: [
              {
                term: {
                  "trace_checks.check_id": key,
                },
              },
              {
                terms: {
                  "trace_checks.status": values,
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
          nested: { path: "trace_checks" },
          aggs: {
            child: {
              filter: {
                term: { "trace_checks.check_id": key },
              },
              aggs: {
                child: {
                  terms: {
                    field: "trace_checks.status",
                  },
                  aggs: {
                    child: {
                      filter: query
                        ? {
                            term: {
                              "trace_checks.status": query,
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
    requiresKey: {
      filter: "events.event_type",
    },
    query: (values) => ({
      nested: {
        path: "events.metrics",
        query: {
          nested: {
            path: "events",
            query: {
              terms: { "events.metrics.key": values },
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
