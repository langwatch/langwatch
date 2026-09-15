/**
 * Procedures and hooks. Monitors read from contract; segment names are
 * cache-key load-bearing per ADR-004.
 */

import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { monitorTrpc } from "@langwatch/monitor-contract";

/** One experiment, as the legacy-wizard check reads it. */
export type MonitorExperimentRow = {
  id: string;
  slug: string;
  workbenchState: unknown;
};

/**
 * The procedures this package borrows from other namespaces. A procedure map
 * names STRINGS, so borrowing one costs nothing; `cross-feature` exempts a
 * contract by construction.
 */
type BorrowedProcedures = {
  organization: {
    /**
     * The organization graph the shell holds, fetched once for the document per
     * cache key.
     */
    getAll: {
      query: {
        input: { isDemo: boolean };
        output: Array<{
          id: string;
          name: string;
          teams: Array<{
            id: string;
            name: string;
            members?: Array<{
              userId: string;
              role: string;
              assignedRole?: { permissions?: unknown } | null;
            }>;
            projects: Array<{ id: string; name: string; slug: string }>;
          }>;
        }>;
      };
    };
  };

  experiments: {
    /**
     * Every experiment in the project, read for ONE answer: which monitors were
     * authored in the legacy evaluation wizard, whose Edit opens the workbench
     * rather than the online evaluation drawer.
     */
    getAllByProjectId: {
      query: { input: { projectId: string }; output: MonitorExperimentRow[] };
    };
  };
};

/** Everything this family calls: the declared namespace plus the borrowed two. */
export type MonitorApiMap = ContractApiMap<typeof monitorTrpc> & BorrowedProcedures;

/**
 * The monitor family's typed tRPC hooks. Same machinery, same transport and
 * same React Query cache as the application's `api` proxy — see
 * `createModuleApi` for why separate instances still share cache entries.
 */
export const monitorApi = createModuleApi<MonitorApiMap>();
