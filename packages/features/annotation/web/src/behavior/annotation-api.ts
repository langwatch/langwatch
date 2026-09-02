/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as `gateway-api.ts`,
 * `governance-api.ts`, `automation-api.ts`, `ops-api.ts`, `agent-api.ts`,
 * `dataset-api.ts` and `authz-api.ts` say of their own maps: the procedures are
 * mounted by the process out of `@langwatch/annotation-server`, which a web
 * package may not import even for a type, and the router type does not exist
 * until a process instantiates it. Emitting this file from the mounted router
 * is the fix; writing it by hand is the interim, and it is honest only because
 * every payload below is a contract's own or a shape this package already
 * declares for itself.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `annotation`, `annotationScore`,
 * `traces`, `organization`, `project` and `personalWorkspaceFeatures` are mount
 * points on the root router, and tRPC hashes that path into the React Query cache key;
 * spell one differently and these hooks quietly stop sharing a cache with the
 * `api.annotation.*` call sites that have not moved — the annotation queue
 * walker (`/annotations/my-queue`), the trace drawer's annotation rail, the
 * trace table's annotations column and the queue drawer are all still such call
 * sites, and every one of them invalidates the same four count entries this
 * package's mutations do.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package. Recorded here so the finding it
 * raises is a decision rather than a surprise.
 */

import type {
  AnnotationQueueDetail,
  AnnotationQueueListEntry,
  AnnotationQueueRecord,
  AnnotationScore,
} from "@langwatch/annotation-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";
import type { AnnotationTrace, AnnotationWithUser } from "../model/annotation-row";

/** The project every annotation procedure is scoped to. */
type ProjectScope = { projectId: string };

/**
 * One row of the queue reads, as the list actually reads it.
 *
 * The procedure returns a Prisma row enriched with its trace and every
 * annotation on it; these are the fields `queueItemsToRows` names, and stating
 * more of them here would be a second, drifting description of a select this
 * package does not own.
 */
export type AnnotationQueueItemRead = {
  id: string;
  traceId: string;
  annotationQueueId: string | null;
  doneAt: Date | null;
  createdAt: Date | null;
  createdByUser: { id: string; name: string | null; image: string | null } | null;
  trace: AnnotationTrace | null;
  annotations: AnnotationWithUser[];
};

/** One entry of the sidebar's queue list, with the work still waiting on it. */
export type AnnotationQueueBadge = {
  id: string;
  name: string;
  slug: string;
  pendingCount: number;
};

/** A member of the organization, as the participants picker lists them. */
export type AnnotationOrganizationMember = {
  user: { id: string; name: string | null; image: string | null };
};

export type AnnotationApiMap = {
  annotation: {
    /**
     * One page of the reviewer's queue work.
     *
     * `showQueueAndUser` widens it from the reviewer's own items to every queue
     * they are a member of, which is what the Inbox is; `queueId` narrows it to
     * one queue. `allQueueItems` takes the paging off and is the walker's read,
     * not a list's.
     */
    getOptimizedAnnotationQueues: {
      query: {
        input: ProjectScope & {
          selectedAnnotations: string;
          pageSize: number;
          pageOffset: number;
          queueId: string;
          showQueueAndUser: boolean;
          allQueueItems: boolean;
          startDate?: Date;
          endDate?: Date;
        };
        output: {
          assignedQueueItems: AnnotationQueueItemRead[];
          totalCount: number;
        };
      };
    };

    /**
     * Every annotation in the project inside a date range, newest first.
     *
     * ONE ROW PER COMMENT, anchored ones included: a reviewer who marked six
     * spans of one trace said six things, and the All Annotations page groups
     * them by trace rather than asking the server to.
     */
    getAll: {
      query: {
        input: ProjectScope & { startDate: Date; endDate: Date };
        output: AnnotationWithUser[];
      };
    };

    /** Every queue in the project: enough to name one and to link to it. */
    getQueues: {
      query: { input: ProjectScope; output: AnnotationQueueListEntry[] };
    };

    /** One queue with its members and score types, by slug or by id. */
    getQueueBySlugOrId: {
      query: {
        input: ProjectScope & { slug?: string; queueId?: string };
        output: AnnotationQueueDetail | null;
      };
    };

    /** The Inbox badge: work waiting for the reviewer across every queue. */
    getPendingItemsCount: { query: { input: ProjectScope; output: number } };

    /** The reviewer's own badge: items queued directly for them. */
    getAssignedItemsCount: { query: { input: ProjectScope; output: number } };

    /** One badge per queue the reviewer is a member of. */
    getQueueItemsCounts: {
      query: { input: ProjectScope; output: AnnotationQueueBadge[] };
    };

    /**
     * Queues traces for people or queues.
     *
     * `skipped` counts traces whose id no longer resolves, which the dialog
     * reports rather than swallowing: a send that queued three of five is not
     * the same event as one that queued five.
     */
    createQueueItem: {
      mutation: {
        input: ProjectScope & { traceIds: string[]; annotators: string[] };
        output: { created: number; skipped: number };
      };
    };

    /**
     * Marks the item the reviewer just finished as done.
     *
     * The QUEUE WALKER's write, which is why it arrives with that key: the
     * walker records an item as done at the moment the sitting ends, not when
     * the button was pressed, so a reviewer who backs out lands on an item that
     * is still theirs.
     */
    markQueueItemDone: {
      mutation: {
        input: ProjectScope & { queueItemId: string };
        output: { id: string } | null;
      };
    };

    /** Takes queue items out of the reviewer's queue for good. */
    deleteQueueItems: {
      mutation: {
        input: ProjectScope & { queueItemIds: string[] };
        output: { deleted: number };
      };
    };

    /** Creates a queue, or replaces an existing one's definition. */
    createOrUpdateQueue: {
      mutation: {
        input: ProjectScope & {
          name: string;
          description: string;
          userIds: string[];
          scoreTypeIds: string[];
          queueId?: string;
        };
        output: AnnotationQueueRecord;
      };
    };
  };

  annotationScore: {
    /** Every score definition the project has, active or not. */
    getAll: { query: { input: ProjectScope; output: AnnotationScore[] } };

    /** Only the definitions a reviewer can still pick, for the queue editor. */
    getAllActive: { query: { input: ProjectScope; output: AnnotationScore[] } };
  };

  traces: {
    /**
     * One trace, whole.
     *
     * The walker's fallback read: a thread older than the conversation's
     * ninety-day window answers with no turns, and the item's own trace is
     * handed to the conversation view as its single turn instead.
     */
    getById: {
      query: {
        input: ProjectScope & { traceId: string };
        // oxlint-disable-next-line no-explicit-any
        output: any;
      };
    };

    /**
     * The traces behind a set of annotations, for the input/output columns and
     * the export.
     *
     * `AnnotationTrace` is this package's own narrowing of the trace — the
     * three fields a row renders — rather than `@langwatch/trace-contract`'s
     * whole `Trace`: the list neither reads nor should be typed against a span
     * tree it never touches.
     */
    getTracesWithSpans: {
      query: {
        input: ProjectScope & { traceIds: string[] };
        output: AnnotationTrace[];
      };
    };
  };

  organization: {
    /**
     * The organization graph, narrowed to what this family needs.
     *
     * Read by the frontend feature that mounts these screens rather than by a
     * screen, and declared here so it lands on the same cache entry as the
     * application shell's own read of it. `isPersonal` and `ownerUserId` are
     * declared because the dataset hand-off's feature gate turns on whether the
     * project in scope is the reader's OWN personal workspace, which is a
     * column on the team rather than a grant.
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
            isPersonal?: boolean;
            ownerUserId?: string | null;
            projects: Array<{ id: string; name: string; slug: string }>;
          }>;
        }>;
      };
    };

    /** Who can be sent an annotation, for the participants picker. */
    getOrganizationWithMembersAndTheirTeams: {
      query: {
        input: { organizationId: string };
        output: { members: AnnotationOrganizationMember[] };
      };
    };
  };

  project: {
    /**
     * Whether a privacy rule hides captured input or output from this reader,
     * and who it does let read them.
     *
     * Read once per project and shared by every row: the answer is a project
     * setting crossed with the reader's grants, not a property of a trace.
     */
    getFieldRedactionStatus: {
      query: {
        input: ProjectScope;
        output: {
          isRedacted: { input: boolean; output: boolean };
          visibleTo: { input: string | null; output: string | null };
        };
      };
    };
  };

  personalWorkspaceFeatures: {
    /**
     * Which advanced features the reader's personal workspace has switched on.
     *
     * Answers NOT_FOUND for a project that is not the caller's own personal
     * one, which is why every call site gates on `isOwnPersonalWorkspace`
     * first.
     */
    get: {
      query: {
        input: ProjectScope;
        output: Record<string, boolean | undefined>;
      };
    };

    /** Turns the whole bundle on, which is what the gate dialog confirms. */
    enableAll: {
      mutation: { input: ProjectScope; output: Record<string, boolean | undefined> };
    };
  };
};

/**
 * The annotations family's typed tRPC hooks. Same machinery, same transport and
 * same React Query cache as the application's `api` proxy — see
 * `createFeatureApi` for why separate instances still share cache entries.
 *
 * INTERNAL to this package by convention: hooks here call it, and screens call
 * the hooks. It is exported from `screens/annotations` only so the process
 * shell can mount `annotationApi.Provider`.
 */
export const annotationApi = createFeatureApi<AnnotationApiMap>();

/**
 * The name the queue walker's 810 lines already spell.
 *
 * `platform/app`'s modules wrote `api.annotation.x.useQuery(...)`, and keeping
 * the name is what let that screen and its two suites travel without an edit.
 */
export { annotationApi as api };

/** What each procedure in the map answers, read off the map structurally. */
export type RouterOutputs = {
  [K in keyof AnnotationApiMap]: OutputsOf<AnnotationApiMap[K]>;
};

type OutputsOf<TNode> = TNode extends { query: { output: infer TOut } }
  ? TOut
  : TNode extends { mutation: { output: infer TOut } }
    ? TOut
    : TNode extends { subscription: { output: infer TOut } }
      ? TOut
      : { [K in keyof TNode]: OutputsOf<TNode[K]> };
