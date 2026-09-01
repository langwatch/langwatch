/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as `gateway-api.ts`,
 * `governance-api.ts` and `personal-workspace-api.ts` say of their own maps:
 * the procedures live in `@langwatch/automation-server`,
 * `@langwatch/analytics-server`, `@langwatch/dataset-server` and the trace
 * verticals, none of which a web package may import even for a type, and the
 * router type does not exist until a process instantiates it. Emitting this
 * file from the mounted router is the fix; writing it by hand is the interim,
 * and it is honest only because the payload types below are the contract's
 * wherever the contract has them — and for this family that is most of them.
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `automation`, `graphs`, `dashboards`,
 * `dataset`, `tracesV2`, `team` and `annotation` are mount points on the root
 * router, and tRPC hashes that path into the React Query cache key; spell one
 * differently and these hooks quietly stop sharing a cache with the
 * `api.automation.*` call sites that have not moved.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package. It buys a content-faithful move:
 * every `api.x.y.useQuery(...)` call site in the screen, the two drawers and
 * the five delivery providers is the line it was in `platform/app`. Recorded
 * here so the finding it raises is a decision rather than a surprise.
 *
 * DATE, STRING OR NUMBER IS NOT A CHOICE THIS FILE MAKES. The automation router
 * returns the stored rows over superjson, so every instant on them is a real
 * `Date`; the analytics and trace routers project through DTOs of their own.
 * Every entry below states which, because getting it wrong typechecks here and
 * fails at the call site.
 *
 * ADD A PROCEDURE when a hook in this package needs one. Do not add one
 * speculatively: every entry is a promise that the router still mounts it under
 * that name, and nothing checks that promise until the generator exists.
 */

import type {
  AlertType,
  AutomationPersistCapCount,
  NotificationCadence,
  ReportSchedule,
  TestFireChannel,
  TestFireResult,
  TriggerAction,
  TriggerFire,
  TriggerFireStats,
  TriggerKind,
  TriggerTemplateDraft,
  WebhookDeliveryRow,
} from "@langwatch/automation-contract";
import type { Monitor } from "@langwatch/monitor-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

/** The project every automation procedure is scoped to. */
type ProjectScope = { projectId: string };

/**
 * One automation as this vertical hands it over.
 *
 * The stored row with its secrets redacted, plus the two joins the list needs:
 * the monitors its filters name, and the custom graph an alert watches. Every
 * instant is a real `Date` — the router returns the row rather than a DTO.
 */
export type AutomationRow = {
  id: string;
  projectId: string;
  name: string;
  action: TriggerAction;
  triggerKind: TriggerKind;
  actionParams: Record<string, unknown>;
  /** The persisted structured filters. A JSON string on legacy rows. */
  filters: Record<string, unknown> | string;
  filterQuery: string | null;
  active: boolean;
  pausedReason: string | null;
  pausedAt: Date | null;
  message: string | null;
  alertType: AlertType | null;
  customGraphId: string | null;
  notificationCadence: NotificationCadence;
  traceDebounceMs: number;
  createdAt: Date;
  updatedAt: Date;
  lastRunAt: Date | null;
  /** The monitors named by the row's `evaluations.*` filters. */
  checks?: Array<Monitor | undefined>;
  /** The watched graph's name, for an alert. */
  customGraph?: { id: string; name: string } | null;
} & TriggerTemplateDraft;

/** One custom graph, narrowed to what this family renders. */
export type AutomationGraph = {
  id: string;
  name?: string;
  /** The saved graph JSON, read for its series labels. */
  graph: unknown;
  /** Set when an alert already watches this graph. */
  trigger?: { id: string } | null;
};

export type AutomationDashboard = { id: string; name: string };

/** One dataset, narrowed to what the dataset delivery provider reads. */
export type AutomationDataset = {
  id: string;
  name: string;
  /** The dataset's column definitions, parsed by the provider. */
  columnTypes: unknown;
};

/** One matched trace in the subject preview. */
export type AutomationPreviewTrace = {
  traceId: string;
  name: string;
  /** Epoch milliseconds, as the trace list projects it. */
  timestamp: number;
  status: "ok" | "error" | "warning";
};

/** A Slack channel the bot token can see, for the channel picker (ADR-041). */
export type AutomationSlackChannel = {
  id: string;
  name: string;
  isPrivate?: boolean;
};

/** One person who can be added to an annotation queue. */
export type AutomationAnnotator = { id: string; name: string };

export type AutomationApiMap = {
  automation: {
    getTriggers: { query: { input: ProjectScope; output: AutomationRow[] } };
    getTriggerById: {
      query: {
        input: ProjectScope & { triggerId: string };
        output: AutomationRow | null;
      };
    };
    getTriggerStats: { query: { input: ProjectScope; output: TriggerFireStats[] } };
    /** The plan's daily ceiling on persist actions, on its own. */
    getDailyCap: { query: { input: ProjectScope; output: { cap: number } } };
    getDailyCapStatus: {
      query: {
        input: ProjectScope;
        output: { cap: number; counts: Record<string, AutomationPersistCapCount | undefined> };
      };
    };
    getReportSchedules: { query: { input: ProjectScope; output: ReportSchedule[] } };
    getRecentActivity: {
      query: { input: ProjectScope & { limit?: number }; output: TriggerFire[] };
    };
    getRecentFires: {
      query: {
        input: ProjectScope & { triggerId: string; limit?: number };
        output: TriggerFire[];
      };
    };
    getWebhookDeliveries: {
      query: {
        input: ProjectScope & { triggerId: string; limit?: number };
        output: WebhookDeliveryRow[];
      };
    };
    toggleTrigger: {
      mutation: {
        input: ProjectScope & { triggerId: string; active: boolean };
        output: { success: boolean };
      };
    };
    deleteById: {
      mutation: {
        input: ProjectScope & { triggerId: string };
        output: { success: boolean };
      };
    };
    /**
     * Lists the channels a Slack bot token can see.
     *
     * A mutation rather than a query because it exercises the stored token, and
     * `triggers:update` gates it for the same reason. A missing scope comes
     * back as an `error` rather than a throw, so the picker degrades to manual
     * entry.
     */
    listSlackChannels: {
      mutation: {
        input: ProjectScope & { botToken?: string | null; automationId?: string };
        output: {
          channels: AutomationSlackChannel[];
          error?: string;
          gaps?: string[];
        };
      };
    };
    testFireTemplate: {
      mutation: {
        input: ProjectScope & {
          channel: TestFireChannel;
          trigger: { name: string; alertType: AlertType | null };
          draft: TriggerTemplateDraft;
          webhook: string | null;
          botDestination: { channelId: string; botToken: string | null } | null;
          webhookDestination: {
            url: string;
            method: "POST" | "PUT" | "PATCH";
            headers: Record<string, string>;
            bodyTemplate: string | null;
          } | null;
          automationId?: string;
          graphAlert: Record<string, unknown> | null;
          report: Record<string, unknown> | null;
        };
        output: TestFireResult & { httpStatus?: number | null };
      };
    };
    upsert: {
      mutation: {
        input: ProjectScope & {
          triggerId?: string;
          name: string;
          action: TriggerAction;
          alertType?: AlertType | undefined;
          filters: Record<string, unknown>;
          filterQuery: string | null;
          customGraphId: string | null;
          graphAlert?: unknown;
          report?: unknown;
          actionParams: never;
          templates: TriggerTemplateDraft;
          notificationCadence: NotificationCadence;
          traceDebounceMs: number;
        };
        output: { id: string };
      };
    };
  };

  graphs: {
    getAll: { query: { input: ProjectScope; output: AutomationGraph[] } };
    getById: { query: { input: ProjectScope & { id: string }; output: AutomationGraph | null } };
  };

  dashboards: {
    getAll: { query: { input: ProjectScope; output: AutomationDashboard[] } };
  };

  dataset: {
    getAll: { query: { input: ProjectScope; output: AutomationDataset[] } };
  };

  tracesV2: {
    /**
     * The subject preview's matched-trace count and sample.
     *
     * Only the two fields the preview renders are declared; the procedure
     * answers with the whole page of the trace list.
     */
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
    /** The team's members, for the email delivery provider's recipient picker. */
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
    /**
     * The organization graph the scope is resolved out of.
     *
     * Read by the frontend feature that mounts this screen rather than by the
     * screen, and declared here so it lands on the same cache entry as the
     * application shell's own read of it: the graph is fetched once per
     * document however many halves of the product want it. Only the four
     * columns this family resolves a scope from are declared.
     */
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
    /** The organization graph, narrowed to the annotator picker's reads. */
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

/**
 * The automations family's typed tRPC hooks. Same machinery, same transport and
 * same React Query cache as the application's `api` proxy — see
 * `createFeatureApi` for why separate instances still share cache entries.
 *
 * INTERNAL to this package by convention: hooks here call it, and other
 * packages call the hooks. It is exported from `screens/automations` only so
 * the process shell can mount `automationApi.Provider`.
 */
export const automationApi = createFeatureApi<AutomationApiMap>();

/**
 * Every procedure's output, addressed the way the screen already addresses it.
 *
 * The application's `~/utils/api` exported `RouterOutputs` off the real
 * `AppRouter`, and the page wrote
 * `RouterOutputs["automation"]["getTriggers"][number]`. Deriving the same shape
 * from the map above keeps those aliases exactly as they were written.
 */
type AutomationOutputOf<TNode> = TNode extends { query: { output: infer TOutput } }
  ? TOutput
  : TNode extends { mutation: { output: infer TOutput } }
    ? TOutput
    : { [TSegment in keyof TNode]: AutomationOutputOf<TNode[TSegment]> };

export type RouterOutputs = {
  [TSegment in keyof AutomationApiMap]: AutomationOutputOf<AutomationApiMap[TSegment]>;
};

/**
 * The name the screen calls it by.
 *
 * It was written against the application's `api` proxy and is moved unchanged;
 * the import line is what tells it which one it has.
 */
export const api = automationApi;
