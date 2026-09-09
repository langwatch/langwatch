/**
 * Procedures this package calls: derived namespaces from contract, borrowed ones
 * from features not yet split. Segment names are load-bearing for React Query cache.
 */

import type { automationTrpc, emailSuppressionTrpc } from "@langwatch/automation-contract";
import type { Monitor } from "@langwatch/monitor-contract";
import { createModuleApi, type ContractApiMap, type OutputsFromMap } from "@langwatch/api/web";

/** The project every automation procedure is scoped to. */
type ProjectScope = { projectId: string };

/** One automation as this vertical hands it over. */
export type AutomationRow = {
  id: string;
  projectId: string;
  name: string;
  action: string;
  triggerKind: string;
  actionParams: Record<string, unknown>;
  filters: Record<string, unknown> | string;
  filterQuery: string | null;
  active: boolean;
  pausedReason: string | null;
  pausedAt: string | null;
  message: string | null;
  alertType: string | null;
  customGraphId: string | null;
  notificationCadence: string;
  traceDebounceMs: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  checks?: Array<Monitor | undefined>;
  customGraph?: { id: string; name: string } | null;
};

/** One custom graph, narrowed to what this family renders. */
export type AutomationGraph = {
  id: string;
  name?: string;
  graph: unknown;
  trigger?: { id: string } | null;
};

export type AutomationDashboard = { id: string; name: string };

export type AutomationDataset = {
  id: string;
  name: string;
  columnTypes: unknown;
};

export type AutomationPreviewTrace = {
  traceId: string;
  name: string;
  timestamp: number;
  status: "ok" | "error" | "warning";
};

export type AutomationSlackChannel = {
  id: string;
  name: string;
  isPrivate?: boolean;
};

export type AutomationAnnotator = { id: string; name: string };

/** Procedures from features not yet split. */
type BorrowedProcedures = {
  graphs: {
    getAll: { query: { input: ProjectScope; output: AutomationGraph[] } };
    getById: {
      query: { input: ProjectScope & { id: string }; output: AutomationGraph | null };
    };
  };

  dashboards: {
    getAll: { query: { input: ProjectScope; output: AutomationDashboard[] } };
  };

  dataset: {
    getAll: { query: { input: ProjectScope; output: AutomationDataset[] } };
  };

  tracesV2: {
    list: {
      query: {
        input: ProjectScope & {
          timeRange: { from: number; to: number };
          sort: { columnId: string; direction: "asc" | "desc" };
          page: number;
          pageSize: number;
          query: string;
        };
        output: { totalHits: number; items: AutomationPreviewTrace[] };
      };
    };
  };

  team: {
    getTeamWithMembers: {
      query: {
        input: { slug: string; organizationId: string };
        output: {
          members: Array<{ user: { id: string; name: string | null; email: string | null } }>;
        } | null;
      };
    };
  };

  annotation: {
    getQueues: {
      query: {
        input: ProjectScope;
        output: Array<{ id: string; name: string }>;
      };
    };
  };

  organization: {
    getAll: {
      query: {
        input: { isDemo?: boolean };
        output: Array<{
          id: string;
          name: string;
          slug: string;
          teams: Array<{
            id: string;
            name: string;
            slug: string;
            projects: Array<{ id: string; name: string; slug: string }>;
          }>;
        }>;
      };
    };

    getOrganizationWithMembersAndTheirTeams: {
      query: {
        input: { organizationId: string };
        output: {
          members: Array<{ user: { id: string; name: string | null } }>;
        } | null;
      };
    };
  };
};

/** Everything this family calls: the declared namespaces plus the borrowed six. */
export type AutomationApiMap = ContractApiMap<typeof automationTrpc> &
  ContractApiMap<typeof emailSuppressionTrpc> &
  BorrowedProcedures;

/**
 * The automations family's typed tRPC hooks. Internal by convention - hooks
 * here call it, other packages call the hooks. Exported only so
 * `screens/automations` can mount `automationApi.Provider`.
 */
export const automationApi = createModuleApi<AutomationApiMap>();

/** Every procedure's output, addressed the way the screen already addresses it. */
export type RouterOutputs = OutputsFromMap<AutomationApiMap>;

/** The name the screen calls it by. */
export const api = automationApi;
