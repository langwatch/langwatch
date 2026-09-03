/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as every other feature
 * family's map says of itself: the procedures are mounted by the process out of
 * `@langwatch/monitor-server`, which a web package may not import even for a
 * type, and the router type does not exist until a process instantiates one.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `monitors` and `experiments` are mount
 * points on the root router and tRPC hashes that path into the React Query
 * cache key; spell either differently and these hooks quietly stop sharing a
 * cache with the `api.monitors.*` call sites that have NOT moved — the online
 * evaluation drawer and the guardrails drawer among them, which is exactly how
 * the list refreshes after a drawer save.
 *
 * `experiments.getAllByProjectId` IS ANOTHER FEATURE'S PROCEDURE and costs
 * nothing: a procedure map names STRINGS. The screen reads it for one answer —
 * whether a monitor was authored in the legacy wizard, in which case Edit opens
 * the workbench instead of the drawer — and it decides that with
 * `@langwatch/experiment-contract`'s own predicate rather than restating the
 * shape. `cross-feature` exempts a contract by construction.
 *
 * `OnlineEvaluationPerformance` IS THE PRODUCER'S OWN TYPE:
 * `@langwatch/evaluation-contract` declares it and
 * `EvaluationService.getMonitorPerformance` is annotated with it.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package.
 */

import type { OnlineEvaluationPerformance } from "@langwatch/evaluation-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

/**
 * A monitor, as this list reads it.
 *
 * NARROWED FROM `@langwatch/monitor-contract`'s `Monitor` rather than named
 * whole, and the narrowing is the point: `parameters` is arbitrary JSON, the
 * preconditions are a legacy union, and the mappings are the trace family's
 * vocabulary. A list that names them would drag three schemas it never reads.
 */
export type MonitorListRow = {
  id: string;
  name: string;
  checkType: string;
  enabled: boolean;
  executionMode: string;
  experimentId: string | null;
};

/** One experiment, as the legacy-wizard check reads it. */
export type MonitorExperimentRow = {
  id: string;
  slug: string;
  workbenchState: unknown;
};

export type MonitorApiMap = {
  monitors: {
    /** Every online evaluation and guardrail configured in the project. */
    getAllForProject: {
      query: { input: { projectId: string }; output: MonitorListRow[] };
    };

    /**
     * The last seven days for every monitor at once.
     *
     * Sent unbatched (`skipBatch`) because it is a ClickHouse read behind a
     * page of Postgres reads, and a batch would hold the whole list behind it.
     */
    getPerformanceForProject: {
      query: {
        input: { projectId: string; timeZone: string };
        output: OnlineEvaluationPerformance[];
      };
    };

    /** Pauses or resumes one monitor. */
    toggle: {
      mutation: {
        input: { id: string; projectId: string; enabled: boolean };
        output: unknown;
      };
    };

    /** Deletes one monitor. */
    delete: {
      mutation: { input: { id: string; projectId: string }; output: unknown };
    };

    /** Replicates a monitor — and the evaluator behind it — into another project. */
    copy: {
      mutation: {
        input: { monitorId: string; projectId: string; sourceProjectId: string };
        output: unknown;
      };
    };
  };

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

/**
 * The monitor family's typed tRPC hooks. Same machinery, same transport and
 * same React Query cache as the application's `api` proxy — see
 * `createFeatureApi` for why separate instances still share cache entries.
 */
export const monitorApi = createFeatureApi<MonitorApiMap>();
