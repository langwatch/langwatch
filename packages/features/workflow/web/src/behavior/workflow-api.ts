/**
 * The procedures the Workflows screens call, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as every other feature
 * family's map says of itself: the procedures are mounted by the process out of
 * `@langwatch/workflow-server`, which a web package may not import even for a
 * type, and the router type does not exist until a process instantiates one.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `workflow`, `optimization` and
 * `organization` are mount points on the root router and tRPC hashes that path
 * into the React Query cache key; spell one differently and these hooks quietly
 * stop sharing a cache with the `api.workflow.*` call sites that have NOT moved
 * — the optimization studio's, which is every one of them.
 *
 * THE ROW SHAPES ARE RESTATED RATHER THAN IMPORTED, and it is worth saying why.
 * `WorkflowListRow`, `WorkflowCopyRow` and `WorkflowCascadeArchiveResult` are
 * declared in `@langwatch/workflow-server`'s transport, not in the contract, and
 * a browser package may not name a server package even for a type. So these are
 * narrowed to the fields the two screens render, with the same names, and they
 * stop being restatements the day the contract declares them — the same promise
 * `@langwatch/data-retention-contract`'s snapshot makes about its own copy.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package.
 */

import type { StudioWorkflow } from "@langwatch/workflow-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

/** Where a workflow lives, as the copy lineage tooltip spells it out. */
export type WorkflowProjectPath = {
  id: string;
  name: string;
  team: { id: string; name: string; organization: { id: string; name: string } };
};

/** A listed workflow, narrowed to what the card renders. */
export type WorkflowListRow = {
  id: string;
  projectId: string;
  name: string;
  icon: string | null;
  description: string | null;
  updatedAt: Date;
  copiedFromWorkflowId: string | null;
  copiedFrom: { id: string; name: string; projectId: string; project: WorkflowProjectPath } | null;
  _count: { copiedWorkflows: number };
};

/**
 * One replica of a workflow, as the push dialog lists it.
 *
 * `fullPath` is composed by the TRANSPORT rather than here — the same
 * "Organization / Team / Project" string the replication picker builds — and
 * the list only ever contains replicas the caller may update, so there is no
 * permission flag to render.
 */
export type WorkflowCopyRow = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  teamName: string;
  organizationName: string;
  fullPath: string;
  hasPermission: boolean;
};

/** A related row the delete confirmation names before it is taken. */
export type WorkflowRelatedEntity = { id: string; name: string };

/**
 * What deleting a workflow would take with it.
 *
 * The confirmation names all three lists BEFORE the reader types "delete",
 * which is the whole reason the read exists: linked evaluators and agents are
 * ARCHIVED and every online evaluation built on those evaluators is DELETED,
 * and none of it is recoverable from this screen.
 */
export type WorkflowRelatedEntities = {
  evaluators: WorkflowRelatedEntity[];
  agents: WorkflowRelatedEntity[];
  monitors: WorkflowRelatedEntity[];
};

/** What the cascade actually did, which is what the confirmation reports back. */
export type WorkflowCascadeArchiveResult = {
  archivedEvaluatorsCount: number;
  archivedAgentsCount: number;
  deletedMonitorsCount: number;
};

/** The team graph the replication picker is derived from, as the shell reads it. */
export type WorkflowOrganizationGraph = {
  id: string;
  name: string;
  teams: {
    id: string;
    name: string;
    members?: { userId: string; role: string; assignedRole?: { permissions?: unknown } | null }[];
    projects: { id: string; name: string; slug: string }[];
  }[];
};

export type WorkflowApiMap = {
  workflow: {
    /** The project's workflows, newest edit first, with copy lineage redacted. */
    getAll: { query: { input: { projectId: string }; output: WorkflowListRow[] } };

    create: {
      mutation: {
        input: { projectId: string; dsl: StudioWorkflow; commitMessage: string };
        output: { workflow: { id: string } };
      };
    };

    copy: {
      mutation: {
        input: {
          workflowId: string;
          projectId: string;
          sourceProjectId: string;
          copyDatasets: boolean;
        };
        output: { workflow: { id: string } };
      };
    };

    archive: { mutation: { input: { workflowId: string; projectId: string }; output: unknown } };

    cascadeArchive: {
      mutation: {
        input: { workflowId: string; projectId: string };
        output: WorkflowCascadeArchiveResult;
      };
    };

    getRelatedEntities: {
      query: {
        input: { workflowId: string; projectId: string };
        output: WorkflowRelatedEntities;
      };
    };

    syncFromSource: {
      mutation: { input: { workflowId: string; projectId: string }; output: unknown };
    };

    getCopies: {
      query: { input: { workflowId: string; projectId: string }; output: WorkflowCopyRow[] };
    };

    pushToCopies: {
      mutation: {
        input: { workflowId: string; projectId: string; copyIds: string[] };
        output: { pushedTo: number; selectedCopies: number };
      };
    };
  };

  optimization: {
    /**
     * Null when nothing is published yet, which the chat address renders as
     * "workflow not found" rather than as a failure.
     */
    getPublishedWorkflow: {
      query: {
        input: { workflowId: string; projectId: string };
        output: { dsl: unknown } | null;
      };
    };

    /** Runs the published graph over the public endpoint and answers its JSON. */
    chat: {
      mutation: {
        input: {
          workflowId: string;
          projectId: string;
          inputMessages: Record<string, string>[];
        };
        output: unknown;
      };
    };
  };

  organization: {
    getAll: { query: { input: { isDemo: boolean }; output: WorkflowOrganizationGraph[] } };
  };
};

/**
 * The Workflows family's typed tRPC hooks. Same machinery, same transport and
 * same React Query cache as the application's `api` proxy — see
 * `createFeatureApi` for why separate instances still share cache entries.
 */
export const workflowApi = createFeatureApi<WorkflowApiMap>();
