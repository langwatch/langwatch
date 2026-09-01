/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as `gateway-api.ts`,
 * `governance-api.ts`, `automation-api.ts`, `ops-api.ts`, `agent-api.ts` and
 * `data-retention-api.ts` say of their own maps: the procedures are mounted by
 * the process out of `@langwatch/dataset-server`, which a web package may not
 * import even for a type, and the router type does not exist until a process
 * instantiates it. Emitting this file from the mounted router is the fix;
 * writing it by hand is the interim, and it is honest only because every
 * payload below is `@langwatch/dataset-contract`'s own.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `dataset`, `datasetRecord`, `limits`,
 * `licenseEnforcement` and `organization` are mount points on the root router,
 * and tRPC hashes that path into the React Query cache key; spell one
 * differently and these hooks quietly stop sharing a cache with the
 * `api.dataset.*` call sites that have not moved — the upload drawer, the
 * workbench, the studio's dataset modal and the prompt demonstrations are all
 * still such call sites.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package. Recorded here so the finding it
 * raises is a decision rather than a surprise.
 */

import type {
  Dataset,
  DatasetColumns,
  DatasetNameResult,
  DatasetPage,
  DatasetRecord,
  DatasetRecordInput,
  DatasetRecordMutationResult,
  DatasetSummary,
} from "@langwatch/dataset-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

/** The project every dataset procedure is scoped to. */
type ProjectScope = { projectId: string };

/** One dataset inside one project, named by id or by slug. */
type DatasetScope = ProjectScope & { datasetId: string };

/**
 * A dataset and every record the editor's byte budget allowed.
 *
 * The whole-dataset read the paged editor replaced; still used by the CSV
 * append flow, which needs the existing entries in order to refresh them, and
 * by the CSV download.
 */
type DatasetWithRecordsRead = Dataset & {
  datasetRecords: DatasetRecord[];
  truncated: boolean;
};

export type DatasetApiMap = {
  dataset: {
    /**
     * Every live dataset in the project, newest first.
     *
     * `DatasetSummary` is the contract's own list row and what `listDatasets`
     * returns, which is why the list screen types against it rather than
     * inferring the shape back out of the process's router.
     */
    getAll: {
      query: { input: ProjectScope; output: DatasetSummary[] };
    };

    /**
     * One dataset, or `null` for an archived or missing one.
     *
     * The detail screen reads it to decide the I-READY gate (ADR-032) and the
     * bulk upload rows poll it while the normalize job runs.
     */
    getById: {
      query: { input: DatasetScope; output: Dataset | null };
    };

    /** Creates a dataset, or replaces an existing one's columns. */
    upsert: {
      mutation: {
        input: ProjectScope & {
          datasetId?: string;
          name: string;
          columnTypes: DatasetColumns;
          datasetRecords?: DatasetRecordInput[];
        };
        output: Dataset;
      };
    };

    /** The slug a proposed name would get, and whether it is free. */
    validateDatasetName: {
      query: {
        input: ProjectScope & { proposedName: string; excludeDatasetId?: string };
        output: DatasetNameResult;
      };
    };

    /**
     * Archives a dataset, or restores the one the caller just archived.
     *
     * The two answers differ (`{ success }` against `{ success }` from a
     * restore), and the screen renders neither: it refetches the list. The
     * union is stated so a caller cannot read a field off only one of them.
     */
    deleteById: {
      mutation: {
        input: DatasetScope & { undo?: boolean };
        output: { success: true };
      };
    };

    /** The same dataset, records and all, in another project. */
    copy: {
      mutation: {
        input: { datasetId: string; sourceProjectId: string; projectId: string };
        output: Dataset;
      };
    };
  };

  datasetRecord: {
    /** One page of a dataset for the editor. `null` for a missing dataset. */
    listPaginated: {
      query: {
        input: DatasetScope & { page: number; limit: number };
        output: DatasetPage | null;
      };
    };

    /** The whole dataset, up to the editor's byte budget. */
    getAll: {
      query: { input: DatasetScope; output: DatasetWithRecordsRead };
    };

    /** The whole dataset with no byte budget, for the CSV export. */
    download: {
      mutation: { input: DatasetScope; output: DatasetWithRecordsRead };
    };

    /** Appends entries, for the CSV add-rows flow. */
    create: {
      mutation: {
        input: DatasetScope & { entries: DatasetRecordInput[] };
        output: DatasetRecord[];
      };
    };

    /** Replaces one record's whole entry. The autosave's update half. */
    update: {
      mutation: {
        input: DatasetScope & { recordId: string; updatedRecord: Record<string, unknown> };
        output: DatasetRecordMutationResult;
      };
    };

    /** Removes records by id. The autosave's delete half. */
    deleteMany: {
      mutation: {
        input: DatasetScope & { recordIds: string[] };
        output: { count: number };
      };
    };
  };

  limits: {
    /**
     * Declared for its INVALIDATION rather than its answer.
     *
     * Archiving a dataset frees usage against the plan, and the surfaces that
     * render the allowance ask this procedure. Nothing in this package renders
     * it; the list screen invalidates the entry so those surfaces re-ask.
     */
    getUsage: {
      query: {
        input: { organizationId: string };
        output: unknown;
      };
    };
  };

  licenseEnforcement: {
    /** Declared for its invalidation, exactly as `limits.getUsage` above. */
    checkLimit: {
      query: {
        input: { organizationId: string; limitType: string };
        output: { exceeded: boolean };
      };
    };
  };

  organization: {
    /**
     * The organization graph, narrowed to what a replication target needs.
     *
     * Read by the frontend feature that mounts these screens rather than by a
     * screen, and declared here so it lands on the same cache entry as the
     * application shell's own read of it: the graph is fetched once per document
     * however many halves of the product want it. The membership columns are
     * declared because the replication picker offers only the projects the
     * reader may create a dataset in, and that answer is per TEAM rather than
     * per current scope.
     */
    getAll: {
      query: {
        input: { isDemo?: boolean };
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
};

/**
 * The Datasets family's typed tRPC hooks. Same machinery, same transport and
 * same React Query cache as the application's `api` proxy — see
 * `createFeatureApi` for why separate instances still share cache entries.
 *
 * INTERNAL to this package by convention: hooks here call it, and screens call
 * the hooks. It is exported from `screens/datasets` only so the process shell
 * can mount `datasetApi.Provider`.
 */
export const datasetApi = createFeatureApi<DatasetApiMap>();
