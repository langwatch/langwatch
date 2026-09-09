/**
 * Procedures this package calls: derived namespaces from contract, borrowed
 * ones from features not yet split. Segment names are load-bearing for
 * React Query cache.
 */

import type { analyticsTrpc, analyticsLwqlTrpc } from "@langwatch/analytics-contract";
import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";

import type { FilterField } from "../model/analytics-filter-definition.ts";
import type { FilterParam } from "../model/analytics-filter-params.ts";

/** The project every analytics procedure is scoped to. */
type ProjectScope = { projectId: string };

/** Why the workbench is not available, when it is not. */
export type LangWatchQLUnavailableReason = "disabled" | "unprovisioned";

/**
 * A period, as a caller SENDS it. Not the parsed shape: the wire bound
 * accepts a string, a number or a Date and coerces.
 */
export type LangWatchQLTimeWindowInput = {
  start: string | number | Date;
  end: string | number | Date;
};

export type LangWatchQLAvailability = {
  readonly available: boolean;
  readonly reason?: LangWatchQLUnavailableReason;
};

/**
 * The window and narrowing every charted read takes. ProjectScope plus
 * dates, filters and optional query narrowing.
 */
export type AnalyticsReadScope = ProjectScope & {
  startDate: number;
  endDate: number;
  filters: Partial<Record<FilterField, FilterParam>>;
  query?: string;
  traceIds?: string[];
  negateFilters?: boolean;
};

/** One stored builder chart: Graph plus kind discriminator. */
export type StoredGraph = {
  kind: "builder";
  [key: string]: unknown;
};

/** The alert authored against a chart. */
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

/** One option a filter's value picker offers, with count. */
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

/** A subtopic also names the topic it sits under. */
export type AnalyticsSubtopicCount = AnalyticsTopicCount & {
  parentId?: string | null;
};

/** One online evaluation, as the evaluations page reads it. */
export type AnalyticsMonitorSummary = {
  id: string;
  name: string;
  checkType: string;
  enabled: boolean;
};

type BorrowedProcedures = {
  analytics: {
    /** Stored workbench charts not yet split from analytics. */
    savedWorkbenchCharts: {
      getAll: {
        query: { input: ProjectScope; output: unknown[] };
      };
      getById: {
        query: { input: ProjectScope & { id: string }; output: unknown };
      };
      create: {
        mutation: {
          input: ProjectScope & { name: string; definition: unknown };
          output: unknown;
        };
      };
      update: {
        mutation: {
          input: ProjectScope & { id: string; name?: string; definition?: unknown };
          output: unknown;
        };
      };
      run: {
        mutation: {
          input: ProjectScope & {
            id: string;
            timeWindow?: LangWatchQLTimeWindowInput;
            granularitySeconds?: unknown;
            onBudgetOverflow?: "refuse" | "coarsen";
          };
          output: unknown;
        };
      };
      delete: {
        mutation: { input: ProjectScope & { id: string }; output: { success: true } };
      };
    };
  };
  dashboards: {
    getAll: { query: { input: ProjectScope; output: unknown[] } };
    getById: {
      query: {
        input: ProjectScope & { dashboardId: string };
        output: unknown;
      };
    };
    create: {
      mutation: { input: ProjectScope & { name: string }; output: unknown };
    };
    rename: {
      mutation: {
        input: ProjectScope & { dashboardId: string; name: string };
        output: unknown;
      };
    };
    delete: {
      mutation: { input: ProjectScope & { dashboardId: string }; output: unknown };
    };
    reorderDashboards: {
      mutation: {
        input: ProjectScope & { dashboardIds: string[] };
        output: { success: true };
      };
    };
    getOrCreateFirst: {
      query: { input: ProjectScope; output: unknown };
    };
  };
  graphs: {
    getAll: {
      query: {
        input: ProjectScope & { dashboardId?: string };
        output: unknown[];
      };
    };
    getById: {
      query: {
        input: ProjectScope & { id: string };
        output: unknown;
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
        output: unknown;
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
        output: unknown;
      };
    };
    delete: {
      mutation: { input: ProjectScope & { id: string }; output: unknown };
    };
    updateLayout: {
      mutation: {
        input: ProjectScope & { graphId: string } & Record<string, unknown>;
        output: unknown;
      };
    };
    batchUpdateLayouts: {
      mutation: {
        input: ProjectScope & { layouts: Array<{ graphId: string } & Record<string, unknown>> };
        output: { success: true };
      };
    };
  };
  traces: {
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
  organization: {
    getAll: {
      query: {
        input: { isDemo?: boolean };
        output: unknown;
      };
    };
  };
  licenseEnforcement: {
    checkLimit: {
      query: {
        input: { projectId: string; limitType: string };
        output: { withinLimit: boolean };
      };
    };
  };
  monitors: {
    getAllForProject: {
      query: { input: ProjectScope; output: AnalyticsMonitorSummary[] };
    };
  };
};

export type AnalyticsApiMap = ContractApiMap<typeof analyticsTrpc> &
  ContractApiMap<typeof analyticsLwqlTrpc> &
  BorrowedProcedures;

/**
 * The analytics family's typed tRPC hooks. Same machinery, same transport
 * and same React Query cache as the application's `api` proxy. Exported
 * from screens/analytics only so the process shell can mount Provider.
 */
export const analyticsApi = createModuleApi<AnalyticsApiMap>();
