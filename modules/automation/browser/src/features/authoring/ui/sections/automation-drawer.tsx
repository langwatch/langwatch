import { Box, Button, Heading, HStack, Skeleton, Spacer, Text, VStack } from "@chakra-ui/react";
import {
  DEFAULT_TRACE_DEBOUNCE_MS,
  MAX_TRACE_DEBOUNCE_MS,
  MIN_TRACE_DEBOUNCE_MS,
  NOTIFICATION_CADENCES,
  AlertType,
  parseAutomationFiltersWire,
  parseTriggerTemplatesWire,
  type NotificationCadence,
  TriggerAction,
  defaultsForSourceKind,
  EXAMPLE_MATCHES,
  TEMPLATE_VARIABLES,
  renderTriggerEmail,
  renderTriggerSlack,
  renderWebhookBody,
  buildExampleGraphAlertTemplateContext,
  buildExampleReportTemplateContext,
  buildTemplateContext,
  type GraphAlertTemplateContext,
  type ReportTemplateContext,
  type TemplateContext,
} from "@langwatch/automation-contract";
import type { UiAutomationDrawerProps } from "@langwatch/browser-host/drawer";
import { Drawer } from "@langwatch/design-system/drawer";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { NamedSlackConnection } from "@langwatch/slack-browser-kit";
import { nowInstant } from "@langwatch/time";
import { Mail, Send } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { api, type RouterOutputs } from "../../../../behavior/automation-api.ts";
import {
  useAutomationToaster,
  useDescribeError,
  useShowErrorToast,
} from "../../../../behavior/automation-feedback.ts";
import {
  useAppBaseUrl,
  useCloseAddressedDrawer,
  useOrganizationTeamProject,
} from "../../../../behavior/automation-session.ts";
import { useAutomationHost } from "../../../../model/automation-host.ts";
import { readHandledError } from "../../../../model/handled-error.ts";
import { type ConfigFormCtx } from "../../../../model/provider-types.ts";
import {
  ALERT_TEMPLATE_VARIABLES,
  REPORT_TEMPLATE_VARIABLES,
} from "../../../liquid-editor/index.ts";
import {
  consumeDraftKeptOnSubFlowReturn,
  isHandingOverToSubFlow,
} from "../../behavior/sub-flow.ts";
import { useDatasetName } from "../../behavior/use-dataset-name.ts";
import { useDiscardGuard } from "../../behavior/use-discard-guard.ts";
import { useSlackConnectionName } from "../../behavior/use-slack-connection-name.ts";
import { withSlackConnectionName } from "../../model/slack-connection-name.ts";
import { findNextStep, findPreviousStep, type WizardStep } from "../../model/wizard-steps.ts";
import { DiscardChangesDialog } from "../blocks/discard-changes-dialog.tsx";
import {
  useConditionsSet,
  useConfigComplete,
  useDraft,
  useHasInvalidConditionRows,
  useSection,
  useWizardStep,
} from "./automation-selectors.ts";
import { useAutomationStore } from "./automation-store.ts";
import { AutomationWizard } from "./automation-wizard.tsx";
import { CLIENT_PROVIDERS, type NotifyPreview } from "./client-providers.ts";
import { ConfigurationSecondaryDrawer } from "./configuration-secondary-drawer.tsx";
import {
  type AutomationDraft,
  actionParamsFromDraft,
  buildTestFirePayload,
  cadenceIsSet,
  extractGraphAlertFromTriggerRow,
  extractReportFromTriggerRow,
  INITIAL_DRAFT,
  notifyChannel,
  presetLabels,
  reportInputFromDraft,
  subjectIsSet,
  templatesFromDraft,
} from "./draft-model.ts";
import { MainSectionList } from "./main-section-list.tsx";
import { useGraphAlertLabels } from "./use-graph-alert-labels.ts";

/** Maps template-validation field metadata to the editor-specific headline. */
const TEMPLATE_FIELD_TITLES: Record<string, string> = {
  emailSubjectTemplate: "Your email subject template isn't valid",
  emailBodyTemplate: "Your email body template isn't valid",
  slackTemplate: "Your Slack message template isn't valid",
  slackTemplateType: "Your Slack message format isn't valid",
};

/**
 * The headline for a rejected template, or nothing for any other failure —
 * in which case the caller's normal title selection applies.
 */
function templateValidationTitle(error: unknown): string | undefined {
  const handled = readHandledError(error);
  if (handled?.code !== "template_validation_error") return undefined;

  const field = handled.meta.field;
  return typeof field === "string" ? TEMPLATE_FIELD_TITLES[field] : undefined;
}

/** Facet-ordered "why can't I save yet" copy: Name → Subject → Cadence →
 *  Severity → Delivery. An unset subject makes cadence advice premature, so
 *  those two are mutually exclusive. */
function saveDisabledReason({
  draft,
  nameSet,
  configComplete,
  actionPicked,
  hasInvalidConditionRows,
  isRowUnavailable,
}: {
  draft: AutomationDraft;
  nameSet: boolean;
  configComplete: boolean;
  actionPicked: boolean;
  hasInvalidConditionRows: boolean;
  isRowUnavailable: boolean;
}): string {
  if (isRowUnavailable) return "This automation can't be saved until it has loaded.";
  const missing: string[] = [];
  if (!nameSet) missing.push("give it a name");
  if (hasInvalidConditionRows) missing.push("fix the attribute key marked in red");
  if (!subjectIsSet(draft)) missing.push(subjectTodo(draft));
  else if (!cadenceIsSet(draft)) missing.push(cadenceTodo(draft));
  if (draft.source === "customGraph" && draft.alertType === null) missing.push("set a severity");
  if (!actionPicked) missing.push("pick a delivery channel");
  else if (!configComplete) missing.push(deliveryTodo(draft));
  if (missing.length === 0) return "";
  return `To save, ${missing.join(" and ")}.`;
}

/** What the chosen delivery still lacks, in its own words where they are known. */
function deliveryTodo(draft: AutomationDraft): string {
  switch (draft.action) {
    case TriggerAction.ADD_TO_ANNOTATION_QUEUE:
      return "choose at least one annotator";
    case TriggerAction.SEND_EMAIL:
      return "add at least one recipient";
    case TriggerAction.ADD_TO_DATASET:
      return draft.slices[TriggerAction.ADD_TO_DATASET].datasetId
        ? "map the dataset's columns"
        : "choose a dataset";
    case TriggerAction.SEND_WEBHOOK:
      return "enter a valid endpoint URL and content type";
    case TriggerAction.SEND_SLACK_MESSAGE:
      return draft.slices[TriggerAction.SEND_SLACK_MESSAGE].slackIntegrationId
        ? "choose a Slack channel"
        : "choose a Slack connection";
    default:
      return "complete the setup";
  }
}

/** The draft as the close guard compares it. The Slack connection's and the
 *  dataset's names fill in when their lists load: display, never edits. */
function draftFingerprint(draft: AutomationDraft): string {
  return JSON.stringify(draft, (key, value) =>
    key === "connectionName" || key === "namedDataset" ? undefined : value,
  );
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
      return "set the firing threshold";
    case "report":
      return "set a schedule";
    case "trace":
      return "";
  }
}

/** The editor as the registry opens it by address, where nothing else supplies `onClose`. */
export function RegisteredAutomationDrawer({ onClose, ...props }: UiAutomationDrawerProps) {
  const close = useCloseAddressedDrawer();
  return <AutomationDrawer {...props} onClose={onClose ?? close} />;
}

/**
 * Orchestrator for the staged automation authoring drawer (ADR-036): owns
 * the data-loading lifecycle and preview/test-fire/upsert mutations, and
 * renders the drawer plus the Filters and Configuration secondaries.
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
  onClose,
}: UiAutomationDrawerProps) {
  const { project, organization, team } = useOrganizationTeamProject();
  const appBaseUrl = useAppBaseUrl();
  const projectId = project?.id ?? "";
  const host = useAutomationHost();

  const draft = useDraft();
  const section = useSection();
  const step = useWizardStep();
  const conditionsSet = useConditionsSet();
  const hasInvalidConditionRows = useHasInvalidConditionRows();
  const configComplete = useConfigComplete();
  const isGraphAlert = draft.source === "customGraph";
  // A report keeps the single-pane composer (ADR-093 §1). Read off the prefill
  // too, so a fresh one never paints a frame of the wizard or its heading.
  const isReport = draft.source === "report" || initialSource === "report";
  const labels = presetLabels({
    source: isReport ? "report" : draft.source,
    isEdit: !!automationId,
  });
  // What a saved automation watches never changes (ADR-093 §1); a drawer
  // opened from a specific chart is pinned to that graph for the same reason.
  const subjectLocked = !!automationId || !!prefilledGraphId;
  const dispatch = useAutomationStore((s) => s.dispatch);
  const setSection = useAutomationStore((s) => s.setSection);
  const setStep = useAutomationStore((s) => s.setStep);
  const hydrate = useAutomationStore((s) => s.hydrate);
  const reset = useAutomationStore((s) => s.reset);
  const pushAttempt = useAutomationStore((s) => s.pushTestAttempt);
  const testHistory = useAutomationStore((s) => s.testHistory);

  // Wipe the singleton store when the drawer really closes, so the next open
  // never paints the previous draft. A hand-over to the dataset drawer unmounts
  // this one the same way closing it does, and announces itself so the draft
  // survives the round trip.
  useDraftLifecycle(reset);

  // Baseline the close-guard diffs against: the hydrated row on edit, the
  // empty draft on create. Set once the relevant prefill settles so a clean
  // open never triggers the discard prompt.
  // Serialized because drafts are plain JSON-able objects and we only care
  // about value equality, not reference identity.
  const baselineRef = useRef<string | null>(null);

  // Editing opens on the review overview, never on Watch (ADR-093 §4).
  useEffect(() => {
    if (automationId) setStep("review");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reopening for a different automation or prefill does not remount the
  // drawer, so the identity change does by hand what unmounting would. Declared
  // above the prefill and hydration hooks: effects run in declaration order.
  const drawerIdentity = drawerIdentityOf({
    automationId,
    prefill: [
      prefilledGraphId,
      prefilledSeriesName,
      initialSource,
      initialName,
      initialAction,
      initialFilters,
      initialFilterQuery,
    ],
  });
  useResetOnIdentityChange({ drawerIdentity, automationId, reset, setStep, baselineRef });

  // Pre-fill graph mode from drawer params on a fresh create (the dashboard's
  // "Add automation" entry): the graph and series arrive selected and locked,
  // so the author lands on the threshold rule.
  usePrefillFromGraph({
    automationId,
    drawerIdentity,
    prefilledGraphId,
    prefilledSeriesName,
    dispatch,
  });

  // Pre-fill identity and kind from drawer params on a fresh create (a
  // use-case card seeds a name and action too). SET_SOURCE runs first because
  // switching to customGraph resets any action a graph watcher refuses.
  usePrefillFromParams({
    automationId,
    drawerIdentity,
    initialSource,
    initialName,
    initialAction,
    initialFilters,
    initialFilterQuery,
    dispatch,
  });

  // Edit prefill from the saved trigger.
  const triggerQuery = api.automation.getTriggerById.useQuery(
    { triggerId: automationId ?? "", projectId },
    { enabled: !!automationId && !!projectId },
  );
  // Gate hydration to the FIRST successful read per automationId. tRPC's
  // background refetch (window-focus, query invalidation) would otherwise
  // re-fire this effect mid-session and overwrite unsaved edits with the
  // last-saved row.
  const slackConnections = useSlackConnectionName({ projectId, draft, dispatch });
  useDatasetName({ projectId, draft, dispatch });
  useHydrateFromServer({
    automationId,
    row: triggerQuery.data,
    hydrate,
    baselineRef,
    slackConnections,
  });

  // Capture the create-mode baseline once the prefill effects above have had a
  // chance to land (they run on mount before this commits). After this, any
  // change to the draft reads as unsaved and the close-guard kicks in.
  useCreateBaseline({ automationId, drawerIdentity, baselineRef });

  // Build the example TemplateContext the preview pane (and autocomplete)
  // render against. Static-ish — only depends on the project identity, so the
  // example URLs come out plausible (`/<slug>/traces/<trace>`). Pulled
  // directly from the shared templating module — no more parallel client copy.

  // Live preview for the active notify channel, client-side via the shared
  // templating module. No debounce -- Liquid renders are sub-millisecond,
  // so every keystroke updates. A monotonic token guards against a slow
  // render returning out of order.
  const channel = notifyChannel(draft);
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
  useSeedNameFromGraph({ automationId, drawerIdentity, prefilledGraphId, graphName, dispatch });
  const previewContext = usePreviewContext({
    appBaseUrl,
    projectName: project?.name,
    projectSlug: project?.slug,
    isReport,
    isGraphAlert,
    name: draft.name,
    alertType: draft.alertType,
    graphAlert: draft.graphAlert,
    reportSourceKind: draft.report.sourceKind,
    graphName,
    seriesLabel,
  });

  const previewDraft = useMemo(
    () => ({ ...INITIAL_DRAFT, action: draft.action, slices: draft.slices }),
    [draft.action, draft.slices],
  );
  const preview = useNotifyPreview({
    channel: section === "configuration" ? channel : null,
    draft: previewDraft,
    context: previewContext,
    sourceKind: previewSourceKindOf({ isGraphAlert, isReport }),
  });

  // Edit mode must not render the (blank) INITIAL_DRAFT form while the saved
  // row is still loading: a keystroke during the load makes the hydration
  // guard above treat the draft as already-edited and skip hydration, so a
  // later Save would overwrite the saved automation with a near-blank draft.
  // Show a skeleton until the row lands, and an error state if it never does.
  const editLoading = !!automationId && triggerQuery.isLoading;
  const editError = !!automationId && triggerQuery.isError;
  const nameSet = draft.name.trim().length > 0;
  // Subject and cadence validity fold into conditionsSet (ADR-043). An invalid
  // condition row is excluded from the emitted query, so it holds Save too:
  // saving past it would persist a wider automation than the one on screen.
  const canSave =
    nameSet &&
    conditionsSet &&
    !hasInvalidConditionRows &&
    configComplete &&
    !editLoading &&
    !editError;
  const saveBlockedReason = saveDisabledReason({
    draft,
    nameSet,
    configComplete,
    actionPicked: !!draft.action,
    hasInvalidConditionRows,
    isRowUnavailable: editLoading || editError,
  });

  const { onTestFire, testFire } = useTestFire({
    channel,
    draft,
    projectId,
    pushAttempt,
    automationId,
    graphName,
    seriesLabel,
  });

  const { onSave, upsert } = useSaveAutomation({
    draft,
    canSave,
    saveBlockedReason,
    projectId,
    automationId,
    labels,
    onClose,
  });

  // Alerts always deliver immediately (the server pins their cadence), so
  // template pickers and variable filtering treat them as immediate even if
  // the dormant draft cadence says otherwise.
  const cadenceMode: "immediate" | "digest" =
    isGraphAlert || draft.notificationCadence === "immediate" ? "immediate" : "digest";
  const hasEvaluationFilter = Object.keys(draft.filters).some((k) => k.startsWith("evaluations."));

  // Each source renders against its OWN context — autocomplete, hover, and the
  // unknown-variable check all follow the matching list, so a report never
  // offers `match.trace.*` variables that would render empty.
  const templateVariables = templateVariablesFor({ isGraphAlert, isReport });

  // Providers seed editor defaults from this AND filter the template gallery
  // by it, so a report never offers the per-trace layouts.
  const providerSourceKind = previewSourceKindOf({
    isGraphAlert: draft.source === "customGraph",
    isReport: draft.source === "report",
  });

  const configCtx = useMemo<ConfigFormCtx<NotifyPreview>>(
    () => ({
      projectId,
      organizationId: organization?.id,
      teamSlug: team?.slug,
      // Lets a provider (Slack channel picker) act on the stored secret of the
      // automation being edited without the author retyping it.
      automationId,
      variables: templateVariables,
      example: previewContext,
      preview,
      // Synchronous render — there is never a loading state to show.
      previewLoading: false,
      cadenceMode,
      notificationCadence: draft.notificationCadence,
      setNotificationCadence: (value) =>
        dispatch({ type: "SET_CADENCE", value: value as NotificationCadence }),
      hasEvaluationFilter,
      sourceKind: providerSourceKind,
      // Narrows a report's layouts to the content it actually sends.
      reportSourceKind: draft.source === "report" ? draft.report.sourceKind : undefined,
      // Lets a notify provider offer a "Send test" button inside its config.
      onTestFire,
      testFireLoading: testFire.isPending,
      // The latest test outcome, so a provider can render the result (HTTP
      // status / failure) inline next to its own test button.
      lastTestAttempt: testHistory[0] ?? null,
    }),
    [
      projectId,
      organization?.id,
      team?.slug,
      automationId,
      templateVariables,
      previewContext,
      preview,
      cadenceMode,
      draft.notificationCadence,
      dispatch,
      hasEvaluationFilter,
      providerSourceKind,
      draft.source,
      draft.report.sourceKind,
      onTestFire,
      testFire.isPending,
      testHistory,
    ],
  );

  // Dirty when the live draft no longer matches the baseline captured at
  // hydrate/create time. Guards an accidental close from silently dropping an
  // in-progress multi-stage draft. Until the baseline lands we treat the
  // draft as clean so a close during the first paint never prompts.
  const isDirty = baselineRef.current !== null && draftFingerprint(draft) !== baselineRef.current;

  // Save and test fire live on the review overview; every other wizard step
  // gets navigation instead. A report keeps its single pane, so always Save.
  const showStepNavigation = !isReport && step !== "review";

  const discardGuard = useDiscardGuard({
    isDirty,
    onClose,
    onCreateNew: () => host.openDrawer({ drawer: "automation", params: {} }),
  });
  const requestClose = () => discardGuard.request("close");

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
            <DrawerBodyContent
              editError={editError}
              editLoading={editLoading}
              noun={labels.noun}
              isEdit={!!automationId}
              isReport={isReport}
              prefilledGraphId={prefilledGraphId}
              projectId={projectId}
              subjectLocked={subjectLocked}
              graphName={graphName}
              seriesLabel={seriesLabel}
              onCreateNew={() => discardGuard.request("createNew")}
            />
          </Drawer.Body>
          <Drawer.Footer>
            <HStack width="full">
              <Spacer />
              {showStepNavigation ? (
                <StepNavigation step={step} isEdit={!!automationId} onStep={setStep} />
              ) : (
                <DrawerFooterActions
                  showTestFire={!!channel && !editLoading && !editError}
                  configComplete={configComplete}
                  onTestFire={onTestFire}
                  testFiring={testFire.isPending}
                  saveBlockedReason={saveBlockedReason}
                  canSave={canSave}
                  onSave={onSave}
                  saving={upsert.isPending}
                  saveLabel={labels.saveButton}
                  saveTestId={`automation-save-${labels.noun}`}
                />
              )}
            </HStack>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer.Root>

      <ConfigurationSecondaryDrawer
        open={section === "configuration"}
        ctx={configCtx}
        onDone={() => setSection(null)}
      />

      <DiscardChangesDialog
        pendingTarget={discardGuard.pendingTarget}
        noun={labels.noun}
        onKeepEditing={discardGuard.keepEditing}
        onDiscard={discardGuard.discard}
      />
    </>
  );
}

/**
 * Landing context for users arriving via the "Edit automation" email link.
 * Inline, not a toast: a toast on a fresh load is easy to miss, but a
 * banner above the form orients them.
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
          Opened from an email notification. You're editing the automation that sent it.
        </Text>
      </HStack>
    </Box>
  );
}

type Dispatch = ReturnType<typeof useAutomationStore.getState>["dispatch"];

/** Opens a fresh create in graph-alert mode on the dashboard's graph and series, locked. */
function usePrefillFromGraph({
  automationId,
  drawerIdentity,
  prefilledGraphId,
  prefilledSeriesName,
  dispatch,
}: {
  automationId: string | undefined;
  drawerIdentity: string;
  prefilledGraphId: string | undefined;
  prefilledSeriesName: string | undefined;
  dispatch: Dispatch;
}) {
  // Latched per drawer identity, so a new opening prefills again.
  const prefilledFor = useRef<string | null>(null);
  useEffect(() => {
    if (automationId) return;
    if (prefilledFor.current === drawerIdentity) return;
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
    prefilledFor.current = drawerIdentity;
    // Latch + identity: everything else read here is frozen per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerIdentity]);
}

/** Seeds a fresh create's identity and kind from the drawer params, once per opening. */
function usePrefillFromParams({
  automationId,
  drawerIdentity,
  initialSource,
  initialName,
  initialAction,
  initialFilters,
  initialFilterQuery,
  dispatch,
}: {
  automationId: string | undefined;
  drawerIdentity: string;
  initialSource: string | undefined;
  initialName: string | undefined;
  initialAction: string | undefined;
  initialFilters: string | undefined;
  initialFilterQuery: string | undefined;
  dispatch: Dispatch;
}) {
  const prefilledFor = useRef<string | null>(null);
  useEffect(() => {
    if (automationId) return;
    if (prefilledFor.current === drawerIdentity) return;
    const nothingPrefilled =
      !initialSource && !initialName && !initialAction && !initialFilters && !initialFilterQuery;
    if (nothingPrefilled) return;
    applyParamPrefill({
      dispatch,
      initialSource,
      initialName,
      initialAction,
      initialFilters,
      initialFilterQuery,
    });
    prefilledFor.current = drawerIdentity;
    // Latch + identity: everything else read here is frozen per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerIdentity]);
}

/** Who this opening is for: the automation on edit, the whole prefill set on create. */
function drawerIdentityOf({
  automationId,
  prefill,
}: {
  automationId: string | undefined;
  prefill: (string | undefined)[];
}): string {
  if (automationId) return `edit:${automationId}`;
  return `create:${prefill.map((value) => value ?? "").join("|")}`;
}

/**
 * `openDrawer` replaces the params in place, so the instance and the singleton store
 * survive a move to another automation or prefill. Blank the draft and the baseline;
 * the create-baseline hook re-captures it once the new prefills have landed.
 */
function useResetOnIdentityChange({
  drawerIdentity,
  automationId,
  reset,
  setStep,
  baselineRef,
}: {
  drawerIdentity: string;
  automationId: string | undefined;
  reset: () => void;
  setStep: (step: WizardStep) => void;
  baselineRef: BaselineRef;
}) {
  const openedFor = useRef(drawerIdentity);
  useEffect(() => {
    if (openedFor.current === drawerIdentity) return;
    openedFor.current = drawerIdentity;
    reset();
    baselineRef.current = null;
    setStep(automationId ? "review" : "watch");
  }, [drawerIdentity, automationId, reset, setStep, baselineRef]);
}

/** Mid-wizard, the footer moves between steps: an edit returns to the overview,
 *  a create walks forward. Saving belongs to the review overview. */
function StepNavigation({
  step,
  isEdit,
  onStep,
}: {
  step: WizardStep;
  isEdit: boolean;
  onStep: (step: WizardStep) => void;
}) {
  if (isEdit) {
    return (
      <Button colorPalette="orange" onClick={() => onStep("review")}>
        Done
      </Button>
    );
  }
  return (
    <>
      {findPreviousStep(step).map((previous) => (
        <Button key={previous} variant="ghost" onClick={() => onStep(previous)}>
          Back
        </Button>
      ))}
      {findNextStep(step).map((next) => (
        <Button key={next} colorPalette="orange" onClick={() => onStep(next)}>
          Continue
        </Button>
      ))}
    </>
  );
}

type SavedTriggerRow = NonNullable<RouterOutputs["automation"]["getTriggerById"]>;

/** The draft an edit opens on, read from the saved row. */
function draftFromTriggerRow(row: SavedTriggerRow): AutomationDraft {
  const action = row.action as TriggerAction;
  const provider = CLIENT_PROVIDERS[action];
  const filters = parseAutomationFiltersWire(row.filters);
  const templates = parseTriggerTemplatesWire(row);
  // The row's KIND is what it is — a REPORT hydrated as a trace automation
  // would lose its schedule and content source on the next Save (the router
  // rewrites the row from what the drawer sends). `customGraphId` is only a
  // reliable signal for alerts, so read `triggerKind` first.
  const isReportRow = row.triggerKind === "REPORT";
  let source: "trace" | "customGraph" | "report";
  if (isReportRow) {
    source = "report";
  } else if (row.customGraphId) {
    source = "customGraph";
  } else {
    source = "trace";
  }
  const next: AutomationDraft = {
    ...INITIAL_DRAFT,
    action,
    name: row.name,
    alertType: row.alertType,
    source,
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
    report: isReportRow ? extractReportFromTriggerRow(row.actionParams) : INITIAL_DRAFT.report,
    filters,
    // Defensive narrow: column is a free-form TEXT (see the repo parser).
    notificationCadence: (NOTIFICATION_CADENCES as readonly string[]).includes(
      row.notificationCadence,
    )
      ? (row.notificationCadence as NotificationCadence)
      : "immediate",
    // Clamp to the same bounds the router enforces so a stale row outside
    // the window doesn't render as an invalid value in the field.
    traceDebounceMs: Math.min(
      MAX_TRACE_DEBOUNCE_MS,
      Math.max(
        MIN_TRACE_DEBOUNCE_MS,
        typeof row.traceDebounceMs === "number" ? row.traceDebounceMs : DEFAULT_TRACE_DEBOUNCE_MS,
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
        emailSubjectTemplate: templates.emailSubjectTemplate,
        emailBodyTemplate: templates.emailBodyTemplate,
        slackTemplate: templates.slackTemplate,
        slackTemplateType: templates.slackTemplateType,
      }),
    },
  };
  return next;
}

type PreviewSourceKind = "graphAlert" | "report" | "trace";

function previewSourceKindOf({
  isGraphAlert,
  isReport,
}: {
  isGraphAlert: boolean;
  isReport: boolean;
}): PreviewSourceKind {
  if (isGraphAlert) return "graphAlert";
  if (isReport) return "report";
  return "trace";
}

type PreviewChannel = NonNullable<ReturnType<typeof notifyChannel>>;
type PreviewContext = TemplateContext | GraphAlertTemplateContext | ReportTemplateContext;

/** The rendered message a channel would send, under the same defaults and delivery rules. */
async function renderNotifyPreview({
  channel,
  draft,
  context: previewContext,
  sourceKind: previewSourceKind,
}: {
  channel: PreviewChannel;
  draft: AutomationDraft;
  context: PreviewContext;
  sourceKind: PreviewSourceKind;
}): Promise<NotifyPreview> {
  const templates = templatesFromDraft(draft);
  const previewDefaults = defaultsForSourceKind(previewSourceKind);
  // Mirror the provider's delivery rules (Slack: modern blocks render only
  // over a bot connection) so the preview never promises more than the
  // configured channel will deliver.
  const renderOptions = (() => {
    switch (draft.action) {
      case TriggerAction.SEND_EMAIL:
        return (
          CLIENT_PROVIDERS.SEND_EMAIL.client.previewOptions?.({ slice: draft.slices.SEND_EMAIL }) ??
          {}
        );
      case TriggerAction.SEND_SLACK_MESSAGE:
        return (
          CLIENT_PROVIDERS.SEND_SLACK_MESSAGE.client.previewOptions?.({
            slice: draft.slices.SEND_SLACK_MESSAGE,
          }) ?? {}
        );
      case TriggerAction.SEND_WEBHOOK:
        return (
          CLIENT_PROVIDERS.SEND_WEBHOOK.client.previewOptions?.({
            slice: draft.slices.SEND_WEBHOOK,
          }) ?? {}
        );
      default:
        return {};
    }
  })();
  if (channel === "email") {
    const rendered = await renderTriggerEmail({
      subjectTemplate: templates.emailSubjectTemplate,
      bodyTemplate: templates.emailBodyTemplate,
      context: previewContext,
      defaults: previewDefaults,
    });
    return {
      channel: "email",
      subject: rendered.subject,
      html: rendered.html,
      usedDefault: rendered.usedDefault,
      missingVariables: rendered.missingVariables,
      errors: rendered.errors,
    };
  } else if (channel === "webhook") {
    // The webhook's body lives in its slice (actionParams), not the
    // template columns — read it straight off the draft.
    const slice = draft.slices[TriggerAction.SEND_WEBHOOK];
    const rendered = await renderWebhookBody({
      template: slice.template.value.trim() ? slice.template.value : null,
      context: previewContext,
      defaultBody: previewDefaults.webhookBody,
    });
    return {
      channel: "webhook",
      payload: {
        method: slice.method,
        url: slice.url,
        body: rendered.body,
      },
      usedDefault: rendered.usedDefault,
      missingVariables: rendered.missingVariables,
      errors: rendered.errors,
    };
  } else {
    let slackTemplateType: "block_kit" | "string" | null;
    if (templates.slackTemplateType === "block_kit") {
      slackTemplateType = "block_kit";
    } else if (templates.slackTemplateType === "string") {
      slackTemplateType = "string";
    } else {
      slackTemplateType = null;
    }
    const rendered = await renderTriggerSlack({
      templateType: slackTemplateType,
      template: templates.slackTemplate,
      context: previewContext,
      defaults: previewDefaults,
      allowGatedBlocks: renderOptions.allowGatedBlocks ?? false,
    });
    return {
      channel: "slack",
      payload: rendered.payload,
      usedDefault: rendered.usedDefault,
      missingVariables: rendered.missingVariables,
      errors: rendered.errors,
    };
  }
}

/** Re-renders the preview when its channel, slice or context changes; the latest render wins. */
function useNotifyPreview({
  channel,
  draft,
  context,
  sourceKind,
}: {
  channel: ReturnType<typeof notifyChannel> | null;
  draft: AutomationDraft;
  context: PreviewContext;
  sourceKind: PreviewSourceKind;
}): NotifyPreview | undefined {
  const [preview, setPreview] = useState<NotifyPreview | undefined>(undefined);
  const previewToken = useRef(0);

  useEffect(() => {
    if (!channel) {
      setPreview(undefined);
      return;
    }
    const token = ++previewToken.current;
    renderNotifyPreview({ channel, draft, context, sourceKind })
      .then((rendered) => {
        if (token === previewToken.current) setPreview(rendered);
      })
      .catch(() => {
        // Render failures fall back inside the templating module; this is a
        // belt for unanticipated throws.
        if (token === previewToken.current) setPreview(undefined);
      });
  }, [channel, draft, context, sourceKind]);

  return preview;
}

/** Each source renders against its own variables, so a report never offers `match.trace.*`. */
function templateVariablesFor({
  isGraphAlert,
  isReport,
}: {
  isGraphAlert: boolean;
  isReport: boolean;
}): typeof TEMPLATE_VARIABLES {
  if (isReport) return REPORT_TEMPLATE_VARIABLES;
  if (isGraphAlert) return ALERT_TEMPLATE_VARIABLES;
  return TEMPLATE_VARIABLES;
}

/** The prefill dispatches, SET_SOURCE first: switching to an alert resets actions alerts refuse. */
function applyParamPrefill({
  dispatch,
  initialSource,
  initialName,
  initialAction,
  initialFilters,
  initialFilterQuery,
}: {
  dispatch: Dispatch;
  initialSource: string | undefined;
  initialName: string | undefined;
  initialAction: string | undefined;
  initialFilters: string | undefined;
  initialFilterQuery: string | undefined;
}): void {
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
  if (initialAction && initialAction in CLIENT_PROVIDERS) {
    dispatch({
      type: "SET_ACTION",
      value: initialAction as TriggerAction,
    });
  }
  // Same defensive parse as edit hydration — a malformed param falls back
  // to no filters rather than crashing the open.
  if (initialFilters && initialSource !== "customGraph") {
    dispatch({
      type: "SET_FILTERS",
      value: parseAutomationFiltersWire(initialFilters),
    });
  }
  // ADR-043: seed the trace-subject query from the traces view's Automate
  // button. Only for a trace automation — customGraph/report don't carry one.
  if (initialFilterQuery && initialSource !== "customGraph" && initialSource !== "report") {
    dispatch({ type: "SET_FILTER_QUERY", value: initialFilterQuery });
  }
}

type TestFireChannel = NonNullable<ReturnType<typeof notifyChannel>>;
type PushAttempt = ReturnType<typeof useAutomationStore.getState>["pushTestAttempt"];

/** The configured channel's test destination, or none while it is incomplete. */
function testFireTargetOf(draft: AutomationDraft) {
  switch (draft.action) {
    case TriggerAction.SEND_EMAIL:
      return CLIENT_PROVIDERS.SEND_EMAIL.client.testFireTarget(draft.slices.SEND_EMAIL);
    case TriggerAction.SEND_SLACK_MESSAGE:
      return CLIENT_PROVIDERS.SEND_SLACK_MESSAGE.client.testFireTarget(
        draft.slices.SEND_SLACK_MESSAGE,
      );
    case TriggerAction.SEND_WEBHOOK:
      return CLIENT_PROVIDERS.SEND_WEBHOOK.client.testFireTarget(draft.slices.SEND_WEBHOOK);
    default:
      return null;
  }
}

function testFireDescriptionOf(result: { channel: string; httpStatus?: number | null }): string {
  if (result.channel === "email") return "Sent to your inbox.";
  if (result.channel === "webhook") {
    return `Your endpoint answered HTTP ${result.httpStatus ?? "2xx"}.`;
  }
  return "Posted to Slack.";
}

/** Sends the draft's message once, logging the attempt and toasting its outcome. */
function useTestFire({
  channel,
  draft,
  projectId,
  pushAttempt,
  automationId,
  graphName,
  seriesLabel,
}: {
  channel: TestFireChannel | null;
  draft: AutomationDraft;
  projectId: string;
  pushAttempt: PushAttempt;
  automationId: string | undefined;
  graphName: string | null;
  seriesLabel: string | null;
}) {
  const toaster = useAutomationToaster();
  const showErrorToast = useShowErrorToast();
  const describeError = useDescribeError();
  const testFire = api.automation.testFireTemplate.useMutation();

  const onTestFire = useCallback(() => {
    if (!channel || !projectId || !draft.action) return;
    const target = testFireTargetOf(draft);
    if (!target) return;
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
        slackIntegrationId: target.slackIntegrationId,
        webhookDestination: target.webhookDestination,
        automationId,
        graphName,
        seriesLabel,
      }),
      {
        onSuccess: (r) => {
          pushAttempt({
            at: nowInstant().epochMilliseconds,
            channel: r.channel,
            status: "success",
            recipientCount: r.recipientCount,
            usedDefault: r.usedDefault,
            httpStatus: r.httpStatus ?? undefined,
          });
          toaster.create({
            title: "Test fire sent",
            type: "success",
            description: testFireDescriptionOf(r),
          });
        },
        onError: (err) => {
          // The attempt log must say what the toast just said: a rejected
          // template names which editor to open and takes precedence, else
          // the log takes the host's description from the presentation
          // registry — the same sentence the toast shows.
          const templateTitle = templateValidationTitle(err);
          pushAttempt({
            at: nowInstant().epochMilliseconds,
            channel,
            status: "failure",
            errorTitle: templateTitle ?? "Test fire failed",
            errorDetail: describeError({ error: err, fallbackTitle: "Test fire failed" }),
          });
          showErrorToast({
            error: err,
            ...(templateTitle ? { title: templateTitle } : {}),
            fallbackTitle: "Test fire failed",
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
    graphName,
    seriesLabel,
    automationId,
    describeError,
    showErrorToast,
    toaster,
  ]);

  return { onTestFire, testFire };
}

/** What a save sends: the draft's own fields, each source carrying only what it persists. */
function upsertInputFromDraft({
  draft,
  action,
  projectId,
  automationId,
}: {
  draft: AutomationDraft;
  action: TriggerAction;
  projectId: string;
  automationId: string | undefined;
}) {
  return {
    projectId,
    // Omit triggerId entirely on create — Zod's `.optional()` accepts a
    // missing key cleanly, and JSON drops a key holding `undefined`
    // anyway, so writing one says nothing the omission does not.
    ...(automationId ? { triggerId: automationId } : {}),
    name: draft.name,
    action,
    alertType: draft.alertType ?? undefined,
    filters: draft.source === "customGraph" ? {} : draft.filters,
    // ADR-043 Subject facet: sent for trace and report automations (the
    // router nulls it for graph/dashboard sources); a report scoped by
    // this query persists `filters` as `{}` and matches it in-memory.
    filterQuery: draft.source === "customGraph" ? null : draft.filterQuery || null,
    customGraphId: draft.source === "customGraph" ? draft.customGraphId : null,
    // The graph-alert threshold rule travels alongside the destination
    // keys; the router merges them into the persisted `actionParams`.
    graphAlert: draft.source === "customGraph" ? draft.graphAlert : undefined,
    report: draft.source === "report" ? reportInputFromDraft(draft.report) : undefined,
    actionParams: actionParamsFromDraft(draft) as never,
    templates: templatesFromDraft(draft),
    notificationCadence: draft.notificationCadence,
    traceDebounceMs: draft.traceDebounceMs,
  };
}

/** Saves the draft, then refreshes the lists and graph cards that show it. */
function useSaveAutomation({
  draft,
  canSave,
  saveBlockedReason,
  projectId,
  automationId,
  labels,
  onClose,
}: {
  draft: AutomationDraft;
  canSave: boolean;
  /** Toasted when Save is pressed early; the button stays pressable. */
  saveBlockedReason: string;
  projectId: string;
  automationId: string | undefined;
  labels: ReturnType<typeof presetLabels>;
  onClose: () => void;
}) {
  const host = useAutomationHost();
  const toaster = useAutomationToaster();
  const showErrorToast = useShowErrorToast();
  const queryClient = api.useUtils();
  const upsert = api.automation.upsert.useMutation();

  const onSave = useCallback(() => {
    if (!canSave || !draft.action) {
      toaster.create({ title: saveBlockedReason, type: "warning" });
      return;
    }
    upsert.mutate(upsertInputFromDraft({ draft, action: draft.action, projectId, automationId }), {
      onSuccess: (saved) => {
        const viewCreated = {
          label: `View ${labels.noun}`,
          run: () =>
            host.openDrawer({ drawer: "viewAutomation", params: { automationId: saved.id } }),
        };
        toaster.create({
          title: automationId ? labels.updatedToast : labels.createdToast,
          type: "success",
          ...(automationId ? {} : { action: viewCreated }),
        });
        void queryClient.automation.getTriggers.invalidate();
        // Edit hydration reads this query once per open, so without this the
        // next open hydrates from the pre-save copy.
        void queryClient.automation.getTriggerById.invalidate();
        // The dashboard chart card reads its alert state off the graph, not
        // off the trigger list: without these the card still offers "Add
        // alert" after one was just created, and clicking it re-enters CREATE
        // mode — whose upsert overwrites the trigger that was just saved.
        void queryClient.graphs.getAll.invalidate();
        void queryClient.graphs.getById.invalidate();
        onClose();
      },
      // Save validates the same four templates, so it names the offending
      // one too — see `templateValidationTitle`.
      onError: (err) => {
        const templateTitle = templateValidationTitle(err);
        showErrorToast({
          error: err,
          ...(templateTitle ? { title: templateTitle } : {}),
          fallbackTitle: "Couldn't save automation",
        });
      },
    });
  }, [
    automationId,
    canSave,
    onClose,
    draft,
    labels,
    projectId,
    queryClient,
    saveBlockedReason,
    toaster,
    showErrorToast,
    upsert,
    host,
  ]);

  return { onSave, upsert };
}

/** The editor itself, or the load error or skeleton an edit shows until its row lands. */
function DrawerBodyContent({
  editError,
  editLoading,
  noun,
  isEdit,
  isReport,
  prefilledGraphId,
  projectId,
  subjectLocked,
  graphName,
  seriesLabel,
  onCreateNew,
}: {
  editError: boolean;
  editLoading: boolean;
  noun: string;
  isEdit: boolean;
  /** A report keeps the single-pane composer; everything else is the wizard. */
  isReport: boolean;
  prefilledGraphId: string | undefined;
  projectId: string;
  subjectLocked: boolean;
  graphName: string | null;
  seriesLabel: string | null;
  onCreateNew: () => void;
}) {
  if (editError) {
    return (
      <Box
        padding={3}
        borderRadius="md"
        border="1px solid"
        colorPalette="red"
        borderColor="colorPalette.muted"
        bg="colorPalette.subtle"
      >
        <Text textStyle="sm" color="fg">
          Couldn't load this {noun}. Close the drawer and try again.
        </Text>
      </Box>
    );
  }
  if (editLoading) {
    return (
      <VStack align="stretch" gap={4} data-testid="automation-edit-loading">
        <Skeleton height="32px" width="60%" />
        <Skeleton height="80px" width="full" />
        <Skeleton height="80px" width="full" />
        <Skeleton height="80px" width="full" />
      </VStack>
    );
  }
  return (
    <Box css={{ zoom: 0.9 }}>
      {isReport ? (
        <MainSectionList isEdit={isEdit} prefilledGraphId={prefilledGraphId} />
      ) : (
        <AutomationWizard
          projectId={projectId}
          isEdit={isEdit}
          prefilledGraphId={prefilledGraphId}
          subjectLocked={subjectLocked}
          graphName={graphName}
          seriesLabel={seriesLabel}
          onCreateNew={onCreateNew}
        />
      )}
    </Box>
  );
}

/** Send test beside Save: once a channel is set up, fire the real message before committing. */
function DrawerFooterActions({
  showTestFire,
  configComplete,
  onTestFire,
  testFiring,
  saveBlockedReason,
  canSave,
  onSave,
  saving,
  saveLabel,
  saveTestId,
}: {
  showTestFire: boolean;
  configComplete: boolean;
  onTestFire: () => void;
  testFiring: boolean;
  saveBlockedReason: string;
  canSave: boolean;
  onSave: () => void;
  saving: boolean;
  saveLabel: string;
  saveTestId: string;
}) {
  return (
    <>
      {showTestFire ? (
        <Tooltip content="Finish the delivery setup to send a test." disabled={configComplete}>
          <Button
            variant="outline"
            onClick={onTestFire}
            loading={testFiring}
            disabled={!configComplete}
          >
            <Send size={14} /> Send test
          </Button>
        </Tooltip>
      ) : null}
      <Tooltip content={saveBlockedReason} disabled={canSave}>
        <Button
          colorPalette="orange"
          data-testid={saveTestId}
          onClick={onSave}
          loading={saving}
          // Pressable while incomplete: a click toasts what is still missing.
          disabled={saving}
        >
          {saveLabel}
        </Button>
      </Tooltip>
    </>
  );
}

type PreviewContextInput = {
  appBaseUrl: string;
  projectName: string | undefined;
  projectSlug: string | undefined;
  isReport: boolean;
  isGraphAlert: boolean;
  name: string;
  alertType: AutomationDraft["alertType"];
  graphAlert: AutomationDraft["graphAlert"];
  reportSourceKind: AutomationDraft["report"]["sourceKind"];
  graphName: string | null;
  seriesLabel: string | null;
};

/** The example the preview and autocomplete render against, shaped like the source's message. */
function usePreviewContext(input: PreviewContextInput): PreviewContext {
  const { appBaseUrl, projectName, projectSlug } = input;
  const exampleContext = useMemo(
    () =>
      buildTemplateContext({
        trigger: {
          id: "preview",
          name: "Your automation",
          alertType: null,
        },
        project: {
          name: projectName ?? "Project",
          slug: projectSlug ?? "project",
        },
        baseHost: appBaseUrl,
        matches: EXAMPLE_MATCHES,
      }),
    [appBaseUrl, projectName, projectSlug],
  );

  const { isReport, isGraphAlert, name, alertType, graphAlert, reportSourceKind } = input;
  const { graphName, seriesLabel } = input;

  return useMemo(
    () =>
      previewContextOf({
        appBaseUrl,
        projectName,
        projectSlug,
        isReport,
        isGraphAlert,
        name,
        alertType,
        graphAlert,
        reportSourceKind,
        graphName,
        seriesLabel,
        exampleContext,
      }),
    [
      appBaseUrl,
      projectName,
      projectSlug,
      isReport,
      isGraphAlert,
      name,
      alertType,
      graphAlert,
      reportSourceKind,
      graphName,
      seriesLabel,
      exampleContext,
    ],
  );
}

function previewContextOf({
  appBaseUrl,
  projectName,
  projectSlug,
  isReport,
  isGraphAlert,
  name,
  alertType,
  graphAlert,
  reportSourceKind,
  graphName,
  seriesLabel,
  exampleContext,
}: PreviewContextInput & { exampleContext: TemplateContext }): PreviewContext {
  if (isReport) {
    // Report-shaped example data, so the preview shows the traces or the
    // chart the report will really send — not an empty trace-shaped message.
    return buildExampleReportTemplateContext({
      baseHost: appBaseUrl,
      project: {
        name: projectName ?? "Project",
        slug: projectSlug ?? "project",
      },
      trigger: { name: name || "Example report" },
      sourceKind: reportSourceKind,
      chartTitles: graphName ? [graphName] : undefined,
    });
  }
  if (isGraphAlert) {
    // Alert-shaped example context + the draft's actual rule, so the
    // preview shows what a real fire renders — not the trace shape.
    return buildExampleGraphAlertTemplateContext({
      baseHost: appBaseUrl,
      project: {
        name: projectName ?? "Project",
        slug: projectSlug ?? "project",
      },
      trigger: {
        name: name || "Example automation",
        alertType: alertType,
      },
      graph: graphName ? { name: graphName } : undefined,
      metricLabel: seriesLabel ?? undefined,
      condition: {
        operator: graphAlert.operator,
        threshold: graphAlert.threshold,
        timePeriodMinutes: graphAlert.timePeriod,
      },
    });
  }
  return {
    ...exampleContext,
    trigger: {
      ...exampleContext.trigger,
      name: name || "Your automation",
      alertType: alertType,
    },
  };
}

type BaselineRef = { current: string | null };

/** Blanks the draft on unmount, and on mount unless a sub-flow's return leg kept it. */
function useDraftLifecycle(reset: () => void) {
  useEffect(
    () => () => {
      if (isHandingOverToSubFlow()) return;
      reset();
    },
    [reset],
  );

  // Opens on a blank draft unless this is a sub-flow's return leg (a
  // walked-away sub-flow never announces one, so its draft is discarded).
  // Latched in a ref and run before paint, since StrictMode's effect
  // replay would otherwise find the one-shot intent spent and blank it.
  const decidedOnMountDraft = useRef(false);
  useLayoutEffect(() => {
    if (decidedOnMountDraft.current) return;
    decidedOnMountDraft.current = true;
    if (consumeDraftKeptOnSubFlowReturn()) return;
    reset();
    // Mount only: running this again would wipe the draft being written.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Hydrates the draft from the saved row once per automation, keeping edits made meanwhile. */
function useHydrateFromServer({
  automationId,
  row,
  hydrate,
  baselineRef,
  slackConnections,
}: {
  automationId: string | undefined;
  row: SavedTriggerRow | null | undefined;
  hydrate: (draft: AutomationDraft) => void;
  baselineRef: BaselineRef;
  slackConnections: readonly NamedSlackConnection[] | undefined;
}) {
  const hydratedFromServerFor = useRef<string | null>(null);
  useEffect(() => {
    if (!automationId) return;
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
      baselineRef.current ??= draftFingerprint(INITIAL_DRAFT);
      return;
    }
    const next = withSlackConnectionName({
      draft: draftFromTriggerRow(row),
      connections: slackConnections,
    });
    hydrate(next);
    hydratedFromServerFor.current = automationId;
    baselineRef.current = draftFingerprint(next);
  }, [row, automationId, hydrate, baselineRef, slackConnections]);
}

/** On create, baselines the close guard once the prefills have landed; declared
 *  after them, so it runs after them on mount and on every identity change. */
function useCreateBaseline({
  automationId,
  drawerIdentity,
  baselineRef,
}: {
  automationId: string | undefined;
  drawerIdentity: string;
  baselineRef: BaselineRef;
}) {
  useEffect(() => {
    if (automationId) return;
    if (baselineRef.current !== null) return;
    baselineRef.current = draftFingerprint(useAutomationStore.getState().draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerIdentity]);
}

/** Names a fresh graph watcher after its graph once the graph loads, if the author has not. */
function useSeedNameFromGraph({
  automationId,
  drawerIdentity,
  prefilledGraphId,
  graphName,
  dispatch,
}: {
  automationId: string | undefined;
  drawerIdentity: string;
  prefilledGraphId: string | undefined;
  graphName: string | null;
  dispatch: Dispatch;
}) {
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (automationId || seededFor.current === drawerIdentity) return;
    if (!prefilledGraphId || !graphName) return;
    const draftName = useAutomationStore.getState().draft.name;
    if (draftName.trim() !== "") return;
    dispatch({ type: "SET_NAME", value: `${graphName} automation` });
    seededFor.current = drawerIdentity;
  }, [automationId, drawerIdentity, prefilledGraphId, graphName, dispatch]);
}
