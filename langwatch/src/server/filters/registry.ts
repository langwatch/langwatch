import type {
  QueryDslBoolQuery,
  QueryDslQueryContainer,
} from "@elastic/elasticsearch/lib/api/types";

import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "../../server/evaluations/evaluators.generated";
import { reservedTraceMetadataSchema } from "../tracer/types";

import type { FilterDefinition, FilterField } from "./types";

/** Label values that represent pass/fail status rather than classification labels. */
const STATUS_LABEL_VALUES = ["succeeded", "failed"] as const;

/**
 * Shared label builder for evaluator_id extract functions.
 * Shows the evaluator TYPE name in brackets, then the instance name.
 */
function buildEvaluatorLabel(bucket: any): {
  type: string;
  name: string;
  label: string;
} {
  const type: string = bucket.labels.type.buckets?.[0]?.key;
  const name: string = bucket.labels.name.buckets?.[0]?.key;
  const checkDefinition = AVAILABLE_EVALUATORS[type as EvaluatorTypes];

  return {
    type,
    name,
    label: `[${checkDefinition?.name ?? type ?? "custom"}] ${name}`,
  };
}

/**
 * Factory for evaluator_id filter variants in the ES registry.
 *
 * All 5 variants share the same `query` function and nearly identical
 * `aggregation`/`extract`. They differ only in:
 * - name/urlKey
 * - An optional ES filter clause wrapping the terms aggregation
 *   (e.g. exists on "evaluations.passed", bool for label exclusion)
 * - An optional post-filter in extract (guardrails checks isGuardrail)
 * - The aggregation key name used for the intermediate bucket path
 */
function buildEvaluatorIdFilter({
  name,
  urlKey,
  esFilter,
  filterKey,
  extractPostFilter,
}: {
  name: string;
  urlKey: string;
  /** ES filter clause inserted between nested path and the terms agg. null = no extra filter. */
  esFilter: QueryDslQueryContainer | null;
  /** Key name for the intermediate aggregation bucket (e.g. "has_passed", "child"). */
  filterKey: string;
  /** Optional post-filter applied to extracted buckets (e.g. guardrails isGuardrail check). */
  extractPostFilter?: (bucket: any, type: string) => boolean;
}): FilterDefinition {
  const labelsAgg = (query: string | undefined) => ({
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
  });

  const termsAgg = (query: string | undefined) => ({
    terms: {
      field: "evaluations.evaluator_id",
      size: 10_000,
      order: { _key: "asc" as const },
    },
    aggs: labelsAgg(query),
  });

  return {
    name,
    urlKey,
    query: (values) => ({
      nested: {
        path: "evaluations",
        query: {
          terms: { "evaluations.evaluator_id": values },
        },
      },
    }),
    listMatch: {
      aggregation: (query) => {
        // When esFilter is set, wrap the terms agg inside a filter agg.
        // When null, the terms agg is placed directly under the filterKey.
        const innerAgg = esFilter
          ? {
              filter: esFilter,
              aggs: {
                child: termsAgg(query),
              },
            }
          : termsAgg(query);

        return {
          unique_evaluator_ids: {
            nested: { path: "evaluations" },
            aggs: {
              [filterKey]: innerAgg,
            },
          },
        };
      },
      extract: (result: Record<string, any>) => {
        // When esFilter is set, buckets are nested under filterKey.child;
        // when null, buckets are directly under filterKey.
        const buckets = esFilter
          ? result.unique_evaluator_ids?.[filterKey]?.child?.buckets
          : result.unique_evaluator_ids?.[filterKey]?.buckets;

        return (
          buckets
            ?.map((bucket: any) => {
              const { type, label } = buildEvaluatorLabel(bucket);

              if (extractPostFilter && !extractPostFilter(bucket, type)) {
                return undefined;
              }

              return {
                field: bucket.key,
                label,
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
  };
}

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
  "traces.origin": {
    name: "Origin",
    urlKey: "origin",
    query: (values) => {
      // Origin data only exists in ClickHouse; ES fallback uses metadata field
      const conditions: QueryDslQueryContainer[] = [];

      const nonApplicationValues = values.filter((v) => v !== "application");
      const hasApplication = values.includes("application");

      if (nonApplicationValues.length > 0) {
        conditions.push({
          terms: { "metadata.langwatch_origin": nonApplicationValues },
        });
      }

      if (hasApplication) {
        conditions.push({
          bool: {
            must_not: {
              exists: { field: "metadata.langwatch_origin" },
            },
          } as QueryDslBoolQuery,
        });
      }

      if (conditions.length === 1) {
        return conditions[0]!;
      }

      return {
        bool: {
          should: conditions,
          minimum_should_match: 1,
        } as QueryDslBoolQuery,
      };
    },
    listMatch: {
      aggregation: (_query) => ({
        unique_values: {
          terms: {
            field: "metadata.langwatch_origin",
            size: 100,
            order: { _key: "asc" },
            missing: "application",
          },
        },
      }),
      extract: (result: Record<string, any>) => {
        return (
          result.unique_values?.buckets?.map((bucket: any) => ({
            field: bucket.key_as_string ?? bucket.key ?? "application",
            label: bucket.key_as_string ?? bucket.key ?? "application",
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
  "evaluations.evaluator_id": buildEvaluatorIdFilter({
    name: "Contains Evaluation",
    urlKey: "evaluator_id",
    esFilter: null,
    filterKey: "child",
  }),
  "evaluations.evaluator_id.guardrails_only": buildEvaluatorIdFilter({
    name: "Contains Evaluation (guardrails only)",
    urlKey: "guardrail_evaluator_id",
    esFilter: null,
    filterKey: "child",
    extractPostFilter: (_bucket, type) => {
      const checkDefinition = AVAILABLE_EVALUATORS[type as EvaluatorTypes];
      return !!checkDefinition?.isGuardrail;
    },
  }),
  "evaluations.evaluator_id.has_passed": buildEvaluatorIdFilter({
    name: "Evaluators with Passed results",
    urlKey: "evaluator_id_has_passed",
    esFilter: { exists: { field: "evaluations.passed" } },
    filterKey: "has_passed",
  }),
  "evaluations.evaluator_id.has_score": buildEvaluatorIdFilter({
    name: "Evaluators with Score results",
    urlKey: "evaluator_id_has_score",
    esFilter: { exists: { field: "evaluations.score" } },
    filterKey: "has_score",
  }),
  "evaluations.evaluator_id.has_label": buildEvaluatorIdFilter({
    name: "Evaluators with Label results",
    urlKey: "evaluator_id_has_label",
    esFilter: {
      bool: {
        must: [{ exists: { field: "evaluations.label" } }],
        must_not: [
          {
            term: {
              "evaluations.label": "",
            },
          },
          {
            terms: {
              "evaluations.label": [...STATUS_LABEL_VALUES],
            },
          },
        ],
      } as QueryDslBoolQuery,
    },
    filterKey: "has_label",
  }),
  "evaluations.passed": {
    name: "Evaluation Passed",
    urlKey: "evaluation_passed",
    single: true,
    requiresKey: {
      filter: "evaluations.evaluator_id.has_passed",
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
      filter: "evaluations.evaluator_id.has_score",
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
      filter: "evaluations.evaluator_id.has_label",
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
              (bucket: any) => !(STATUS_LABEL_VALUES as readonly string[]).includes(bucket.key),
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
              (bucket: any) => !(STATUS_LABEL_VALUES as readonly string[]).includes(bucket.key),
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
};

const metadataKey = (key: string | undefined) => {
  const reservedKeys = Object.keys(reservedTraceMetadataSchema.shape);
  if (key && reservedKeys.includes(key)) {
    return `metadata.${key.replaceAll("·", ".")}`;
  }
  return `metadata.custom.${key?.replaceAll("·", ".")}`;
};
