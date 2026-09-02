/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as `gateway-api.ts`,
 * `governance-api.ts`, `automation-api.ts`, `ops-api.ts`, `annotation-api.ts`
 * and `organization-api.ts` say of their own maps: the procedures are mounted
 * by the process out of `@langwatch/analytics-server`,
 * `@langwatch/dashboard-server`, `@langwatch/trace-server` and
 * `@langwatch/monitor-server`, which a web package may not import even for a
 * type, and the router type does not exist until a process instantiates it.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `analytics`, `dashboards`, `graphs`,
 * `traces` and `monitors` are mount points on the root router, and tRPC hashes
 * that path into the React Query cache key; spell one differently and these
 * hooks quietly stop sharing a cache with the `api.*` call sites that have not
 * moved — the project home page's traces overview renders the same
 * `analytics.getTimeseries` reads, and the trace explorer's own topic sidebar
 * invalidates the same `traces.getTopicCounts` entry.
 *
 * FOUR FEATURES ANSWER UNDER THESE FIVE NAMESPACES, AND THAT IS THE POINT OF
 * THE OWNERSHIP CALL RECORDED IN `screens/analytics/index.ts`. Addressing them
 * costs this package NOTHING but the strings below: `dashboards.*` and
 * `graphs.*` are `@langwatch/dashboard-server`'s, `traces.getTopicCounts` is
 * the trace family's and `monitors.getAllForProject` the monitor family's, and
 * none of those packages is imported here. Only the two CONTRACTS are — and a
 * contract is portable by construction, which is why `cross-feature` does not
 * fire on either.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package. Recorded here so the finding it
 * raises is a decision rather than a surprise.
 */

import type {
  AnalyticsFeedbacksResult,
  AnalyticsTopDocumentsResult,
  AnalyticsTimeseriesResult,
  LangWatchQLGranularityStep,
  LangWatchQLQueryResult,
  LangWatchQLSchema,
} from "@langwatch/analytics-contract";
import type {
  Dashboard,
  DashboardSummary,
  Graph,
  GraphLayout,
  SavedWorkbenchChart,
} from "@langwatch/dashboard-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

import type { FilterField } from "../model/analytics-filter-definition";
import type { FilterParam } from "../model/analytics-filter-params";

/** The project every analytics procedure is scoped to. */
type ProjectScope = { projectId: string };

/**
 * Why the workbench is not available, when it is not.
 *
 * Declared here rather than imported: the interface lives in
 * `@langwatch/analytics-server`, which a web package may not name even for a
 * type. Two refusals with different remedies — a switch this member's own
 * administrator can turn on, and a deployment with no restricted identity to
 * run a customer's statement as — and the page words each through the error
 * registry rather than writing its own sentence.
 */
export type LangWatchQLUnavailableReason = "disabled" | "unprovisioned";

/**
 * A period, as a caller SENDS it.
 *
 * Not `LangWatchQLTimeWindow`, which is the parsed shape: the wire bound
 * accepts a string, a number or a Date and coerces, and both callers here send
 * epoch milliseconds. Declaring the parsed type instead would refuse a payload
 * the endpoint accepts.
 */
export type LangWatchQLTimeWindowInput = {
  start: string | number | Date;
  end: string | number | Date;
};

export type LangWatchQLAvailability = {
  /** What the navigation entry and the page gate on. */
  readonly available: boolean;
  /** Absent when available. */
  readonly reason?: LangWatchQLUnavailableReason;
};

/**
 * The window and narrowing every charted read takes.
 *
 * `sharedFiltersInputSchema`'s shape, stated rather than imported: the schema
 * is `platform/app/src/server/analytics/types.ts`'s, a `~/server` module a
 * browser package may not name, and the wire is the two dates plus the filter
 * record either way.
 */
export type AnalyticsReadScope = ProjectScope & {
  startDate: number;
  endDate: number;
  filters: Partial<Record<FilterField, FilterParam>>;
  query?: string;
  traceIds?: string[];
  negateFilters?: boolean;
};

/**
 * One stored builder chart, as the wire hands it back.
 *
 * The contract's `Graph` plus the `kind` discriminator the transport stamps on
 * every row it serves. Two features share the stored-chart table and `kind` is
 * what keeps them apart; a grid that reads the wrong one draws the wrong editor.
 */
export type StoredGraph = Graph & { kind: "builder" };

/** The alert authored against a chart, as the report grid reads it. */
export type StoredGraphAlert = {
  enabled: boolean;
  threshold: number;
  operator: string;
  timePeriod: number;
  seriesName: string;
  type: string | null;
  triggerId: string;
};

/** A chart on a grid, with whatever alert names it. */
export type StoredGraphWithAlert = StoredGraph & {
  trigger: { id: string; active: boolean; alertType: string | null } | null;
};

/** One option a filter's value picker offers, with how many traces carry it. */
export type AnalyticsFilterOption = {
  field: string;
  label: string;
  count: number;
};

/** One topic or subtopic, as the topics sidebar lists it. */
export type AnalyticsTopicCount = {
  id: string;
  name: string;
  count: number;
};

/** A subtopic also names the topic it sits under, so the list can nest. */
export type AnalyticsSubtopicCount = AnalyticsTopicCount & { parentId?: string | null };

/**
 * One online evaluation, as the evaluations page reads it.
 *
 * Four fields of a much wider monitor row: which evaluator it runs, what it is
 * called, whether it is on, and its id — which is the key every one of the
 * page's per-evaluator series filters on.
 */
export type AnalyticsMonitorSummary = {
  id: string;
  name: string;
  checkType: string;
  enabled: boolean;
};

export type AnalyticsApiMap = {
  analytics: {
    /** The charted read: one bucketed series per metric the input names. */
    getTimeseries: {
      query: { input: Record<string, unknown>; output: AnalyticsTimeseriesResult };
    };

    /**
     * The values a filter can be narrowed to, with their counts.
     *
     * A field's OWN selection does not narrow the values offered for it — the
     * rule is the application's, so both doors ask it the same way.
     */
    dataForFilter: {
      query: {
        input: AnalyticsReadScope & { field: FilterField; key?: string; subkey?: string };
        output: { options: AnalyticsFilterOption[] };
      };
    };

    /** The retrieval documents most often pulled into a trace. */
    topUsedDocuments: {
      query: { input: AnalyticsReadScope; output: AnalyticsTopDocumentsResult };
    };

    /** Thumbs and written feedback left on traces in the range. */
    feedbacks: {
      query: { input: AnalyticsReadScope; output: AnalyticsFeedbacksResult };
    };

    lwql: {
      /** Whether the workbench is on for this project, and why it is not. */
      availability: {
        query: { input: ProjectScope; output: LangWatchQLAvailability };
      };

      /** The datasets and columns this member's permissions unlock. */
      schema: { query: { input: ProjectScope; output: LangWatchQLSchema } };

      /**
       * One submission.
       *
       * A MUTATION rather than a query, and it has to be: leaving the workbench
       * mid-statement must ABORT the request rather than ignore its answer, and
       * only the vanilla client's `mutate` takes a signal.
       */
      query: {
        mutation: {
          input: ProjectScope & {
            sql: string;
            parameters?: Readonly<Record<string, string | number | boolean | null>>;
            timeWindow?: LangWatchQLTimeWindowInput;
            granularitySeconds?: LangWatchQLGranularityStep;
          };
          output: LangWatchQLQueryResult;
        };
      };
    };

    /**
     * The stored workbench charts.
     *
     * `@langwatch/dashboard-server`'s, mounted under `analytics.*` because that
     * is the namespace a member reaches them through — the app's own mount file
     * says so in as many words. The path is what the cache keys on, so it is
     * spelled here the way the process mounts it.
     */
    savedWorkbenchCharts: {
      getAll: { query: { input: ProjectScope; output: SavedWorkbenchChart[] } };
      getById: {
        query: { input: ProjectScope & { id: string }; output: SavedWorkbenchChart };
      };
      create: {
        mutation: {
          input: ProjectScope & { name: string; definition: unknown };
          output: SavedWorkbenchChart;
        };
      };
      update: {
        mutation: {
          input: ProjectScope & { id: string; name?: string; definition?: unknown };
          output: SavedWorkbenchChart;
        };
      };
      /**
       * Runs a stored chart over the period the DASHBOARD is set to.
       *
       * `onBudgetOverflow: "coarsen"` is what a widget passes: its saved step
       * meets whatever range the reader picked, and refusing there would blank
       * a card whose owner changed nothing. The substitution comes back as
       * `coarsenedFromSeconds` rather than being applied silently.
       */
      run: {
        mutation: {
          input: ProjectScope & {
            id: string;
            timeWindow?: LangWatchQLTimeWindowInput;
            granularitySeconds?: LangWatchQLGranularityStep;
            onBudgetOverflow?: "refuse" | "coarsen";
          };
          output: LangWatchQLQueryResult;
        };
      };
      delete: {
        mutation: { input: ProjectScope & { id: string }; output: { success: true } };
      };
    };
  };

  dashboards: {
    /** Every dashboard in the project, with how many builder graphs sit on it. */
    getAll: { query: { input: ProjectScope; output: DashboardSummary[] } };
    /** One dashboard with its graphs, in grid order. */
    getById: {
      query: {
        input: ProjectScope & { dashboardId: string };
        output: Dashboard & { graphs: Graph[] };
      };
    };
    create: {
      mutation: { input: ProjectScope & { name: string }; output: Dashboard };
    };
    rename: {
      mutation: {
        input: ProjectScope & { dashboardId: string; name: string };
        output: Dashboard;
      };
    };
    delete: {
      mutation: { input: ProjectScope & { dashboardId: string }; output: Dashboard };
    };
    reorderDashboards: {
      mutation: {
        input: ProjectScope & { dashboardIds: string[] };
        output: { success: true };
      };
    };
    /**
     * The project's first dashboard, created on demand.
     *
     * So a reader who has never made one still lands on a grid they can drop a
     * chart onto, rather than on an empty state that asks them to name a thing
     * they have no opinion about yet.
     */
    getOrCreateFirst: { query: { input: ProjectScope; output: Dashboard } };
  };

  /**
   * The stored builder charts.
   *
   * `@langwatch/dashboard-server`'s, addressed by path. THE PAYLOAD CROSSES AS
   * A STRING, which is not a mistake to tidy: `graph` is JSON on the wire and
   * the dashboard contract deliberately types the stored value as an opaque
   * record — it does not know what a custom graph IS, which is exactly why the
   * ownership call in `screens/analytics/index.ts` puts these keys here.
   */
  graphs: {
    /** Every graph on a dashboard, each with the alert authored against it. */
    getAll: {
      query: {
        input: ProjectScope & { dashboardId?: string };
        output: StoredGraphWithAlert[];
      };
    };
    /** One graph, with its filters checked back against the live catalogue. */
    getById: {
      query: {
        input: ProjectScope & { id: string };
        output: StoredGraph & {
          filters?: Record<string, string[] | Record<string, string[]>>;
          alert?: StoredGraphAlert;
        };
      };
    };
    create: {
      mutation: {
        input: ProjectScope & {
          name: string;
          graph: string;
          filterParams?: { filters?: Record<string, unknown> };
          dashboardId?: string;
          gridColumn?: number;
          gridRow?: number;
          colSpan?: number;
          rowSpan?: number;
        };
        output: StoredGraph;
      };
    };
    updateById: {
      mutation: {
        input: ProjectScope & {
          graphId: string;
          name: string;
          graph: string;
          filterParams?: { filters?: Record<string, unknown> };
        };
        output: StoredGraph;
      };
    };
    delete: {
      mutation: { input: ProjectScope & { id: string }; output: StoredGraph };
    };
    updateLayout: {
      mutation: {
        input: ProjectScope & { graphId: string } & GraphLayout;
        output: StoredGraph;
      };
    };
    batchUpdateLayouts: {
      mutation: {
        input: ProjectScope & { layouts: Array<{ graphId: string } & GraphLayout> };
        output: { success: true };
      };
    };
  };

  traces: {
    /** The topic sidebar's counts, already resolved to names. */
    getTopicCounts: {
      query: {
        input: AnalyticsReadScope;
        output: {
          topicCounts: AnalyticsTopicCount[];
          subtopicCounts: AnalyticsSubtopicCount[];
        };
      };
    };
  };

  /**
   * The organization graph, read for one thing: which project the address is
   * about, and whether it has ever received a trace.
   *
   * Asked with the same input the application shell asks with, so under tRPC's
   * path-plus-input cache key it is the SAME entry — the graph is fetched once
   * for the document however many halves of the product want it.
   */
  organization: {
    getAll: {
      query: {
        input: { isDemo?: boolean };
        output: Array<{
          id: string;
          name: string;
          teams: Array<{
            id: string;
            name: string;
            projects: Array<{
              id: string;
              name: string;
              slug: string;
              firstMessage?: boolean | null;
            }>;
          }>;
        }>;
      };
    };
  };

  /**
   * The plan allowance a dashboard counts against.
   *
   * ONE PROCEDURE OF ANOTHER FEATURE'S, declared here rather than reached
   * through `useInvalidateProcedure`: deleting a dashboard frees an allowance
   * the licensing feature counts, and a typed invalidation is a compile error
   * when the path changes where the string escape hatch is a silent no-op.
   * `@langwatch/enterprise-licensing-server` is not imported — a procedure map
   * names strings, which is the whole reason addressing it is free.
   */
  licenseEnforcement: {
    checkLimit: {
      query: {
        input: { projectId: string; limitType: string };
        output: { withinLimit: boolean };
      };
    };
  };

  monitors: {
    /** Every monitor configured on the project, for the evaluations page. */
    getAllForProject: {
      query: { input: ProjectScope; output: AnalyticsMonitorSummary[] };
    };
  };
};

/**
 * The analytics family's typed tRPC hooks. Same machinery, same transport and
 * same React Query cache as the application's `api` proxy — see
 * `createFeatureApi` for why separate instances still share cache entries.
 *
 * INTERNAL to this package by convention: hooks here call it, and screens call
 * the hooks. It is exported from `screens/analytics` only so the process shell
 * can mount `analyticsApi.Provider`.
 */
export const analyticsApi = createFeatureApi<AnalyticsApiMap>();
