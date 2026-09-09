/**
 * The procedures this package calls, and the hooks that call them.
 *
 * The `monitors` half is READ OFF THE CONTRACT: `@langwatch/monitor-contract`
 * declares every procedure once, and `ContractApiMap` turns that declaration
 * into the shape these hooks are typed against, so the browser restates none
 * of it. The two borrowed namespaces below are still written by hand, because
 * their own contracts have not moved yet.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `monitors` and `experiments` are mount
 * points on the root router and tRPC hashes that path into the React Query
 * cache key; spell either differently and these hooks quietly stop sharing a
 * cache with the `api.monitors.*` call sites that have NOT moved — the online
 * evaluation drawer and the guardrails drawer among them, which is exactly how
 * the list refreshes after a drawer save.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/api/web`, and the
 * import below is the only one in the package.
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
     * The organization graph the application shell already holds.
     *
     * Asked by the FRONTEND FEATURE rather than by the screen — the screen is
     * handed the project and the replication targets through its host port —
     * and declared here because that feature runs on this package's transport.
     * Same input the shell asks with, so under tRPC's path-plus-input cache key
     * it is the same entry: the graph is fetched once for the document.
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
