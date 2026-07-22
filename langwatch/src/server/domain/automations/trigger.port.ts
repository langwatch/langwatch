import type {
  AlertType,
  Trigger,
  TriggerAction,
  TriggerKind,
} from "@prisma/client";
import type { NotificationCadence } from "@langwatch/automations/cadences";
import type { TriggerFilters } from "@langwatch/contracts/filters";

/**
 * A dispatch-shaped view of a trigger.
 *
 * Defined here, in the domain layer, because event-sourcing names it while
 * dispatching automations and must not import `app-layer` (ADR-063). Its
 * members are Prisma enums and the already-neutral `@langwatch/{automations,
 * contracts}` packages — no app-layer type — so it stands alone. The
 * repository that produces it re-exports this definition.
 */
export interface TriggerSummary {
  id: string;
  projectId: string;
  name: string;
  action: TriggerAction;
  /** ADR-044 automation kind. Load-bearing at dispatch: a REPORT fires on its
   *  calendar schedule only, so it must never be treated as a trace automation.
   *  A report persists `filters: {}` and no `customGraphId`, which is exactly
   *  the shape of a match-everything trace trigger — the kind is the ONLY thing
   *  that tells them apart. */
  triggerKind: TriggerKind;
  actionParams: unknown;
  filters: TriggerFilters;
  /** ADR-043 Subject facet: the Traces-V2 liqe query the automation is about.
   *  NULL = legacy `filters`-driven trigger; when set, the dispatcher evaluates
   *  it in-memory against fold state and ignores `filters`. */
  filterQuery: string | null;
  alertType: AlertType | null;
  message: string | null;
  customGraphId: string | null;
  notificationCadence: NotificationCadence;
  /** Per-trigger trace-readiness debounce in ms (ADR-026). Always populated by
   *  the repository — the column is `NOT NULL DEFAULT 30000`. */
  traceDebounceMs: number;
  /** Customer-authored notification templates (ADR-036). NULL means "this
   *  channel uses the legacy framework renderer". */
  templates: {
    slackTemplateType: string | null;
    slackTemplate: string | null;
    emailSubjectTemplate: string | null;
    emailBodyTemplate: string | null;
  };
}

/**
 * The trigger reads and claims event-sourcing performs while dispatching
 * automations. `TriggerService` satisfies it structurally; the composition
 * root passes the real service (ADR-063).
 */
export interface TriggerPort {
  getActiveTraceTriggersForProject(
    projectId: string,
  ): Promise<TriggerSummary[]>;
  getActiveGraphTriggersForProject(
    projectId: string,
  ): Promise<TriggerSummary[]>;
  getById(params: {
    triggerId: string;
    projectId: string;
  }): Promise<Trigger | null>;
  claimSend(params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean>;
  isSendClaimed(params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean>;
  updateLastRunAt(triggerId: string, projectId: string): Promise<void>;
}
