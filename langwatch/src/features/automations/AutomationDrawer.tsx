import { Box, Button, Heading, HStack, Spacer, Text } from "@chakra-ui/react";
import type { TriggerAction } from "@prisma/client";
import { Mail } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_TRACE_DEBOUNCE_MS,
  MAX_TRACE_DEBOUNCE_MS,
  MIN_TRACE_DEBOUNCE_MS,
  NOTIFICATION_CADENCES,
  type NotificationCadence,
} from "~/automations/cadences";
import {
  CLIENT_PROVIDERS,
  type NotifyPreview,
} from "~/automations/providers/client";
import {
  type ConfigFormCtx,
  isNotifyEntry,
} from "~/automations/providers/types";
import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { useDrawer } from "~/hooks/useDrawer";
import type { FilterParam } from "~/hooks/useFilterParams";
import { useFilterParams } from "~/hooks/useFilterParams";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  type FilterField,
  sanitizeTriggerFilters,
  type TriggerFilterValue,
} from "~/server/filters/types";
import {
  EXAMPLE_MATCHES,
  TEMPLATE_VARIABLES,
} from "~/shared/templating/exampleContext";
import { renderTriggerEmail } from "~/shared/templating/renderEmail";
import { renderTriggerSlack } from "~/shared/templating/renderSlack";
import {
  buildTemplateContext,
  type TemplateContext,
} from "~/shared/templating/templateContext";
import { api } from "~/utils/api";
import { isHandledByGlobalHandler } from "~/utils/trpcError";
import { MainSectionList } from "./components/MainSectionList";
import { CadenceSecondaryDrawer } from "./components/secondaries/CadenceSecondaryDrawer";
import { ConfigurationSecondaryDrawer } from "./components/secondaries/ConfigurationSecondaryDrawer";
import { FiltersSecondaryDrawer } from "./components/secondaries/FiltersSecondaryDrawer";
import {
  type AutomationDraft,
  actionParamsFromDraft,
  filtersAreSet,
  INITIAL_DRAFT,
  notifyChannel,
  templatesFromDraft,
} from "./logic/draftReducer";
import { explainDomainError, readDomainError } from "./logic/errorExplainer";
import { useAutomationStore } from "./state/automationStore";
import {
  useCadenceConfirmed,
  useConditionsSet,
  useConfigComplete,
  useDraft,
  useIsNotifyAction,
  useSection,
} from "./state/selectors";

function saveDisabledReason(
  conditionsSet: boolean,
  configComplete: boolean,
  actionPicked: boolean,
  cadenceNeedsReview: boolean,
): string {
  const missing: string[] = [];
  if (!conditionsSet) missing.push("set a trigger");
  if (!actionPicked) missing.push("pick a type");
  else if (!configComplete) missing.push("complete the setup");
  if (cadenceNeedsReview) missing.push("review the cadence");
  if (missing.length === 0) return "";
  return `To save, ${missing.join(" and ")}.`;
}

/**
 * Orchestrator for the staged automation authoring drawer (ADR-028).
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
}: {
  automationId?: string;
  /** Marker query param set by the email "Edit automation" footer link so the
   *  drawer can surface a one-line landing banner. Any other value (or
   *  undefined) renders the drawer normally. */
  source?: string;
}) {
  const { project, organization, team } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();
  const queryClient = api.useContext();
  const { filterParams } = useFilterParams();
  const projectId = project?.id ?? "";

  const draft = useDraft();
  const section = useSection();
  const conditionsSet = useConditionsSet();
  const configComplete = useConfigComplete();
  const isNotify = useIsNotifyAction();
  const cadenceConfirmed = useCadenceConfirmed();
  const cadenceNeedsReview = isNotify && !cadenceConfirmed;
  const dispatch = useAutomationStore((s) => s.dispatch);
  const setSection = useAutomationStore((s) => s.setSection);
  const hydrate = useAutomationStore((s) => s.hydrate);
  const reset = useAutomationStore((s) => s.reset);
  const pushAttempt = useAutomationStore((s) => s.pushTestAttempt);

  // Wipe the singleton store on unmount — next open is a fresh slate.
  useEffect(() => () => reset(), [reset]);

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
    const next: AutomationDraft = {
      ...INITIAL_DRAFT,
      action,
      name: row.name,
      alertType: row.alertType,
      source: row.customGraphId ? "customGraph" : "trace",
      customGraphId: row.customGraphId,
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
  }, [triggerQuery.data, automationId, hydrate]);

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
  const previewContext = useMemo<TemplateContext>(
    () => ({
      ...exampleContext,
      trigger: {
        ...exampleContext.trigger,
        name: draft.name || "Your automation",
        alertType: draft.alertType,
      },
    }),
    [exampleContext, draft.name, draft.alertType],
  );

  useEffect(() => {
    if (!channel || section !== "configuration") {
      setPreview(undefined);
      return;
    }
    const token = ++previewToken.current;
    const templates = templatesFromDraft(draft);
    void (async () => {
      try {
        if (channel === "email") {
          const rendered = await renderTriggerEmail({
            subjectTemplate: templates.emailSubjectTemplate,
            bodyTemplate: templates.emailBodyTemplate,
            context: previewContext,
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
  }, [channel, section, draft.action, draft.slices, previewContext]);

  const testFire = api.automation.testFireTemplate.useMutation();
  const upsert = api.automation.upsert.useMutation();
  const canSave = conditionsSet && configComplete && !cadenceNeedsReview;

  const onTestFire = useCallback(() => {
    if (!channel || !projectId || !draft.action) return;
    const entry = CLIENT_PROVIDERS[draft.action];
    if (!isNotifyEntry(entry)) return;
    const target = entry.client.testFireTarget(
      draft.slices[draft.action] as never,
    );
    testFire.mutate(
      {
        projectId,
        channel,
        trigger: {
          name: draft.name || "Your automation",
          alertType: draft.alertType,
        },
        draft: templatesFromDraft(draft),
        webhook: target.webhook,
      },
      {
        onSuccess: (r) => {
          pushAttempt({
            at: Date.now(),
            channel: r.channel,
            status: "success",
            recipientCount: r.recipientCount,
            usedDefault: r.usedDefault,
          });
          toaster.create({
            title: "Test fire sent",
            type: "success",
            description:
              r.channel === "email"
                ? "Sent to your inbox."
                : "Posted to the Slack webhook.",
            meta: { closable: true },
          });
        },
        onError: (err) => {
          const domain = readDomainError(err);
          const { title, description } = domain
            ? explainDomainError(domain)
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
  }, [channel, draft, projectId, testFire, pushAttempt]);

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
        customGraphId:
          draft.source === "customGraph" ? draft.customGraphId : null,
        actionParams: actionParamsFromDraft(draft) as never,
        templates: templatesFromDraft(draft),
        notificationCadence: draft.notificationCadence,
        traceDebounceMs: draft.traceDebounceMs,
      },
      {
        onSuccess: () => {
          toaster.create({
            title: automationId ? "Automation updated" : "Automation created",
            type: "success",
            meta: { closable: true },
          });
          void queryClient.automation.getTriggers.invalidate();
          closeDrawer();
        },
        onError: (err) => {
          if (isHandledByGlobalHandler(err)) return;
          const domain = readDomainError(err);
          const { title, description } = domain
            ? explainDomainError(domain)
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

  const cadenceMode: "immediate" | "digest" =
    draft.notificationCadence === "immediate" ? "immediate" : "digest";
  const hasEvaluationFilter = Object.keys(draft.filters).some((k) =>
    k.startsWith("evaluations."),
  );

  const configCtx = useMemo<ConfigFormCtx<NotifyPreview>>(
    () => ({
      projectId,
      organizationId: organization?.id,
      teamSlug: team?.slug,
      variables: TEMPLATE_VARIABLES,
      example: exampleContext,
      preview,
      // Synchronous render — there is never a loading state to show.
      previewLoading: false,
      cadenceMode,
      notificationCadence: draft.notificationCadence,
      setNotificationCadence: (value) =>
        dispatch({ type: "SET_CADENCE", value: value as NotificationCadence }),
      hasEvaluationFilter,
    }),
    [
      projectId,
      organization?.id,
      team?.slug,
      exampleContext,
      preview,
      cadenceMode,
      draft.notificationCadence,
      dispatch,
      hasEvaluationFilter,
    ],
  );

  return (
    <>
      <Drawer.Root
        open={section === null}
        placement="end"
        size="lg"
        onOpenChange={({ open }) => {
          if (!open && section === null) closeDrawer();
        }}
      >
        <Drawer.Content bg="bg">
          <Drawer.Header>
            <Drawer.CloseTrigger />
            <Heading size="md">
              {automationId ? "Edit automation" : "Add automation"}
            </Heading>
          </Drawer.Header>
          <Drawer.Body>
            {source === "email-link" ? <EmailLinkLandingBanner /> : null}
            <MainSectionList
              onTestFire={onTestFire}
              testFireLoading={testFire.isLoading}
            />
          </Drawer.Body>
          <Drawer.Footer>
            <HStack width="full">
              <Spacer />
              <Tooltip
                content={saveDisabledReason(
                  conditionsSet,
                  configComplete,
                  !!draft.action,
                  cadenceNeedsReview,
                )}
                disabled={canSave}
              >
                <Button
                  colorPalette="orange"
                  onClick={onSave}
                  loading={upsert.isLoading}
                  disabled={!canSave}
                >
                  {automationId ? "Save changes" : "Create automation"}
                </Button>
              </Tooltip>
            </HStack>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer.Root>

      <FiltersSecondaryDrawer
        open={section === "filters"}
        source={draft.source}
        filters={draft.filters}
        customGraphId={draft.customGraphId}
        projectId={projectId}
        onSave={({ source, filters, customGraphId }) => {
          dispatch({ type: "SET_SOURCE", value: source });
          if (source === "trace") {
            dispatch({ type: "SET_FILTERS", value: filters });
          } else {
            dispatch({ type: "SET_CUSTOM_GRAPH_ID", value: customGraphId });
          }
          setSection(null);
        }}
        onCancel={() => setSection(null)}
      />

      <ConfigurationSecondaryDrawer
        open={section === "configuration"}
        ctx={configCtx}
        onDone={() => setSection(null)}
      />

      <CadenceSecondaryDrawer
        open={section === "cadence"}
        onDone={() => {
          dispatch({ type: "CONFIRM_CADENCE" });
          setSection(null);
        }}
      />
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
      borderColor="blue.200"
      bg="blue.50"
      _dark={{ borderColor: "blue.700", bg: "blue.950" }}
    >
      <HStack gap={2} align="start">
        <Box color="blue.500" flexShrink={0} mt="2px">
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
