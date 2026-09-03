/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as `gateway-api.ts`,
 * `governance-api.ts`, `automation-api.ts`, `ops-api.ts`, `annotation-api.ts`,
 * `analytics-api.ts` and `auth-api.ts` say of their own maps: the procedures
 * are mounted by the process out of `@langwatch/trace-server`,
 * `@langwatch/annotation-server`, `@langwatch/share-server`,
 * `@langwatch/user-server` and half a dozen more, which a web package may not
 * import even for a type, and the router type does not exist until a process
 * instantiates it.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `tracesV2`, `traces`, `annotation`,
 * `savedViews`, `share` and the rest are mount points on the root router, and
 * tRPC hashes that path into the React Query cache key; spell one differently
 * and these hooks quietly stop sharing a cache with the `api.*` call sites that
 * have not moved — the annotation queue walker, the analytics overview and the
 * project home all still read entries this package invalidates.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package. Recorded here so the finding it
 * raises is a decision rather than a surprise.
 *
 * `api` is the exported name rather than `traceApi` because that is what a
 * hundred moved call sites already write. `traceApi` is the same object under
 * the name the process shell mounts it by.
 */

import type {
  Annotation,
  AnnotationQueueDetail,
  AnnotationQueueListEntry,
  AnnotationQueueRecord,
  AnnotationScore,
} from "@langwatch/annotation-contract";

import type {
  Dataset,
  DatasetRecord,
  DatasetRecordEntry,
  DatasetSummary,
} from "@langwatch/dataset-contract";

import type {
  PresenceCursorEvent,
  PresenceCursorInput,
  PresenceEvent,
  PresenceLeaveInput,
  PresenceProjectInput,
  PresenceUpdateInput,
} from "@langwatch/presence-contract";
import type { SimulationRunStatus } from "@langwatch/scenario-contract";
import type { MediaProbeResult } from "@langwatch/scenario-web";
import type { ShareLink, ShareResourceType, ShareVisibility } from "@langwatch/share-contract";
import type { CodingAgentTranscript } from "@langwatch/coding-agent-contract";
import type { CodingAgentSessionDisplay } from "@langwatch/coding-agent-web";
import { createFeatureApi } from "@langwatch/platform-api-client";
import type { ConversationTurn } from "./explorer/hooks/use-conversation-context";
import type { SessionGroupPayloadItem } from "./explorer/utils/map-session-groups-payload";
import type { ExportProgress, ExportProgressEvent } from "../../model/export-types";
import type {
  AiActionResult,
  ChangeTraceNameCommand,
  ChangeTraceNameResult,
  ConversationContext,
  DerivedTraceEvent,
  DiscoverResult,
  FacetValuesResult,
  SessionGroupsResult,
  SharedTraceDto,
  SpanDetail,
  SpanLangwatchSignals,
  SpanTreeNode,
  Trace,
  TraceEditOverlayDto,
  TraceEditOverlayPatch,
  TraceEventRollup,
  Evaluation,
  TraceHeader,
  TraceHeaderReadInput,
  TraceListPage,
  TraceLogRecordDto,
  TraceResourceInfoDto,
} from "@langwatch/trace-contract";

/** The project every trace procedure is scoped to. */
type ProjectScope = { projectId: string };

/**
 * The window a list read covers, in epoch milliseconds.
 *
 * `live` says the window's upper bound is "now" rather than a fixed instant,
 * which is what stops a rolling range from re-keying the cache every second.
 */
type TimeRange = { from: number; to: number; live?: boolean };

/** How a trace list is ordered. */
type TraceSort = { columnId: string; direction: "asc" | "desc" };

/** One trace, addressed. */
type TraceScope = ProjectScope & { traceId: string };

/** The partition-pruning hint every per-trace read takes. */
type SpanReadHint = { occurredAtMs?: number };

/** The reader's own account, as the annotation rail reads it. */
export type TraceAccountInfo = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  createdAt: Date;
};

/** One saved lens. */
export type SavedViewRead = {
  id: string;
  name: string;
  kind?: string | null;
  filters: Record<string, unknown>;
  query?: string | null;
  period?: { relativeDays?: number; startDate?: string; endDate?: string } | null;
  userId?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** One scenario run, as the trace header chip reads it. */
export type TraceScenarioRunRead = {
  scenarioRunId: string;
  name?: string | null;
  status?: SimulationRunStatus;
  durationInMs?: number | null;
  results?: {
    metCriteria?: string[];
    unmetCriteria?: string[];
    reasoning?: string | null;
  } | null;
} | null;

export type TraceApiMap = {
  tracesV2: {
    /** One page of the trace list. */
    list: {
      query: {
        input: ProjectScope & {
          timeRange: TimeRange;
          sort: TraceSort;
          page?: number;
          pageSize?: number;
          cursor?: { sortValue: number; traceId: string };
          query?: string | null;
        };
        output: TraceListPage;
      };
    };

    /** The Sessions lens: one row per conversation, rolled up in ClickHouse. */
    sessions: {
      query: {
        input: ProjectScope & {
          timeRange: TimeRange;
          sort?: TraceSort;
          pageSize?: number;
          cursor?: string;
          query?: string | null;
        };
        output: Omit<SessionGroupsResult, "sessions"> & {
          sessions: SessionGroupPayloadItem[];
        };
      };
    };

    /** Event rollups for the list's Events column, keyed by trace id. */
    listEvents: {
      query: {
        input: ProjectScope & { traceIds: string[]; timeRange: TimeRange };
        output: Record<string, TraceEventRollup>;
      };
    };

    /** How many traces arrived since a moment, for the live badge. */
    newCount: {
      query: {
        input: ProjectScope & { timeRange: TimeRange; since: number; query?: string | null };
        output: { count: number };
      };
    };

    /** The conversation a trace belongs to, oldest turn first. */
    conversationContext: {
      query: {
        input: ProjectScope & { conversationId: string };
        output: Omit<ConversationContext, "turns"> & { turns: ConversationTurn[] };
      };
    };

    /** The facet descriptors a project's data supports. */
    discover: {
      query: { input: ProjectScope & { timeRange: TimeRange }; output: DiscoverResult };
    };

    /** Pushed when a tenant's facet payload finishes its background refresh. */
    onDiscoverUpdate: {
      subscription: { input: ProjectScope; output: { projectId: string } };
    };

    /** One facet's values, paged. */
    facetValues: {
      query: {
        input: ProjectScope & {
          timeRange: TimeRange;
          facetKey: string;
          prefix?: string;
          limit?: number;
          offset?: number;
        };
        output: FacetValuesResult;
      };
    };

    /** The search bar's composer: filter, or save a lens. */
    aiAction: {
      mutation: {
        input: ProjectScope & { prompt: string; timeRange: TimeRange };
        output: AiActionResult;
      };
    };

    /** One trace's summary row. */
    header: { query: { input: TraceHeaderReadInput; output: TraceHeader } };

    /** Renames a trace. */
    changeName: {
      mutation: { input: ChangeTraceNameCommand; output: ChangeTraceNameResult };
    };

    /** The spans that changed since a version, for the live drawer. */
    spanTreeDelta: {
      query: {
        input: TraceScope & SpanReadHint & { sinceUpdatedAtMs?: number };
        output: SpanTreeNode[];
      };
    };

    /** The whole span tree in one response. */
    spanTree: { query: { input: TraceScope & SpanReadHint; output: SpanTreeNode[] } };

    /** The span tree, one page at a time, for traces too large for one read. */
    spanTreePaginated: {
      query: {
        input: TraceScope &
          SpanReadHint & {
            page?: number;
            pageSize?: number;
            cursor?: { startTimeMs: number; spanId: string } | null;
          };
        output: {
          nodes: SpanTreeNode[];
          nextCursor: { startTimeMs: number; spanId: string } | null;
        };
      };
    };

    /** LangWatch's own per-span signals. */
    spanLangwatchSignals: {
      query: { input: TraceScope & SpanReadHint; output: SpanLangwatchSignals[] };
    };

    /** Every span in the trace, in full. */
    spansFull: { query: { input: TraceScope & SpanReadHint; output: SpanDetail[] } };

    /** The coding-agent transcript built from the trace's spans and logs. */
    codingAgentTranscript: {
      query: { input: TraceScope & SpanReadHint; output: CodingAgentTranscript };
    };

    /** One span, in full. */
    spanDetail: {
      query: { input: TraceScope & SpanReadHint & { spanId: string }; output: SpanDetail };
    };

    /** The resource attributes behind a trace's spans. */
    resourceInfo: {
      query: { input: TraceScope & SpanReadHint; output: TraceResourceInfoDto };
    };

    /** Events derived from the trace's spans. */
    traceEvents: {
      query: { input: TraceScope & SpanReadHint; output: DerivedTraceEvent[] };
    };

    /** The coding-agent session a trace belongs to, if any. */
    codingAgentSession: {
      query: { input: TraceScope; output: CodingAgentSessionDisplay | null };
    };

    /**
     * The evaluations attached to the traces on a page.
     *
     * Only ever INVALIDATED from this package — the list hydrates its own eval
     * columns off the same entry — so the payload is stated as the router's
     * rather than restated here.
     */
    evals: {
      query: { input: ProjectScope & Record<string, unknown>; output: unknown };
    };

    /** The log records emitted inside a trace. */
    traceLogs: {
      query: { input: TraceScope & SpanReadHint; output: TraceLogRecordDto[] };
    };
  };

  traces: {
    /** Every evaluation attached to a trace. */
    getEvaluations: {
      query: { input: TraceScope; output: SharedTraceDto["evaluations"] };
    };

    /** What an evaluation was run over, for the evaluation cards. */
    getEvaluationInputs: {
      query: {
        input: ProjectScope & { evaluationId: string };
        output: Record<string, unknown> | null;
      };
    };

    /** The whole trace rendered as one readable digest. */
    getFormattedSpansDigest: {
      query: {
        input: ProjectScope & { traceIds: string[]; withEditOverlay?: boolean };
        output: Record<string, string>;
      };
    };

    /**
     * Whole traces with their spans, by id.
     *
     * `withEditOverlay` is what makes "Add to Dataset" store the reviewer's
     * correction rather than the raw span: a record added from a corrected
     * trace carries what the reviewer corrected.
     */
    getTracesWithSpans: {
      query: {
        input: ProjectScope & { traceIds: string[]; withEditOverlay?: boolean };
        output: Trace[];
      };
    };

    /** Whole traces with their spans, by conversation. */
    getTracesWithSpansByThreadIds: {
      query: {
        input: ProjectScope & { threadIds: string[]; withEditOverlay?: boolean };
        output: Trace[];
      };
    };

    /** The attribute names a project's traces carry. */
    getFieldNames: {
      query: {
        input: ProjectScope & { startDate?: number; endDate?: number };
        output: {
          traceIds: string[];
          fieldNames: string[];
          metadataKeys: { key: string; label: string }[];
          spanNames: { key: string; label: string }[];
          evaluationNames: { key: string; label: string }[];
        };
      };
    };

    /** A recent sample of traces, for a mapping preview. */
    getSampleTracesDataset: {
      query: { input: ProjectScope & Record<string, unknown>; output: Trace[] };
    };

    /** Pushed when a trace this project owns changes. */
    onTraceUpdate: {
      subscription: { input: ProjectScope; output: { traceId: string } };
    };
  };

  traceEditOverlay: {
    /** The correction stored on a trace, redacted for this reader. */
    getByTraceId: { query: { input: TraceScope; output: TraceEditOverlayDto | null } };

    /** Stores a correction. */
    upsert: {
      mutation: {
        input: TraceScope & { patch: TraceEditOverlayPatch };
        output: TraceEditOverlayDto;
      };
    };
  };

  sharedTrace: {
    /** The whole read-only payload behind a share token, one view spent. */
    get: { query: { input: { token: string }; output: SharedTraceDto } };
  };

  pinnedTrace: {
    getPin: {
      query: {
        input: TraceScope;
        output: { traceId: string; source?: string | null } | null;
      };
    };
    pin: { mutation: { input: TraceScope; output: { traceId: string } } };
    unpin: { mutation: { input: TraceScope; output: { ok: true } } };
  };

  savedViews: {
    getAll: {
      query: { input: ProjectScope & { kind?: string }; output: SavedViewRead[] };
    };
    create: {
      mutation: {
        input: ProjectScope & {
          id?: string;
          kind?: string;
          name: string;
          filters: Record<string, unknown>;
          query?: string;
          period?: { relativeDays?: number; startDate?: string; endDate?: string };
          scope?: "project" | "myself";
        };
        output: SavedViewRead;
      };
    };
    rename: {
      mutation: {
        input: ProjectScope & { viewId: string; name: string };
        output: SavedViewRead;
      };
    };
    delete: {
      mutation: { input: ProjectScope & { viewId: string }; output: { id: string } };
    };
  };

  share: {
    listForResource: {
      query: {
        input: ProjectScope & { resourceType: ShareResourceType; resourceId: string };
        output: ShareLink[];
      };
    };
    createShare: {
      mutation: {
        input: ProjectScope & {
          resourceType: ShareResourceType;
          resourceId: string;
          visibility?: ShareVisibility;
          expiresAt?: Date | null;
          maxViews?: number | null;
        };
        output: ShareLink;
      };
    };
    revoke: {
      mutation: { input: ProjectScope & { id: string }; output: { id: string } };
    };
  };

  annotation: {
    getByTraceId: {
      query: {
        input: TraceScope & { anchor?: "all" | "trace" };
        output: TraceAnnotationRead[];
      };
    };
    getByTraceIds: {
      query: {
        input: ProjectScope & {
          traceIds: string[];
          anchor?: "all" | "trace";
        };
        output: TraceAnnotationRead[];
      };
    };
    create: {
      mutation: {
        input: ProjectScope & {
          traceId: string;
          comment?: string | null;
          isThumbsUp?: boolean | null;
          scoreOptions?: Record<string, unknown>;
          expectedOutput?: string | null;
          anchorKind?: string | null;
          anchorId?: string | null;
          anchorPath?: string | null;
        };
        output: TraceAnnotationRead;
      };
    };
    updateByTraceId: {
      mutation: {
        input: ProjectScope & {
          id: string;
          traceId?: string;
          comment?: string | null;
          isThumbsUp?: boolean | null;
          scoreOptions?: Record<string, unknown>;
          expectedOutput?: string | null;
          anchorKind?: string | null;
          anchorId?: string | null;
          anchorPath?: string | null;
        };
        output: TraceAnnotationRead;
      };
    };
    deleteById: {
      mutation: {
        input: ProjectScope & { annotationId: string };
        output: { id: string };
      };
    };
    getQueues: { query: { input: ProjectScope; output: AnnotationQueueListEntry[] } };
    getQueueBySlugOrId: {
      query: {
        input: ProjectScope & { slug?: string; queueId?: string };
        output: AnnotationQueueDetail | null;
      };
    };
    createQueueItem: {
      mutation: {
        input: ProjectScope & { traceIds: string[]; annotators: string[] };
        output: { created: number; skipped: number };
      };
    };
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
    getPendingItemsCount: { query: { input: ProjectScope; output: number } };
    getAssignedItemsCount: { query: { input: ProjectScope; output: number } };
    getQueueItemsCounts: {
      query: { input: ProjectScope; output: { id: string; pendingCount: number }[] };
    };
    getOptimizedAnnotationQueues: {
      query: { input: ProjectScope & Record<string, unknown>; output: unknown };
    };
  };

  annotationScore: {
    getAll: { query: { input: ProjectScope; output: AnnotationScore[] } };
    getAllActive: { query: { input: ProjectScope; output: AnnotationScore[] } };
    getById: {
      query: { input: ProjectScope & { scoreId: string }; output: AnnotationScore | null };
    };
    upsert: {
      mutation: { input: ProjectScope & Record<string, unknown>; output: AnnotationScore };
    };
  };

  apiKey: {
    /** One key id resolved to a display name. */
    nameById: {
      query: {
        input: { organizationId: string; apiKeyId: string };
        output: { name: string } | null;
      };
    };
    create: {
      mutation: {
        input: {
          projectId?: string;
          organizationId?: string;
          name: string;
          bindings?: unknown;
        };
        output: { id: string; token: string; name: string };
      };
    };
  };

  /**
   * The dataset family's own segment, declared here because the "Add to
   * Dataset" drawer is this family's and calls it.
   *
   * THE SEGMENT NAME IS THE CACHE KEY, which is the whole reason a second
   * declaration is safe: `dataset.getAll` written here and `dataset.getAll`
   * written on `@langwatch/dataset-web`'s map hash to the same React Query
   * entry, so the list this drawer reads is the list the Datasets page reads
   * and an invalidation from either is seen by both. Declaring the shape twice
   * is the price of a web package not importing another's procedure map; a
   * different SPELLING would be a silently split cache.
   */
  dataset: {
    /** Every live dataset in the project, newest first. */
    getAll: { query: { input: ProjectScope; output: DatasetSummary[] } };

    /** One dataset, or `null` for an archived or missing one. */
    getById: {
      query: { input: ProjectScope & { datasetId: string }; output: Dataset | null };
    };

    /** The trace and thread mapping a dataset is filled from. */
    updateMapping: {
      mutation: {
        input: ProjectScope & {
          datasetId: string;
          mapping?: { mapping: Record<string, unknown>; expansions: string[] };
          threadMapping?: { mapping: Record<string, unknown> };
        };
        output: Dataset;
      };
    };
  };

  datasetRecord: {
    /** Appends entries. What the "Add to Dataset" submit calls. */
    create: {
      mutation: {
        input: ProjectScope & { datasetId: string; entries: DatasetRecordEntry[] };
        output: DatasetRecord[];
      };
    };

    /**
     * Declared for its INVALIDATION rather than its answer: adding records has
     * to make the dataset editor's page stale, and nothing here reads it.
     */
    getAll: {
      query: { input: ProjectScope & { datasetId: string }; output: unknown };
    };
  };

  evaluators: {
    getById: {
      query: {
        input: ProjectScope & { id: string; organizationId?: string };
        output: {
          id: string;
          name: string;
          slug?: string | null;
          evaluatorType?: string | null;
          config?: Record<string, unknown> | null;
        } | null;
      };
    };
  };

  monitors: {
    getById: {
      query: {
        input: ProjectScope & { id: string };
        output: {
          id: string;
          name: string;
          slug?: string | null;
          checkType?: string | null;
          evaluator?: {
            id: string;
            name: string;
            evaluatorType?: string | null;
            config?: Record<string, unknown> | null;
          } | null;
        } | null;
      };
    };
  };

  organization: {
    /**
     * The organization graph, narrowed to what this family needs.
     *
     * Read by the frontend feature that mounts these screens rather than by a
     * screen, and declared here so it lands on the same cache entry as the
     * application shell's own read of it. `isPersonal`, `ownerUserId` and the
     * team's members are declared because the personal-workspace gate and the
     * Langy gate both turn on facts about the TEAM rather than on a grant.
     */
    getAll: {
      query: {
        input: { isDemo?: boolean };
        output: Array<{
          id: string;
          name: string;
          slug?: string;
          presenceEnabled?: boolean;
          teams: Array<{
            id: string;
            name: string;
            slug?: string;
            isPersonal?: boolean;
            ownerUserId?: string | null;
            members?: Array<{ userId: string }>;
            projects: Array<{
              id: string;
              name: string;
              slug: string;
              apiKey?: string;
              firstMessage?: boolean;
              presenceEnabled?: boolean;
            }>;
          }>;
        }>;
      };
    };

    getOrganizationWithMembersAndTheirTeams: {
      query: {
        input: { organizationId: string };
        output: {
          id: string;
          name: string;
          members: {
            userId: string;
            role: string;
            user: { id: string; name: string | null; email: string | null; image: string | null };
          }[];
          teams: { id: string; name: string; slug: string }[];
        } | null;
      };
    };
  };

  prompts: {
    getAllPromptsForProject: {
      query: {
        input: ProjectScope;
        output: { id: string; handle: string | null; name: string }[];
      };
    };
    getByIdOrHandle: {
      query: {
        input: ProjectScope & { idOrHandle: string; version?: number };
        output: {
          id: string;
          handle: string | null;
          name: string;
          version: number;
        } | null;
      };
    };
    create: {
      mutation: { input: ProjectScope & Record<string, unknown>; output: { id: string } };
    };
  };

  scenarios: {
    getRunState: {
      query: {
        input: ProjectScope & { scenarioRunId: string };
        output: TraceScenarioRunRead;
      };
    };
  };

  translate: {
    translate: {
      mutation: {
        input: ProjectScope & { textToTranslate: string; targetLanguage?: string };
        output: { translation: string };
      };
    };
  };

  user: {
    getAccountInfo: { query: { input: Record<string, never>; output: TraceAccountInfo } };
    getTraceExplorerTourPreference: {
      query: {
        input: Record<string, never>;
        output: { dismissed: boolean; dismissedAt: Date | null };
      };
    };
    dismissTraceExplorerTour: {
      mutation: {
        input: Record<string, never>;
        output: { dismissed: boolean; dismissedAt: Date | null };
      };
    };
  };

  export: {
    /** Progress frames for a running export. */
    onExportProgress: {
      subscription: {
        input: ProjectScope & Record<string, unknown>;
        output: TraceExportProgressFrame;
      };
    };
  };

  publicEnv: {
    query: {
      input: Record<string, never>;
      output: { NEXTAUTH_PROVIDER?: string; canSendEmail?: boolean } & Record<string, unknown>;
    };
  };

  featureFlag: {
    isEnabled: {
      query: {
        input: { flag: string; projectId?: string | null; organizationId?: string | null };
        output: { enabled: boolean };
      };
    };
  };

  analytics: {
    dataForFilter: {
      query: {
        input: ProjectScope & Record<string, unknown>;
        output: { options: { field: string; label: string; count: number }[] };
      };
    };
  };

  modelProvider: {
    getAllForProjectForFrontend: {
      query: { input: ProjectScope; output: Record<string, ModelProviderFrontendRead> };
    };
  };

  personalWorkspaceFeatures: {
    get: { query: { input: ProjectScope; output: Record<string, boolean> } };
    enableAll: { mutation: { input: ProjectScope; output: Record<string, boolean> } };
  };

  presence: {
    update: {
      mutation: {
        input: Omit<PresenceUpdateInput, "user">;
        output: { ok: true };
      };
    };
    leave: { mutation: { input: PresenceLeaveInput; output: { ok: true } } };
    cursor: {
      mutation: { input: Omit<PresenceCursorInput, "user">; output: { ok: true } };
    };
    onPresenceUpdate: {
      subscription: { input: PresenceProjectInput; output: TracePresenceFrame };
    };
    onPresenceCursor: {
      subscription: { input: PresenceProjectInput; output: TracePresenceCursorFrame };
    };
  };

  project: {
    getFieldRedactionStatus: {
      query: {
        input: ProjectScope;
        output: {
          isRedacted: Record<"input" | "output", boolean>;
          visibleTo: Record<"input" | "output", string | null>;
        };
      };
    };
  };

  storedObjects: {
    headById: {
      query: { input: ProjectScope & Record<string, unknown>; output: MediaProbeResult };
    };
  };

  ops: {
    /** Whether the reader may see the Ops workspace, and at what tier. */
    getScope: {
      query: {
        input: void;
        output: { hasAccess: boolean; scope: { kind: string } | null };
      };
    };
  };

  setupSkills: {
    getPrompt: {
      query: { input: ProjectScope & { skill: string }; output: { body: string } };
    };
  };
};

/**
 * One annotation on a trace, with the person who wrote it and the part of the
 * trace it is anchored to.
 *
 * `@langwatch/annotation-web`'s own row shape rather than a second description
 * of it: the drawer's comment rail, the conversation view and the trace table's
 * annotations column all render that package's components with these rows, so a
 * narrower restatement here would only be a shape they have to be cast into.
 */
export type TraceAnnotationRead = Omit<Annotation, "anchorKind"> & {
  /**
   * WHAT part of the trace the annotation hangs off.
   *
   * Narrower than the contract row's `string`, and it has to be:
   * `AnnotationAnchorRef` — which the comment rail and the conversation view
   * both take — enumerates the three kinds, and a widened row cannot be handed
   * to either without a cast at every call site.
   */
  anchorKind: "field" | "message" | "span" | null;
  /** The reviewer, joined on. Absent on a row read without the join. */
  user?: { id: string; name: string | null; image?: string | null } | null;
};

/** How far a running export has got — the shape the progress state carries. */
export type TraceExportProgress = ExportProgress;

/** One frame of the export progress stream — the export module's own event. */
export type TraceExportProgressFrame = ExportProgressEvent;

/** One presence frame, and one cursor frame — the contract's own. */
export type TracePresenceFrame = PresenceEvent;
export type TracePresenceCursorFrame = PresenceCursorEvent;

/** One configured provider, as the frontend reads it. */
export type ModelProviderFrontendRead = {
  provider: string;
  enabled: boolean;
  customKeys: Record<string, unknown> | null;
  models: string[] | null;
  embeddingsModels: string[] | null;
  disabledByAdmin?: boolean;
};

/**
 * What each procedure hands back, addressed the way `RouterOutputs` was.
 *
 * Derived from the map rather than from a router type: `@trpc/server` is
 * rejected in a web package, so `inferRouterOutputs` is not available here and
 * the map is the only description of the wire this package has.
 */
export type OutputsFrom<TMap> = {
  [K in keyof TMap]: TMap[K] extends { query: { output: infer TOut } }
    ? TOut
    : TMap[K] extends { mutation: { output: infer TOut } }
      ? TOut
      : TMap[K] extends { subscription: { output: infer TOut } }
        ? TOut
        : OutputsFrom<TMap[K]>;
};

export type RouterOutputs = OutputsFrom<TraceApiMap>;

/**
 * Trace's typed tRPC hooks. Same machinery, same transport and same React Query
 * cache as the application's `api` proxy — see `createFeatureApi` for why
 * separate instances still share cache entries.
 */
export const traceApi = createFeatureApi<TraceApiMap>();

/** The name a hundred moved call sites already write. */
export const api = traceApi;
