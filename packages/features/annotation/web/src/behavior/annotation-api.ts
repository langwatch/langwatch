/**
 * The procedures this package calls, and the hooks that call them.
 * Hand-written until the mounted router can generate it (ADR-130). The
 * segment names are load-bearing tRPC cache keys — renaming one stops
 * sharing a cache with the annotation queue walker, trace drawer rail,
 * trace table column and queue drawer, which invalidate the same entries.
 */

import type {
  AnnotationQueueDetail,
  AnnotationQueueListEntry,
  AnnotationQueueRecord,
  AnnotationScore,
} from "@langwatch/annotation-contract";
import { createFeatureApi, type OutputsFromMap } from "@langwatch/platform-api-client/feature-api";
import type { AnnotationWithUser } from "@langwatch/annotation-contract";
import type { WireOf } from "@langwatch/platform-api-client/feature-api";
import type { AnnotationPeriod, AnnotationPeriodMoment } from "../model/annotation-period.ts";
import type { AnnotationTrace } from "../model/annotation-row.ts";

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
  doneAt: string | null;
  createdAt: string | null;
  createdByUser: { id: string; name: string | null; image: string | null } | null;
  trace: AnnotationTrace | null;
  annotations: WireOf<AnnotationWithUser>[];
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
          startDate?: AnnotationPeriodMoment;
          endDate?: AnnotationPeriodMoment;
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
        input: ProjectScope & AnnotationPeriod;
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
     * The traces behind a set of annotations, for the input/output columns.
     * `AnnotationTrace` narrows the trace to the three fields a row renders,
     * rather than `@langwatch/trace-contract`'s whole `Trace` span tree.
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
     * The organization graph, narrowed to what this family needs. Declared
     * here (not by a screen) so it shares the shell's own cache entry.
     * `isPersonal`/`ownerUserId` gate the dataset hand-off feature, since
     * "own personal workspace" is a column on the team, not a grant.
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
 * The annotations family's typed tRPC hooks. Internal by convention — hooks
 * here call it, screens call the hooks. Exported only so
 * `screens/annotations` can mount `annotationApi.Provider`.
 */
export const annotationApi = createFeatureApi<AnnotationApiMap>();

/**
 * The name the queue walker's 810 lines already spell.
 *
 * `platform/app`'s modules wrote `api.annotation.x.useQuery(...)`, and keeping
 * the name is what let that screen and its two suites travel without an edit.
 */
export { annotationApi as api };

/** What each procedure in the map answers, as the browser receives it. */
export type RouterOutputs = OutputsFromMap<AnnotationApiMap>;
