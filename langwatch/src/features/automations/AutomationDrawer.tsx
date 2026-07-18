import {
  Box,
  Button,
  Heading,
  HStack,
  Skeleton,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { AlertType, TriggerAction, TriggerKind } from "@prisma/client";
import { Mail, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_TRACE_DEBOUNCE_MS,
  MAX_TRACE_DEBOUNCE_MS,
  MIN_TRACE_DEBOUNCE_MS,
  NOTIFICATION_CADENCES,
  type NotificationCadence,
} from "~/shared/automations/cadences";
import {
  CLIENT_PROVIDERS,
  type NotifyPreview,
} from "~/features/automations/providers/registry";
import {
  type ConfigFormCtx,
  isNotifyEntry,
} from "~/features/automations/providers/types";
import { Dialog } from "~/components/ui/dialog";
import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { useDrawer } from "~/hooks/useDrawer";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import type { FilterParam } from "~/hooks/useFilterParams";
import { useFilterParams } from "~/hooks/useFilterParams";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  type FilterField,
  sanitizeTriggerFilters,
  type TriggerFilterValue,
} from "~/server/filters/types";
import { defaultsForSourceKind } from "~/shared/templating/defaults";
import {
  EXAMPLE_MATCHES,
  TEMPLATE_VARIABLES,
} from "~/shared/templating/exampleContext";
import { renderTriggerEmail } from "~/shared/templating/renderEmail";
import { renderTriggerSlack } from "~/shared/templating/renderSlack";
import { renderWebhookBody } from "~/shared/templating/renderWebhookBody";
import {
  buildExampleGraphAlertTemplateContext,
  buildExampleReportTemplateContext,
  buildTemplateContext,
  type GraphAlertTemplateContext,
  type ReportTemplateContext,
  type TemplateContext,
} from "~/shared/templating/templateContext";
import { api } from "~/utils/api";
import { isHandledByGlobalHandler } from "~/utils/trpcError";
import { MainSectionList } from "./components/MainSectionList";
import { ConfigurationSecondaryDrawer } from "./components/secondaries/ConfigurationSecondaryDrawer";
import { ALERT_TEMPLATE_VARIABLES } from "./editors/alertVariables";
import { REPORT_TEMPLATE_VARIABLES } from "./editors/reportVariables";
import {
  type AutomationDraft,
  actionParamsFromDraft,
  buildTestFirePayload,
  cadenceIsSet,
  extractGraphAlertFromTriggerRow,
  extractReportFromTriggerRow,
  filtersAreSet,
  INITIAL_DRAFT,
  notifyChannel,
  presetLabels,
  reportInputFromDraft,
  subjectIsSet,
  templatesFromDraft,
} from "./logic/draftReducer";
import { explainHandledError, readHandledError } from "./logic/errorExplainer";
import { useGraphAlertLabels } from "./logic/useGraphAlertLabels";
import { useAutomationStore } from "./state/automationStore";
import {
  useConditionsSet,
  useConfigComplete,
  useDraft,
  useSection,
} from "./state/selectors";

/** Facet-ordered "why can't I save yet" copy: Name → Type → Subject →
 *  Cadence → Severity → Delivery. Type is always chosen (the source defaults
 *  to an automation), so it never contributes a message. */
function saveDisabledReason({
  draft,
  nameSet,
  configComplete,
  actionPicked,
  webhookReadOnly = false,
}: {
  draft: AutomationDraft;
  nameSet: boolean;
  configComplete: boolean;
  actionPicked: boolean;
  webhookReadOnly?: boolean;
}): string {
  if (webhookReadOnly) {
    return "Webhook delivery is unavailable for this project. Choose another delivery channel to save changes.";
  }
  const missing: string[] = [];
  if (!nameSet) missing.push("give it a name");
  if (!subjectIsSet(draft)) missing.push(subjectTodo(draft));
  else if (!cadenceIsSet(draft)) missing.push(cadenceTodo(draft));
  if (draft.source === "customGraph" && draft.alertType === null)
    missing.push("set a severity");
  if (!actionPicked) missing.push("pick a delivery channel");
  else if (!configComplete) missing.push("complete the setup");
  if (missing.length === 0) return "";
  return `To save, ${missing.join(" and ")}.`;
}

function subjectTodo(draft: AutomationDraft): string {
  switch (draft.source) {
    case "customGraph":
      return "pick a graph and series to watch";
    case "report":
      return "choose what to send";
    case "trace":
      return "choose which traces to act on";
  }
}

function cadenceTodo(draft: AutomationDraft): string {
  switch (draft.source) {
    case "customGraph":
      return "set the alert threshold";
    case "report":
      return "set a schedule";
    case "trace":
      return "";
  }
}

/**
 * Orchestrator for the staged automation authoring drawer (ADR-036).
 *
 * - Holds no UI of its own beyond the drawer chrome + footer.
 * - Owns the data-loading lifecycle: scaffold (synchronous client),
 *   trigger row prefill on edit, traces-view filter prefill on create.
 * - Owns the live preview / test-fire / upsert mutations.
 * - Renders three pieces: the main drawer with `<MainSectionList/>`, the
 *   Filters secondary, and the Configuration secondary (which itself
 *   delegates the inner config to the active provider's ConfigForm).
 *
 * Everything else lives in `components/`, `state/`, `providers/`, or
 * `logic/`. Adding a new action type doesn't change this file.
 */
export function AutomationDrawer({
  automationId,
  source,
  prefilledGraphId,
  prefilledSeriesName,
  initialSource,
  initialName,
  initialAction,
  initialFilters,
  initialFilterQuery,
}: {
  automationId?: string;
  /** Marker query param set by the email "Edit automation" footer link so the
   *  drawer can surface a one-line landing banner. Any other value (or
   *  undefined) renders the drawer normally. */
  source?: string;
  /** When set, the drawer opens in graph-alert mode with the graph
   *  pre-filled and locked. Used by the dashboard "Add alert" entry
   *  point (Phase 5.2). */
  prefilledGraphId?: string;
  prefilledSeriesName?: string;
  /** Fresh-create prefills, set by the Alerts & automations page's "New
   *  alert" button and use-case cards. `initialSource: "customGraph"` opens
   *  the drawer as a new alert (severity seeded to Warning, graph left for
   *  the user to pick — unlike `prefilledGraphId`, nothing is locked).
   *  `initialFilters` is a JSON-encoded trigger filter object (the persisted
   *  shape), sanitized on the way in like the edit-hydration path. */
  initialSource?: string;
  initialName?: string;
  initialAction?: string;
  initialFilters?: string;
  /** ADR-043 Subject facet: a Traces-V2 liqe query to seed a fresh trace
   *  automation with — set by the traces view's "Automate" button so the
   *  current filter becomes the automation's subject. */
  initialFilterQuery?: string;
}) {
  const { project, organization, team } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();
  const queryClient = api.useContext();
  const { filterParams } = useFilterParams();
  const projectId = project?.id ?? "";
  const { enabled: webhookEnabled } = useFeatureFlag(
    "release_webhook_automations",
    { projectId: project?.id, enabled: !!project },
  );

  const draft = useDraft();
  const section = useSection();
  const conditionsSet = useConditionsSet();
  const configComplete = useConfigComplete();
  const isGraphAlert = draft.source === "customGraph";
  const isReport = draft.source === "report";
  // Single source of truth for every heading / button / toast noun. Treat a
  // graph-prefilled create as an alert from the first paint so the title
  // doesn't flash "Add automation" before the prefill effect lands.
  const labels = presetLabels(
    prefilledGraphId ? "customGraph" : draft.source,
    !!automationId,
  );
  // A saved graph alert or report can't become a trace automation mid-edit
  // (the kind decides the row's whole shape — schedule, source, dispatcher),
  // and a drawer opened from a specific chart is pinned to that alert — lock
  // the Type cards visibly in all three cases.
  const sourceLocked =
    (!!automationId && (isGraphAlert || isReport)) || !!prefilledGraphId;
  const dispatch = useAutomationStore((s) => s.dispatch);
  const setSection = useAutomationStore((s) => s.setSection);
  const hydrate = useAutomationStore((s) => s.hydrate);
  const reset = useAutomationStore((s) => s.reset);
  const pushAttempt = useAutomationStore((s) => s.pushTestAttempt);
  const testHistory = useAutomationStore((s) => s.testHistory);

  // Wipe the singleton store on unmount — next open is a fresh slate.
  useEffect(() => () => reset(), [reset]);

  // Baseline the close-guard diffs against: the hydrated row on edit, the
  // traces-prefilled (or empty) draft on create. Set once the relevant
  // prefill settles so a clean open never triggers the discard prompt.
  // Serialized because drafts are plain JSON-able objects and we only care
  // about value equality, not reference identity.
  const baselineRef = useRef<string | null>(null);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  // Pre-fill conditions from the traces view on a fresh create.
  const prefilledFromTraces = useRef(false);
  useEffect(() => {
    if (automationId) return;
    if (prefilledFromTraces.current) return;
    if (filterParams.filters && filtersAreSet(filterParams.filters)) {
      dispatch({ type: "SET_FILTERS", value: filterParams.filters });
      prefilledFromTraces.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-fill graph-alert mode from drawer params on a fresh create. Used
  // by the dashboard "Add alert" entry (Phase 5.2). When set, the drawer
  // opens with source = customGraph and the graph / series already
  // selected and locked, so the author lands on the threshold rule.
  const prefilledFromGraph = useRef(false);
  useEffect(() => {
    if (automationId) return;
    if (prefilledFromGraph.current) return;
    if (!prefilledGraphId) return;
    dispatch({ type: "SET_SOURCE", value: "customGraph" });
    dispatch({ type: "SET_CUSTOM_GRAPH_ID", value: prefilledGraphId });
    if (prefilledSeriesName) {
      const currentGraphAlert = useAutomationStore.getState().draft.graphAlert;
      dispatch({
        type: "SET_GRAPH_ALERT",
        value: { ...currentGraphAlert, seriesName: prefilledSeriesName },
      });
    }
    // Seed a severity so the prefilled create can save without a detour
    // through the When secondary — the author can still change it there.
    dispatch({ type: "SET_ALERT_TYPE", value: AlertType.WARNING });
    prefilledFromGraph.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-fill identity + kind from drawer params on a fresh create. Set by
  // the Alerts & automations page ("New alert" opens straight into alert
  // mode; use-case cards seed a name and action too). Ordering matters:
  // SET_SOURCE runs first because switching to customGraph resets any
  // action that alerts don't support.
  const prefilledFromParams = useRef(false);
  useEffect(() => {
    if (automationId) return;
    if (prefilledFromParams.current) return;
    if (
      !initialSource &&
      !initialName &&
      !initialAction &&
      !initialFilters &&
      !initialFilterQuery
    ) {
      return;
    }
    if (initialSource === "customGraph") {
      dispatch({ type: "SET_SOURCE", value: "customGraph" });
      // Alerts require a severity — seed the default so the fresh draft can
      // save without a detour; the author can change it next to the name.
      dispatch({ type: "SET_ALERT_TYPE", value: AlertType.WARNING });
    }
    if (initialSource === "report") {
      dispatch({ type: "SET_SOURCE", value: "report" });
    }
    if (initialName) {
      dispatch({ type: "SET_NAME", value: initialName });
    }
    if (
      initialAction &&
      initialAction in CLIENT_PROVIDERS &&
      (initialAction !== TriggerAction.SEND_WEBHOOK || webhookEnabled)
    ) {
      dispatch({
        type: "SET_ACTION",
        value: initialAction as TriggerAction,
      });
    }
    // Same defensive parse as edit hydration — a malformed param falls back
    // to no filters rather than crashing the open.
    if (initialFilters && initialSource !== "customGraph") {
      try {
        const raw = JSON.parse(initialFilters) as Record<
          string,
          TriggerFilterValue
        >;
        const { sanitized } = sanitizeTriggerFilters(raw);
        dispatch({
          type: "SET_FILTERS",
          value: sanitized as Partial<Record<FilterField, FilterParam>>,
        });
      } catch {
        // Ignore malformed prefill — the user sets conditions themselves.
      }
    }
    // ADR-043: seed the trace-subject query from the traces view's Automate
    // button. Only for a trace automation — customGraph/report don't carry one.
    if (
      initialFilterQuery &&
      initialSource !== "customGraph" &&
      initialSource !== "report"
    ) {
      dispatch({ type: "SET_FILTER_QUERY", value: initialFilterQuery });
    }
    prefilledFromParams.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Edit prefill from the saved trigger.
  const triggerQuery = api.automation.getTriggerById.useQuery(
    { triggerId: automationId ?? "", projectId },
    { enabled: !!automationId && !!projectId },
  );
  // Gate hydration to the FIRST successful read per automationId. tRPC's
  // background refetch (window-focus, query invalidation) would otherwise
  // re-fire this effect mid-session and overwrite unsaved edits with the
  // last-saved row.
  const hydratedFromServerFor = useRef<string | null>(null);
  useEffect(() => {
    if (!automationId) return;
    const row = triggerQuery.data;
    if (!row) return;
    if (hydratedFromServerFor.current === automationId) return;
    // If the author already started editing while the query was in flight
    // (any dispatch produces a fresh draft object), hydrating now would
    // silently revert their keystrokes to the saved row. Keep their edits
    // and treat the draft as hydrated.
    if (useAutomationStore.getState().draft !== INITIAL_DRAFT) {
      hydratedFromServerFor.current = automationId;
      // Their in-flight edits are genuinely unsaved relative to a blank
      // draft, so baseline against INITIAL_DRAFT and keep guarding them.
      baselineRef.current ??= JSON.stringify(INITIAL_DRAFT);
      return;
    }
    const action = row.action as TriggerAction;
    const provider = CLIENT_PROVIDERS[action];
    // `Trigger.filters` is persisted as a JSON string via `JSON.stringify`, but a
    // malformed legacy row would crash the prefill if we trusted that. Fall
    // back to an empty filter set on parse error so the drawer still opens —
    // the user can re-enter the conditions instead of seeing the whole
    // automations page fail to render.
    let filtersRaw: Record<string, TriggerFilterValue> = {};
    if (typeof row.filters === "string") {
      try {
        filtersRaw = JSON.parse(row.filters) as Record<
          string,
          TriggerFilterValue
        >;
      } catch {
        filtersRaw = {};
      }
    }
    const { sanitized } = sanitizeTriggerFilters(filtersRaw);
    // The row's KIND is what it is — a REPORT hydrated as a trace automation
    // would lose its schedule and content source on the next Save (the router
    // rewrites the row from what the drawer sends). `customGraphId` is only a
    // reliable signal for alerts, so read `triggerKind` first.
    const isReportRow = row.triggerKind === TriggerKind.REPORT;
    const next: AutomationDraft = {
      ...INITIAL_DRAFT,
      action,
      name: row.name,
      alertType: row.alertType,
      source: isReportRow
        ? "report"
        : row.customGraphId
          ? "customGraph"
          : "trace",
      customGraphId: row.customGraphId,
      // ADR-043: a trace automation — and a trace-query report — edited from a
      // saved row keeps its liqe query so the Subject editor rehydrates it
      // (null for legacy rows and for graph/dashboard sources).
      filterQuery: row.filterQuery ?? null,
      // Pull the threshold rule out of actionParams when this row is a
      // graph alert so the threshold form pre-populates on edit.
      graphAlert: row.customGraphId
        ? extractGraphAlertFromTriggerRow(row.actionParams)
        : INITIAL_DRAFT.graphAlert,
      // Same for a report's content source + schedule, so the Subject and
      // Cadence facets open on what was saved rather than the blank defaults.
      report: isReportRow
        ? extractReportFromTriggerRow(row.actionParams)
        : INITIAL_DRAFT.report,
      filters: sanitized as Partial<Record<FilterField, FilterParam>>,
      // Defensive narrow: column is a free-form TEXT (see the repo parser).
      notificationCadence: (
        NOTIFICATION_CADENCES as readonly string[]
      ).includes(row.notificationCadence)
        ? (row.notificationCadence as NotificationCadence)
        : "immediate",
      // Clamp to the same bounds the router enforces so a stale row outside
      // the window doesn't render as an invalid value in the field.
      traceDebounceMs: Math.min(
        MAX_TRACE_DEBOUNCE_MS,
        Math.max(
          MIN_TRACE_DEBOUNCE_MS,
          typeof row.traceDebounceMs === "number"
            ? row.traceDebounceMs
            : DEFAULT_TRACE_DEBOUNCE_MS,
        ),
      ),
      // The saved row's cadence was chosen (or accepted) when it was created,
      // so editing doesn't re-demand a visit to the cadence stage.
      cadenceConfirmed: true,
      slices: {
        ...INITIAL_DRAFT.slices,
        [action]: provider.client.fromTriggerRow({
          id: row.id,
          name: row.name,
          alertType: row.alertType,
          action,
          actionParams: row.actionParams,
          emailSubjectTemplate: row.emailSubjectTemplate,
          emailBodyTemplate: row.emailBodyTemplate,
          slackTemplate: row.slackTemplate,
          slackTemplateType: row.slackTemplateType,
        }),
      },
    };
    hydrate(next);
    hydratedFromServerFor.current = automationId;
    baselineRef.current = JSON.stringify(next);
  }, [triggerQuery.data, automationId, hydrate]);

  // Capture the create-mode baseline once the synchronous traces-prefill has
  // had a chance to land (the prefill effect above runs on mount before this
  // commits). After this, any change to the draft reads as unsaved and the
  // close-guard kicks in.
  useEffect(() => {
    if (automationId) return;
    if (baselineRef.current !== null) return;
    baselineRef.current = JSON.stringify(useAutomationStore.getState().draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build the example TemplateContext the preview pane (and autocomplete)
  // render against. Static-ish — only depends on the project identity, so the
  // example URLs come out plausible (`/<slug>/messages/<trace>`). Pulled
  // directly from the shared templating module — no more parallel client copy.
  const exampleContext = useMemo(
    () =>
      buildTemplateContext({
        trigger: {
          id: "preview",
          name: "Your automation",
          alertType: null,
        },
        project: {
          name: project?.name ?? "Project",
          slug: project?.slug ?? "project",
        },
        baseHost:
          typeof window !== "undefined"
            ? window.location.origin
            : "https://app.langwatch.ai",
        matches: EXAMPLE_MATCHES,
      }),
    [project?.name, project?.slug],
  );

  // Live preview for the active notify channel.
  //
  // Renders fully client-side via the shared templating module. No tRPC,
  // no debounce — Liquid renders are sub-millisecond on a draft-sized
  // template, so we can update on every keystroke and stay responsive.
  // A monotonically increasing token guards against the rare race where
  // a slow render returns out of order.
  const channel = notifyChannel(draft);
  const [preview, setPreview] = useState<NotifyPreview | undefined>(undefined);
  const previewToken = useRef(0);
  // Resolve the selected graph's name + the monitored series' human label
  // so the alert preview / test-fire / conditions summary read like the
  // real fire will, not like placeholders.
  const { graphName, seriesLabel } = useGraphAlertLabels({
    projectId,
    enabled: isGraphAlert,
    customGraphId: draft.customGraphId,
    seriesName: draft.graphAlert.seriesName,
  });

  // Seed the name from the watched graph once its row loads — "Latency
  // p95 alert" beats an empty field on the golden Add-alert path. Only
  // when the author hasn't typed anything, and only once.
  const seededNameFromGraph = useRef(false);
  useEffect(() => {
    if (automationId || seededNameFromGraph.current) return;
    if (!prefilledGraphId || !graphName) return;
    if (useAutomationStore.getState().draft.name.trim() !== "") return;
    dispatch({ type: "SET_NAME", value: `${graphName} alert` });
    seededNameFromGraph.current = true;
  }, [automationId, prefilledGraphId, graphName, dispatch]);
  const previewContext = useMemo<
    TemplateContext | GraphAlertTemplateContext | ReportTemplateContext
  >(() => {
    if (isReport) {
      // Report-shaped example data, so the preview shows the traces or the
      // chart the report will really send — not an empty trace-shaped message.
      return buildExampleReportTemplateContext({
        baseHost:
          typeof window !== "undefined"
            ? window.location.origin
            : "https://app.langwatch.ai",
        project: {
          name: project?.name ?? "Project",
          slug: project?.slug ?? "project",
        },
        trigger: { name: draft.name || "Example report" },
        sourceKind: draft.report.sourceKind,
        chartTitles: graphName ? [graphName] : undefined,
      });
    }
    if (isGraphAlert) {
      // Alert-shaped example context + the draft's actual rule, so the
      // preview shows what a real fire renders — not the trace shape.
      return buildExampleGraphAlertTemplateContext({
        baseHost:
          typeof window !== "undefined"
            ? window.location.origin
            : "https://app.langwatch.ai",
        project: {
          name: project?.name ?? "Project",
          slug: project?.slug ?? "project",
        },
        trigger: {
          name: draft.name || "Example alert",
          alertType: draft.alertType,
        },
        graph: graphName ? { name: graphName } : undefined,
        metricLabel: seriesLabel ?? undefined,
        condition: {
          operator: draft.graphAlert.operator,
          threshold: draft.graphAlert.threshold,
          timePeriodMinutes: draft.graphAlert.timePeriod,
        },
      });
    }
    return {
      ...exampleContext,
      trigger: {
        ...exampleContext.trigger,
        name: draft.name || "Your automation",
        alertType: draft.alertType,
      },
    };
  }, [
    exampleContext,
    isGraphAlert,
    isReport,
    graphName,
    seriesLabel,
    project?.name,
    project?.slug,
    draft.name,
    draft.alertType,
    draft.graphAlert,
    draft.report.sourceKind,
  ]);

  useEffect(() => {
    if (!channel || section !== "configuration") {
      setPreview(undefined);
      return;
    }
    const token = ++previewToken.current;
    const templates = templatesFromDraft(draft);
    // A report renders against the report defaults, an alert against the alert
    // defaults — otherwise the preview shows a message the dispatcher would
    // never send. Same resolver the providers and dispatch use, so the three
    // surfaces cannot drift apart.
    const previewDefaults = defaultsForSourceKind(
      isGraphAlert ? "graphAlert" : isReport ? "report" : "trace",
    );
    // Mirror the provider's delivery rules (Slack: modern blocks render only
    // over a bot connection) so the preview never promises more than the
    // configured channel will deliver.
    const entry = draft.action ? CLIENT_PROVIDERS[draft.action] : undefined;
    const renderOptions =
      entry && isNotifyEntry(entry) && entry.client.previewOptions
        ? entry.client.previewOptions(draft.slices[draft.action!] as never)
        : {};
    void (async () => {
      try {
        if (channel === "email") {
          const rendered = await renderTriggerEmail({
            subjectTemplate: templates.emailSubjectTemplate,
            bodyTemplate: templates.emailBodyTemplate,
            context: previewContext,
            defaults: previewDefaults,
          });
          if (token === previewToken.current) {
            setPreview({
              channel: "email",
              subject: rendered.subject,
              html: rendered.html,
              usedDefault: rendered.usedDefault,
              missingVariables: rendered.missingVariables,
              errors: rendered.errors,
            });
          }
        } else if (channel === "webhook") {
          // The webhook's body lives in its slice (actionParams), not the
          // template columns — read it straight off the draft.
          const slice = draft.slices[TriggerAction.SEND_WEBHOOK];
          const rendered = await renderWebhookBody({
            template: slice.template.value.trim() ? slice.template.value : null,
            context: previewContext,
            defaultBody: previewDefaults.webhookBody,
          });
          if (token === previewToken.current) {
            setPreview({
              channel: "webhook",
              payload: {
                method: slice.method,
                url: slice.url,
                body: rendered.body,
              },
              usedDefault: rendered.usedDefault,
              missingVariables: rendered.missingVariables,
              errors: rendered.errors,
            });
          }
        } else {
          const rendered = await renderTriggerSlack({
            templateType:
              templates.slackTemplateType === "block_kit"
                ? "block_kit"
                : templates.slackTemplateType === "string"
                  ? "string"
                  : null,
            template: templates.slackTemplate,
            context: previewContext,
            defaults: previewDefaults,
            allowGatedBlocks: renderOptions.allowGatedBlocks ?? false,
          });
          if (token === previewToken.current) {
            setPreview({
              channel: "slack",
              payload: rendered.payload,
              usedDefault: rendered.usedDefault,
              missingVariables: rendered.missingVariables,
              errors: rendered.errors,
            });
          }
        }
      } catch {
        // Render failures fall back inside the templating module; the
        // outer catch is just a belt for unanticipated throws.
        if (token === previewToken.current) setPreview(undefined);
      }
    })();
  }, [
    channel,
    section,
    draft.action,
    draft.slices,
    previewContext,
    isGraphAlert,
    isReport,
  ]);

  // Edit mode must not render the (blank) INITIAL_DRAFT form while the saved
  // row is still loading: a keystroke during the load makes the hydration
  // guard above treat the draft as already-edited and skip hydration, so a
  // later Save would overwrite the saved automation with a near-blank draft.
  // Show a skeleton until the row lands, and an error state if it never does.
  const editLoading = !!automationId && triggerQuery.isLoading;
  const editError = !!automationId && triggerQuery.isError;
  const webhookReadOnly =
    !!automationId &&
    draft.action === TriggerAction.SEND_WEBHOOK &&
    !webhookEnabled;

  const testFire = api.automation.testFireTemplate.useMutation();
  const upsert = api.automation.upsert.useMutation();
  const nameSet = draft.name.trim().length > 0;
  // Cadence is an always-visible inline facet now (ADR-043), so there is no
  // "confirm the cadence" detour to gate on — subject + cadence validity is
  // folded into conditionsSet.
  const canSave =
    nameSet &&
    conditionsSet &&
    configComplete &&
    !editLoading &&
    !editError &&
    !webhookReadOnly;

  const onTestFire = useCallback(() => {
    if (!channel || !projectId || !draft.action) return;
    const entry = CLIENT_PROVIDERS[draft.action];
    if (!isNotifyEntry(entry)) return;
    const target = entry.client.testFireTarget(
      draft.slices[draft.action] as never,
    );
    testFire.mutate(
      // Alert drafts carry a non-null `graphAlert` so the server renders the
      // alert-shaped example context (not trace matches) — see
      // `buildTestFirePayload`.
      buildTestFirePayload({
        draft,
        projectId,
        channel,
        webhook: target.webhook,
        botDestination: target.botDestination,
        webhookDestination: target.webhookDestination,
        automationId,
        graphName,
        seriesLabel,
      }),
      {
        onSuccess: (r) => {
          pushAttempt({
            at: Date.now(),
            channel: r.channel,
            status: "success",
            recipientCount: r.recipientCount,
            usedDefault: r.usedDefault,
            httpStatus: r.httpStatus,
          });
          toaster.create({
            title: "Test fire sent",
            type: "success",
            description:
              r.channel === "email"
                ? "Sent to your inbox."
                : r.channel === "webhook"
                  ? `Your endpoint answered HTTP ${r.httpStatus ?? "2xx"}.`
                  : "Posted to Slack.",
            meta: { closable: true },
          });
        },
        onError: (err) => {
          const domain = readHandledError(err);
          const { title, description } = domain
            ? explainHandledError(domain)
            : { title: "Test fire failed", description: err.message };
          pushAttempt({
            at: Date.now(),
            channel,
            status: "failure",
            errorTitle: title,
            errorDetail: description || err.message,
          });
          toaster.create({
            title,
            type: "error",
            description: description || err.message,
            meta: { closable: true },
          });
        },
      },
    );
  }, [
    channel,
    draft,
    projectId,
    testFire,
    pushAttempt,
    isGraphAlert,
    graphName,
    seriesLabel,
  ]);

  const onSave = useCallback(() => {
    if (!canSave || !draft.action) return;
    upsert.mutate(
      {
        projectId,
        // Omit triggerId entirely on create — Zod's `.optional()` accepts a
        // missing key cleanly, but `triggerId: undefined` round-trips
        // inconsistently through superjson depending on tRPC version.
        ...(automationId ? { triggerId: automationId } : {}),
        name: draft.name,
        action: draft.action,
        alertType: draft.alertType ?? undefined,
        filters: draft.source === "customGraph" ? {} : draft.filters,
        // ADR-043 Subject facet: send the liqe query for a trace automation AND
        // for a report — a trace-query report is scoped by exactly this query,
        // and the router persists it for that source (it nulls the column for
        // graph/dashboard report sources itself). Only a graph alert never has
        // one. When set the router persists `filters` as `{}` and matches the
        // query in-memory.
        filterQuery:
          draft.source === "customGraph" ? null : draft.filterQuery || null,
        customGraphId:
          draft.source === "customGraph" ? draft.customGraphId : null,
        // The graph-alert threshold rule travels alongside the destination
        // keys; the router merges them into the persisted `actionParams`.
        graphAlert:
          draft.source === "customGraph" ? draft.graphAlert : undefined,
        report:
          draft.source === "report"
            ? reportInputFromDraft(draft.report)
            : undefined,
        actionParams: actionParamsFromDraft(draft) as never,
        templates: templatesFromDraft(draft),
        notificationCadence: draft.notificationCadence,
        traceDebounceMs: draft.traceDebounceMs,
      },
      {
        onSuccess: () => {
          toaster.create({
            title: automationId ? labels.updatedToast : labels.createdToast,
            type: "success",
            meta: { closable: true },
          });
          void queryClient.automation.getTriggers.invalidate();
          // The dashboard chart card reads its alert state off the graph, not
          // off the trigger list: without these the card still offers "Add
          // alert" after one was just created, and clicking it re-enters CREATE
          // mode — whose upsert overwrites the trigger that was just saved.
          void queryClient.graphs.getAll.invalidate();
          void queryClient.graphs.getById.invalidate();
          closeDrawer();
        },
        onError: (err) => {
          if (isHandledByGlobalHandler(err)) return;
          const domain = readHandledError(err);
          const { title, description } = domain
            ? explainHandledError(domain)
            : { title: "Could not save automation", description: err.message };
          toaster.create({
            title,
            type: "error",
            description: description || err.message,
            meta: { closable: true },
          });
        },
      },
    );
  }, [
    automationId,
    canSave,
    closeDrawer,
    draft,
    projectId,
    queryClient,
    upsert,
  ]);

  // Alerts always deliver immediately (the server pins their cadence), so
  // template pickers and variable filtering treat them as immediate even if
  // the dormant draft cadence says otherwise.
  const cadenceMode: "immediate" | "digest" =
    isGraphAlert || draft.notificationCadence === "immediate"
      ? "immediate"
      : "digest";
  const hasEvaluationFilter = Object.keys(draft.filters).some((k) =>
    k.startsWith("evaluations."),
  );

  const configCtx = useMemo<ConfigFormCtx<NotifyPreview>>(
    () => ({
      projectId,
      organizationId: organization?.id,
      teamSlug: team?.slug,
      // Lets a provider (Slack channel picker) act on the stored secret of the
      // automation being edited without the author retyping it.
      automationId,
      // Each source renders against its OWN context — autocomplete, hover, and
      // the unknown-variable check all follow the matching list, so a report
      // never offers `match.trace.*` variables that would render empty.
      variables: isReport
        ? REPORT_TEMPLATE_VARIABLES
        : isGraphAlert
          ? ALERT_TEMPLATE_VARIABLES
          : TEMPLATE_VARIABLES,
      example: previewContext,
      preview,
      // Synchronous render — there is never a loading state to show.
      previewLoading: false,
      cadenceMode,
      notificationCadence: draft.notificationCadence,
      setNotificationCadence: (value) =>
        dispatch({ type: "SET_CADENCE", value: value as NotificationCadence }),
      hasEvaluationFilter,
      // Providers seed editor defaults from this AND filter the template
      // gallery by it, so a report never offers the per-trace layouts.
      sourceKind:
        draft.source === "customGraph"
          ? "graphAlert"
          : draft.source === "report"
            ? "report"
            : "trace",
      // Narrows a report's layouts to the content it actually sends.
      reportSourceKind:
        draft.source === "report" ? draft.report.sourceKind : undefined,
      // Lets a notify provider offer a "Send test" button inside its config.
      onTestFire,
      testFireLoading: testFire.isLoading,
      // The latest test outcome, so a provider can render the result (HTTP
      // status / failure) inline next to its own test button.
      lastTestAttempt: testHistory[0] ?? null,
    }),
    [
      projectId,
      organization?.id,
      team?.slug,
      automationId,
      previewContext,
      isGraphAlert,
      isReport,
      preview,
      cadenceMode,
      draft.notificationCadence,
      dispatch,
      hasEvaluationFilter,
      draft.source,
      draft.report.sourceKind,
      onTestFire,
      testFire.isLoading,
      testHistory,
    ],
  );

  // Dirty when the live draft no longer matches the baseline captured at
  // hydrate/create time. Guards an accidental close from silently dropping an
  // in-progress multi-stage draft. Until the baseline lands we treat the
  // draft as clean so a close during the first paint never prompts.
  const isDirty =
    baselineRef.current !== null &&
    JSON.stringify(draft) !== baselineRef.current;

  const requestClose = useCallback(() => {
    if (isDirty) {
      setConfirmDiscardOpen(true);
      return;
    }
    closeDrawer();
  }, [isDirty, closeDrawer]);

  return (
    <>
      <Drawer.Root
        open={section === null}
        placement="end"
        size="lg"
        onOpenChange={({ open }) => {
          if (!open && section === null) requestClose();
        }}
      >
        <Drawer.Content bg="bg">
          <Drawer.Header>
            <Drawer.CloseTrigger />
            <Heading size="md">{labels.title}</Heading>
          </Drawer.Header>
          <Drawer.Body>
            {source === "email-link" ? <EmailLinkLandingBanner /> : null}
            {/* The form was visually heavy — every control at its default size.
                Rather than thread a smaller `size` through dozens of controls
                across every section (and drift over time), scale the whole form
                surface down here. Contained to the drawer body, so the
                header/footer and the rest of the app are untouched. */}
            {editError ? (
              <Box
                padding={3}
                borderRadius="md"
                border="1px solid"
                colorPalette="red"
                borderColor="colorPalette.muted"
                bg="colorPalette.subtle"
              >
                <Text textStyle="sm" color="fg">
                  Couldn't load this {labels.noun}. Close the drawer and try
                  again.
                </Text>
              </Box>
            ) : editLoading ? (
              <VStack
                align="stretch"
                gap={4}
                data-testid="automation-edit-loading"
              >
                <Skeleton height="32px" width="60%" />
                <Skeleton height="80px" width="full" />
                <Skeleton height="80px" width="full" />
                <Skeleton height="80px" width="full" />
              </VStack>
            ) : (
              <Box css={{ zoom: 0.9 }}>
                <MainSectionList
                  isEdit={!!automationId}
                  sourceLocked={sourceLocked}
                  prefilledGraphId={prefilledGraphId}
                  webhookEnabled={webhookEnabled}
                />
              </Box>
            )}
          </Drawer.Body>
          <Drawer.Footer>
            <HStack width="full">
              <Spacer />
              {/* Send test sits next to Save (ADR-043 feedback): once a notify
                  channel is set up, fire the real message before committing. */}
              {channel && !editLoading && !editError && !webhookReadOnly ? (
                <Tooltip
                  content="Finish the delivery setup to send a test."
                  disabled={configComplete}
                >
                  <Button
                    variant="outline"
                    onClick={onTestFire}
                    loading={testFire.isLoading}
                    disabled={!configComplete}
                  >
                    <Send size={14} /> Send test
                  </Button>
                </Tooltip>
              ) : null}
              <Tooltip
                content={saveDisabledReason({
                  draft,
                  nameSet,
                  configComplete,
                  actionPicked: !!draft.action,
                  webhookReadOnly,
                })}
                disabled={canSave}
              >
                <Button
                  colorPalette="orange"
                  onClick={onSave}
                  loading={upsert.isLoading}
                  disabled={!canSave}
                >
                  {labels.saveButton}
                </Button>
              </Tooltip>
            </HStack>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer.Root>

      <ConfigurationSecondaryDrawer
        open={section === "configuration"}
        ctx={configCtx}
        onDone={() => setSection(null)}
      />

      <Dialog.Root
        open={confirmDiscardOpen}
        onOpenChange={({ open }) => {
          if (!open) setConfirmDiscardOpen(false);
        }}
        size="sm"
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Discard unsaved changes?</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Text color="fg.muted" textStyle="sm">
              This {labels.noun} has changes you haven't saved yet. Close the
              drawer and discard them?
            </Text>
          </Dialog.Body>
          <Dialog.Footer>
            <HStack gap={2}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDiscardOpen(false)}
              >
                Keep editing
              </Button>
              <Button
                colorPalette="red"
                size="sm"
                onClick={() => {
                  setConfirmDiscardOpen(false);
                  closeDrawer();
                }}
              >
                Discard
              </Button>
            </HStack>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}

/**
 * One-line landing context for users who arrived here from the "Edit
 * automation" link in a trigger email. Kept inline rather than as a toast
 * because the user already changed page — a toast on a fresh load is easy
 * to miss; a banner above the form gives them the orientation they need.
 */
function EmailLinkLandingBanner() {
  return (
    <Box
      mb={3}
      padding={3}
      borderRadius="md"
      border="1px solid"
      colorPalette="blue"
      borderColor="colorPalette.muted"
      bg="colorPalette.subtle"
    >
      <HStack gap={2} align="start">
        <Box color="colorPalette.fg" flexShrink={0} mt="2px">
          <Mail size={16} />
        </Box>
        <Text textStyle="sm" color="fg">
          Opened from an email notification. You're editing the automation that
          produced that alert.
        </Text>
      </HStack>
    </Box>
  );
}
