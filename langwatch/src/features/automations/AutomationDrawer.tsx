import { Button, HStack, Heading, Spacer } from "@chakra-ui/react";
import type { TriggerAction } from "@prisma/client";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { CLIENT_PROVIDERS, type NotifyPreview } from "~/automations/providers/client";
import { type ConfigFormCtx, isNotifyEntry } from "~/automations/providers/types";
import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { useDrawer } from "~/hooks/useDrawer";
import { useFilterParams } from "~/hooks/useFilterParams";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  sanitizeTriggerFilters,
  type FilterField,
  type TriggerFilterValue,
} from "~/server/filters/types";
import type { FilterParam } from "~/hooks/useFilterParams";
import { api } from "~/utils/api";
import { isHandledByGlobalHandler } from "~/utils/trpcError";
import { MainSectionList } from "./components/MainSectionList";
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
  useConditionsSet,
  useConfigComplete,
  useDraft,
  useSection,
} from "./state/selectors";
import { buildClientScaffold } from "./templates/scaffold";

const PREVIEW_DEBOUNCE_MS = 400;

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
}: {
  automationId?: string;
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
  useEffect(() => {
    if (!automationId) return;
    const row = triggerQuery.data;
    if (!row) return;
    const action = row.action as TriggerAction;
    const provider = CLIENT_PROVIDERS[action];
    const filtersRaw =
      typeof row.filters === "string"
        ? (JSON.parse(row.filters) as Record<string, TriggerFilterValue>)
        : {};
    const { sanitized } = sanitizeTriggerFilters(filtersRaw);
    const next: AutomationDraft = {
      ...INITIAL_DRAFT,
      action,
      name: row.name,
      alertType: row.alertType,
      source: row.customGraphId ? "customGraph" : "trace",
      customGraphId: row.customGraphId,
      filters: sanitized as Partial<Record<FilterField, FilterParam>>,
      slices: {
        ...INITIAL_DRAFT.slices,
        [action]: provider.client.fromTriggerRow({
          id: row.id,
          name: row.name,
          alertType: row.alertType,
          message: row.message ?? null,
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
  }, [triggerQuery.data, automationId, hydrate]);

  // Scaffold (defaults + variables + example) is static client data.
  const scaffold = useMemo(
    () =>
      buildClientScaffold({
        name: project?.name ?? "Project",
        slug: project?.slug ?? "project",
      }),
    [project?.name, project?.slug],
  );

  // Live preview for the active notify channel.
  const channel = notifyChannel(draft);
  const preview = api.automation.previewTemplate.useMutation();
  useEffect(() => {
    if (!channel || !projectId || section !== "configuration") return;
    const timer = setTimeout(() => {
      preview.mutate({
        projectId,
        channel,
        trigger: {
          name: draft.name || "Your automation",
          alertType: draft.alertType,
          message: null,
        },
        draft: templatesFromDraft(draft),
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    channel,
    projectId,
    section,
    draft.name,
    draft.alertType,
    draft.action,
    draft.slices,
  ]);

  const testFire = api.automation.testFireTemplate.useMutation();
  const upsert = api.automation.upsert.useMutation();
  const canSave = conditionsSet && configComplete;

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
          message: null,
        },
        draft: templatesFromDraft(draft),
        recipients: target.recipients,
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
                ? `Sent to ${r.recipientCount} recipient(s).`
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
        message: null,
        filters: draft.source === "customGraph" ? {} : draft.filters,
        customGraphId:
          draft.source === "customGraph" ? draft.customGraphId : null,
        actionParams: actionParamsFromDraft(draft) as never,
        templates: templatesFromDraft(draft),
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

  const configCtx = useMemo<ConfigFormCtx<NotifyPreview>>(
    () => ({
      projectId,
      organizationId: organization?.id,
      teamSlug: team?.slug,
      variables: scaffold.variables,
      example: scaffold.example,
      preview: preview.data as NotifyPreview | undefined,
      previewLoading: preview.isLoading,
    }),
    [
      projectId,
      organization?.id,
      team?.slug,
      scaffold.variables,
      scaffold.example,
      preview.data,
      preview.isLoading,
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
            <MainSectionList
              onTestFire={onTestFire}
              testFireLoading={testFire.isLoading}
            />
          </Drawer.Body>
          <Drawer.Footer>
            <HStack width="full">
              <Spacer />
              <Button variant="ghost" onClick={closeDrawer}>
                Cancel
              </Button>
              <Button
                colorPalette="orange"
                onClick={onSave}
                loading={upsert.isLoading}
                disabled={!canSave}
              >
                {automationId ? "Save changes" : "Create automation"}
              </Button>
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
    </>
  );
}
