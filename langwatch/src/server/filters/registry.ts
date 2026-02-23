import type {
  QueryDslBoolQuery,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";

import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "../../server/evaluations/evaluators.generated";
import { reservedTraceMetadataSchema } from "../tracer/types.generated";

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
                size: 10_000,
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
                size: 10_000,
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
                size: 10_000,
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
                size: 10_000,
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
                size: 10_000,
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
                          for (label in doc['metadata.labels']) {
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
                size: 10_000,
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
  "metadata.key": {
    name: "Metadata Key",
    urlKey: "metadata_key",
    single: true,
    query: (values) => ({
      // Exists is not working on OpenSearch flat_object type, what we lose here is querying too much, it doesn't help on the list search
      ...(process.env.IS_OPENSEARCH
        ? { match_all: {} }
        : {
            bool: {
              should: values.map((v) => ({
                exists: { field: metadataKey(v) },
              })),
              minimum_should_match: 1,
            },
          }),
    }),
    listMatch: {
      aggregation: (query) => ({
        unique_values: {
          filter: query
            ? {
                prefix: {
                  "metadata.all_keys": {
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
                          for (key in doc['metadata.all_keys']) {
                            if (key.toLowerCase().startsWith(params.query.toLowerCase())) {
                              return key;
                            }
                          }
                          return null;
                        `,
                        params: {
                          query: query,
                        },
                      },
                    }
                  : { field: "metadata.all_keys" }),
                size: 10_000,
                order: { _key: "asc" },
              },
            },
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        return (
          result.unique_values?.child?.buckets?.map((bucket: any) => ({
            field: bucket.key.replaceAll(".", "·"),
            label: bucket.key,
            count: bucket.doc_count,
          })) ?? []
        );
      },
    },
  },
  "metadata.value": {
    name: "Metadata",
    urlKey: "metadata",
    single: true,
    requiresKey: {
      filter: "metadata.key",
    },
    query: (values, key) => ({
      terms: { [metadataKey(key)]: values },
    }),
    listMatch: {
      aggregation: (query, key) => {
        // TODO: for opensearch, handle the case where the key is "foo.bar" but not in {"foo": {"bar": "baz"}}, but rather in {"foo.bar": "baz"}
        const nullChecksList = [];
        let keySoFar = "";
        for (const k of metadataKey(key).split(".")) {
          keySoFar += `.${k}`;
          nullChecksList.push(`params._source${keySoFar} != null`);
        }
        const nullChecks = nullChecksList.join(" && ");

        return {
          unique_values: {
            filter: {
              // Exists is not working on OpenSearch flat_object type, what we lose here is querying too much, it doesn't help on the list search
              ...(process.env.IS_OPENSEARCH
                ? { match_all: {} }
                : {
                    exists: {
                      field: metadataKey(key),
                    },
                  }),
            },
            aggs: {
              child: {
                filter: query
                  ? {
                      prefix: {
                        [metadataKey(key)]: {
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
                      ...(process.env.IS_OPENSEARCH
                        ? {
                            script: {
                              source: `if (${nullChecks}) { return params._source.${metadataKey(
                                key,
                              )}; } else { return null; }`,
                            },
                          }
                        : {
                            field: metadataKey(key),
                          }),
                      size: 10_000,
                      order: { _key: "asc" },
                    },
                  },
                },
              },
            },
          },
        };
      },
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
            label: bucket.key ? "Traces with error" : "Traces without error",
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
                    size: 10_000,
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
                    size: 10_000,
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
                size: 10_000,
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
          result.unique_evaluator_ids?.child?.buckets?.map((bucket: any) => {
            const type: string = bucket.labels.type.buckets?.[0]?.key;
            const name: string = bucket.labels.name.buckets?.[0]?.key;
            const checkDefinition =
              AVAILABLE_EVALUATORS[type as EvaluatorTypes];

            return {
              field: bucket.key,
              label: `[${
                name ?? checkDefinition?.name ?? type ?? "custom"
              }] ${name}`,
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
                size: 10_000,
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
            .filter(
              (option: any) =>
                option?.label !== undefined && option?.label !== null,
            ) ?? []
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
                    (value) => value === "true" || value === "1",
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
  "evaluations.label": {
    name: "Evaluation Label",
    urlKey: "evaluation_label",
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
                  "evaluations.label": values,
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
                    field: "evaluations.label",
                  },
                  aggs: {
                    child: {
                      filter: query
                        ? {
                            term: {
                              "evaluations.label": query,
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
              (bucket: any) => !["succeeded", "failed"].includes(bucket.key),
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
  "evaluations.state": {
    name: "Evaluation Execution State",
    urlKey: "evaluation_run",
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
              (bucket: any) => !["succeeded", "failed"].includes(bucket.key),
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
                    size: 10_000,
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
                            size: 10_000,
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
            }),
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
              result.unique_values?.child?.child?.child?.child?.min,
            ).toString(),
            label: "min",
            count: 0,
          },
          {
            field: Math.ceil(
              result.unique_values?.child?.child?.child?.child?.max,
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
                            size: 10_000,
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
            }),
          ) ?? []
        );
      },
    },
  },
  "annotations.hasAnnotation": {
    name: "Annotations",
    urlKey: "annotations",
    query: (values) => {
      if (values.includes("true") && !values.includes("false")) {
        return {
          exists: {
            field: "annotations",
          },
        };
      } else if (values.includes("false") && !values.includes("true")) {
        return {
          bool: {
            must_not: {
              exists: {
                field: "annotations",
              },
            },
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
          filters: {
            filters: {
              has_annotations: {
                exists: {
                  field: "annotations",
                },
              },
              no_annotations: {
                bool: {
                  must_not: {
                    exists: {
                      field: "annotations",
                    },
                  },
                },
              },
            },
          },
        },
      }),
      extract: (_result: Record<string, any>) => {
        return [
          {
            field: "true",
            label: "Has Annotation",
            count:
              _result.unique_values?.buckets?.has_annotations?.doc_count ?? 0,
          },
          {
            field: "false",
            label: "No Annotation",
            count:
              _result.unique_values?.buckets?.no_annotations?.doc_count ?? 0,
          },
        ];
      },
    },
  },
  "metadata.prompt_ids": {
    name: "Prompt ID",
    urlKey: "prompt_id",
    query: (values: string[]) => ({
      terms: { "metadata.prompt_ids": values },
    }),
    listMatch: {
      aggregation: (query: string | undefined) => ({
        unique_values: {
          filter: query
            ? {
                prefix: {
                  "metadata.prompt_ids": {
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
                field: "metadata.prompt_ids",
                size: 10_000,
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
  "sentiment.input_sentiment": {
    name: "Input Sentiment",
    urlKey: "sentiment",
    query: (values) => {
      const rangeQueries: QueryDslQueryContainer[] = [];
      for (const value of values) {
        if (value === "positive") {
          rangeQueries.push({
            range: {
              "input.satisfaction_score": {
                gte: 0.1,
              },
            },
          });
        } else if (value === "negative") {
          rangeQueries.push({
            range: {
              "input.satisfaction_score": {
                lte: -0.1,
              },
            },
          });
        } else if (value === "neutral") {
          rangeQueries.push({
            range: {
              "input.satisfaction_score": {
                gt: -0.1,
                lt: 0.1,
              },
            },
          });
        }
      }
      // Guard against empty or all-invalid values: return match_all as safe no-op filter
      if (rangeQueries.length === 0) {
        return { match_all: {} };
      }
      return {
        bool: {
          should: rangeQueries,
          minimum_should_match: 1,
        } as QueryDslBoolQuery,
      };
    },
    listMatch: {
      aggregation: () => ({
        sentiment_categories: {
          filters: {
            filters: {
              positive: {
                script: {
                  script: {
                    source:
                      "doc['input.satisfaction_score'].size() == 0 ? false : doc['input.satisfaction_score'].value >= 0.1",
                    lang: "painless",
                  },
                },
              },
              negative: {
                script: {
                  script: {
                    source:
                      "doc['input.satisfaction_score'].size() == 0 ? false : doc['input.satisfaction_score'].value <= -0.1",
                    lang: "painless",
                  },
                },
              },
              neutral: {
                script: {
                  script: {
                    source:
                      "doc['input.satisfaction_score'].size() == 0 ? false : (doc['input.satisfaction_score'].value < 0.1 && doc['input.satisfaction_score'].value > -0.1)",
                    lang: "painless",
                  },
                },
              },
            },
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        const buckets = result.sentiment_categories?.buckets ?? {};
        return [
          {
            field: "positive",
            label: "Positive",
            count: buckets.positive?.doc_count ?? 0,
          },
          {
            field: "negative",
            label: "Negative",
            count: buckets.negative?.doc_count ?? 0,
          },
          {
            field: "neutral",
            label: "Neutral",
            count: buckets.neutral?.doc_count ?? 0,
          },
        ];
      },
    },
  },
};

const metadataKey = (key: string | undefined) => {
  const reservedKeys = Object.keys(reservedTraceMetadataSchema.shape);
  if (key && reservedKeys.includes(key)) {
    return `metadata.${key.replaceAll("·", ".")}`;
  }
  return `metadata.custom.${key?.replaceAll("·", ".")}`;
};
