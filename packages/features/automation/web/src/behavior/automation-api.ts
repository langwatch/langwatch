/**
 * The procedures this package calls, and the hooks that call them.
 * Hand-written until the mounted router can generate it (ADR-130). Segment
 * names are load-bearing tRPC cache keys. Every entry states date/string/
 * number explicitly — the automation router returns ISO 8601 strings, the
 * analytics and trace routers project through their own DTOs — because
 * getting it wrong typechecks here and fails at the call site.
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
  Trigger,
  TriggerFireStats,
  TriggerKind,
  TriggerTemplateDraft,
  WebhookDeliveryRow,
} from "@langwatch/automation-contract";
import type { Monitor } from "@langwatch/monitor-contract";
import { createFeatureApi, type OutputsFromMap } from "@langwatch/api/web";

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
  pausedAt: Trigger["pausedAt"];
  message: string | null;
  alertType: AlertType | null;
  customGraphId: string | null;
  notificationCadence: NotificationCadence;
  traceDebounceMs: number;
  createdAt: Trigger["createdAt"];
  updatedAt: Trigger["updatedAt"];
  lastRunAt: Trigger["lastRunAt"];
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

  /**
   * The two PUBLIC procedures behind `/unsubscribe` — the only calls here
   * that run with no session. The `?token=` is the authorization (ADR-031),
   * HMAC-bound to one recipient. `emailSuppression` is the mount point on
   * the root router, not `automation`, despite both mounting from
   * `@langwatch/automation-server` — the segment name is load-bearing.
   */
  emailSuppression: {
    /**
     * Who the link was minted for and what it would silence.
     *
     * Answers null-shaped as a NOT_FOUND rather than as an empty result: an
     * invalid or tampered token and a project that no longer exists are the
     * same answer to a recipient, and the screen shows "Link not valid" for
     * both.
     */
    resolveUnsubscribeToken: {
      query: {
        input: { token: string };
        output: { projectName: string; triggerName: string | null; email: string };
      };
    };

    /** Takes one of the two scopes the footer link promises. Idempotent. */
    confirmUnsubscribe: {
      mutation: {
        input: { token: string; scope: "trigger" | "project" };
        output: { ok: boolean };
      };
    };
  };

  organization: {
    /**
     * The organization graph the scope is resolved out of. Declared here
     * (not by the screen) so it shares the shell's own cache entry, fetched
     * once per document. Only the four columns this family reads a scope
     * from are declared.
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
 * The automations family's typed tRPC hooks. Internal by convention — hooks
 * here call it, other packages call the hooks. Exported only so
 * `screens/automations` can mount `automationApi.Provider`.
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
export type RouterOutputs = OutputsFromMap<AutomationApiMap>;

/**
 * The name the screen calls it by.
 *
 * It was written against the application's `api` proxy and is moved unchanged;
 * the import line is what tells it which one it has.
 */
export const api = automationApi;
