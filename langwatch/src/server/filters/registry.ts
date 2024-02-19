import type { FilterDefinition, FilterField } from "./types";

export const filters: { [K in FilterField]: FilterDefinition } = {
  "metadata.user_id": {
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
            }
          }
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
            }
          }
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
            }
          }
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
            }
          }
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
  "trace_checks.check_id": {
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
                    child: {
                      terms: {
                        field: "trace_checks.check_name",
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
            ?.map((bucket: any) => ({
              field: bucket.key,
              label: bucket.labels.child.buckets?.[0]?.key,
              count: bucket.doc_count,
            }))
            .filter((option: any) => option.label !== undefined) ?? []
        );
      },
    },
  },
  "events.event_type": {
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
    listMatch: {
      requiresKey: true,
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
    listMatch: {
      requiresKey: true,
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
