import {
  Badge,
  Box,
  Button,
  Field,
  HStack,
  Heading,
  Input,
  NativeSelect,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { AlertType, TriggerAction } from "@prisma/client";
import type { Monaco } from "@monaco-editor/react";
import dynamic from "~/utils/compat/next-dynamic";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Database,
  Mail,
  Pencil,
  Send,
  Users,
} from "lucide-react";
import { SiSlack } from "react-icons/si";
import { useDrawer } from "~/hooks/useDrawer";
import { useFilterParams } from "~/hooks/useFilterParams";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import monokaiTheme from "~/optimization_studio/components/code/Monokai.json";
import {
  sanitizeTriggerFilters,
  triggerFiltersPermissiveSchema,
  type FilterField,
  type TriggerFilterValue,
} from "~/server/filters/types";
import type { FilterParam } from "~/hooks/useFilterParams";
import { api } from "~/utils/api";
import { isHandledByGlobalHandler } from "~/utils/trpcError";
import {
  EmailPreview,
  ExampleData,
  FieldHeader,
  LiquidEditor,
  PreviewWarnings,
  SlackPreview,
  VariableReference,
  type FieldDraft,
} from "./automations/templateAuthoring";
import { DatasetSelector } from "./datasets/DatasetSelector";
import { FieldsFilters } from "./filters/FieldsFilters";
import { HorizontalFormControl } from "./HorizontalFormControl";
import { Drawer } from "./ui/drawer";
import { Switch } from "./ui/switch";
import { toaster } from "./ui/toaster";
import { AddParticipants } from "./traces/AddParticipants";

/**
 * Staged automation authoring drawer (ADR-028). The main drawer is a list of
 * **summary rows**, one per section — clicking a row opens a focused secondary
 * drawer to edit that section, which closes back to the main view. Filters
 * lead because the most important question is "when does this fire?". When
 * the drawer is opened from a filtered traces view, the conditions are
 * pre-filled so the user goes straight to picking a Type.
 */

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <Box padding={4} color="fg.muted">
      Loading editor...
    </Box>
  ),
});

type SlackTemplateType = "string" | "block_kit";

interface AutomationDraft {
  action: TriggerAction | null;
  name: string;
  alertType: AlertType | null;
  filters: Partial<Record<FilterField, FilterParam>>;
  members: string[];
  slackWebhook: string;
  slackTemplateType: SlackTemplateType;
  slackTemplate: FieldDraft;
  emailSubject: FieldDraft;
  emailBody: FieldDraft;
  datasetId: string;
  datasetMapping: {
    mapping: Record<string, { source: string; key: string; subkey: string }>;
    expansions: string[];
  };
  annotators: { id: string; name: string }[];
}

type DraftAction =
  | { type: "SET_ACTION"; value: TriggerAction }
  | { type: "SET_NAME"; value: string }
  | { type: "SET_ALERT_TYPE"; value: AlertType | null }
  | { type: "SET_FILTERS"; value: Partial<Record<FilterField, FilterParam>> }
  | { type: "SET_MEMBERS"; value: string[] }
  | { type: "SET_SLACK_WEBHOOK"; value: string }
  | { type: "SET_SLACK_TYPE"; value: SlackTemplateType }
  | { type: "SET_SLACK_TEMPLATE"; value: FieldDraft }
  | { type: "SET_EMAIL_SUBJECT"; value: FieldDraft }
  | { type: "SET_EMAIL_BODY"; value: FieldDraft }
  | { type: "SET_DATASET_ID"; value: string }
  | { type: "SET_ANNOTATORS"; value: { id: string; name: string }[] }
  | { type: "HYDRATE"; value: AutomationDraft };

const EMPTY_FIELD: FieldDraft = { value: "", usingDefault: true };

const INITIAL_DRAFT: AutomationDraft = {
  action: null,
  name: "",
  alertType: null,
  filters: {},
  members: [],
  slackWebhook: "",
  slackTemplateType: "string",
  slackTemplate: EMPTY_FIELD,
  emailSubject: EMPTY_FIELD,
  emailBody: EMPTY_FIELD,
  datasetId: "",
  datasetMapping: { mapping: {}, expansions: [] },
  annotators: [],
};

function reducer(state: AutomationDraft, action: DraftAction): AutomationDraft {
  switch (action.type) {
    case "HYDRATE":
      return action.value;
    case "SET_ACTION":
      // Action change resets the destination-specific config but keeps the
      // identity, conditions, and templates that may still be relevant.
      return {
        ...state,
        action: action.value,
        members: [],
        slackWebhook: "",
        datasetId: "",
        annotators: [],
      };
    case "SET_NAME":
      return { ...state, name: action.value };
    case "SET_ALERT_TYPE":
      return { ...state, alertType: action.value };
    case "SET_FILTERS":
      return { ...state, filters: action.value };
    case "SET_MEMBERS":
      return { ...state, members: action.value };
    case "SET_SLACK_WEBHOOK":
      return { ...state, slackWebhook: action.value };
    case "SET_SLACK_TYPE":
      // Reset slackTemplate to "using default" so the new type's default
      // shows in the editor rather than a stale string-for-block_kit blob.
      return { ...state, slackTemplateType: action.value, slackTemplate: EMPTY_FIELD };
    case "SET_SLACK_TEMPLATE":
      return { ...state, slackTemplate: action.value };
    case "SET_EMAIL_SUBJECT":
      return { ...state, emailSubject: action.value };
    case "SET_EMAIL_BODY":
      return { ...state, emailBody: action.value };
    case "SET_DATASET_ID":
      return { ...state, datasetId: action.value };
    case "SET_ANNOTATORS":
      return { ...state, annotators: action.value };
  }
}

const ACTION_LABEL: Record<TriggerAction, string> = {
  [TriggerAction.SEND_SLACK_MESSAGE]: "Slack",
  [TriggerAction.SEND_EMAIL]: "Email",
  [TriggerAction.ADD_TO_DATASET]: "Add to dataset",
  [TriggerAction.ADD_TO_ANNOTATION_QUEUE]: "Add to annotation queue",
};

const PREVIEW_DEBOUNCE_MS = 400;
type Section = null | "filters" | "configuration";

function notifyChannel(draft: AutomationDraft): "email" | "slack" | null {
  if (draft.action === TriggerAction.SEND_EMAIL) return "email";
  if (draft.action === TriggerAction.SEND_SLACK_MESSAGE) return "slack";
  return null;
}

function templatesFromDraft(draft: AutomationDraft) {
  return {
    emailSubjectTemplate: draft.emailSubject.usingDefault ? null : draft.emailSubject.value,
    emailBodyTemplate: draft.emailBody.usingDefault ? null : draft.emailBody.value,
    slackTemplate: draft.slackTemplate.usingDefault ? null : draft.slackTemplate.value,
    slackTemplateType: draft.slackTemplate.usingDefault ? null : draft.slackTemplateType,
  };
}

function actionParamsFromDraft(draft: AutomationDraft) {
  switch (draft.action) {
    case TriggerAction.SEND_EMAIL:
      return { members: draft.members };
    case TriggerAction.SEND_SLACK_MESSAGE:
      return { slackWebhook: draft.slackWebhook };
    case TriggerAction.ADD_TO_DATASET:
      return { datasetId: draft.datasetId, datasetMapping: draft.datasetMapping };
    case TriggerAction.ADD_TO_ANNOTATION_QUEUE:
      return { annotators: draft.annotators };
    default:
      return {};
  }
}

function filtersAreSet(filters: AutomationDraft["filters"]): boolean {
  return Object.values(filters).some(
    (v) => v && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0),
  );
}

function configIsComplete(draft: AutomationDraft): boolean {
  if (!draft.action || draft.name.trim().length === 0) return false;
  switch (draft.action) {
    case TriggerAction.SEND_EMAIL:
      return draft.members.length > 0;
    case TriggerAction.SEND_SLACK_MESSAGE:
      return draft.slackWebhook.trim().length > 0;
    case TriggerAction.ADD_TO_DATASET:
      return draft.datasetId.length > 0;
    case TriggerAction.ADD_TO_ANNOTATION_QUEUE:
      return draft.annotators.length > 0;
  }
}

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

  const [draft, dispatch] = useReducer(reducer, INITIAL_DRAFT);
  const [section, setSection] = useState<Section>(null);

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
    const t = triggerQuery.data;
    if (!t) return;
    const params = (t.actionParams ?? {}) as Record<string, unknown>;
    const filtersRaw =
      typeof t.filters === "string"
        ? (JSON.parse(t.filters) as Record<string, TriggerFilterValue>)
        : {};
    const { sanitized } = sanitizeTriggerFilters(filtersRaw);
    dispatch({
      type: "HYDRATE",
      value: {
        ...INITIAL_DRAFT,
        action: t.action as TriggerAction,
        name: t.name,
        alertType: t.alertType,
        filters: sanitized as Partial<Record<FilterField, FilterParam>>,
        members: Array.isArray(params.members) ? (params.members as string[]) : [],
        slackWebhook:
          typeof params.slackWebhook === "string" ? params.slackWebhook : "",
        slackTemplateType: t.slackTemplateType === "block_kit" ? "block_kit" : "string",
        slackTemplate: {
          value: t.slackTemplate ?? "",
          usingDefault: t.slackTemplate == null,
        },
        emailSubject: {
          value: t.emailSubjectTemplate ?? "",
          usingDefault: t.emailSubjectTemplate == null,
        },
        emailBody: {
          value: t.emailBodyTemplate ?? "",
          usingDefault: t.emailBodyTemplate == null,
        },
        datasetId: typeof params.datasetId === "string" ? params.datasetId : "",
        datasetMapping:
          params.datasetMapping &&
          typeof params.datasetMapping === "object" &&
          "mapping" in (params.datasetMapping as object)
            ? (params.datasetMapping as AutomationDraft["datasetMapping"])
            : INITIAL_DRAFT.datasetMapping,
        annotators: Array.isArray(params.annotators)
          ? (params.annotators as { id: string; name: string }[])
          : [],
      },
    });
  }, [triggerQuery.data, automationId]);

  // Scaffold: defaults / variables / example.
  const scaffold = api.automation.getTemplateScaffold.useQuery(
    { projectId },
    { enabled: !!projectId },
  );
  const variables = scaffold.data?.variables ?? [];
  const defaults = scaffold.data?.defaults;

  const slackDefault =
    draft.slackTemplateType === "block_kit"
      ? defaults?.slackBlockKit ?? ""
      : defaults?.slackString ?? "";
  const subjectValue = draft.emailSubject.usingDefault
    ? defaults?.emailSubject ?? ""
    : draft.emailSubject.value;
  const bodyValue = draft.emailBody.usingDefault
    ? defaults?.emailBody ?? ""
    : draft.emailBody.value;
  const slackValue = draft.slackTemplate.usingDefault
    ? slackDefault
    : draft.slackTemplate.value;

  const channel = notifyChannel(draft);

  // Live preview (debounced) — only matters while the user is in the
  // Configuration secondary, but harmless to keep firing.
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
    draft.emailSubject,
    draft.emailBody,
    draft.slackTemplate,
    draft.slackTemplateType,
  ]);

  const testFire = api.automation.testFireTemplate.useMutation();
  const upsert = api.automation.upsert.useMutation();

  const conditionsSet = filtersAreSet(draft.filters);
  const configComplete = configIsComplete(draft);
  const canSave = conditionsSet && configComplete;

  const onTestFire = useCallback(() => {
    if (!channel || !projectId) return;
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
        recipients: channel === "email" ? draft.members : [],
        webhook: channel === "slack" ? draft.slackWebhook : null,
      },
      {
        onSuccess: (r) =>
          toaster.create({
            title: "Test fire sent",
            type: "success",
            description:
              r.channel === "email"
                ? `Sent to ${r.recipientCount} recipient(s).`
                : "Posted to the Slack webhook.",
            meta: { closable: true },
          }),
        onError: (err) =>
          toaster.create({
            title: "Test fire failed",
            type: "error",
            description: err.message,
            meta: { closable: true },
          }),
      },
    );
  }, [channel, draft, projectId, testFire]);

  const onSave = useCallback(() => {
    if (!canSave || !draft.action) return;
    upsert.mutate(
      {
        projectId,
        triggerId: automationId,
        name: draft.name,
        action: draft.action,
        alertType: draft.alertType ?? undefined,
        message: null,
        filters: draft.filters,
        actionParams: actionParamsFromDraft(draft),
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
          toaster.create({
            title: "Could not save automation",
            type: "error",
            description: err.message,
            meta: { closable: true },
          });
        },
      },
    );
  }, [automationId, canSave, closeDrawer, draft, projectId, queryClient, upsert]);

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
            <VStack align="stretch" gap={3}>
              <SectionRow
                title="When (conditions)"
                summary={
                  conditionsSet
                    ? summariseFilters(draft.filters)
                    : "Click to choose when this fires"
                }
                complete={conditionsSet}
                onEdit={() => setSection("filters")}
              />

              <TypeInline
                value={draft.action}
                onChange={(v) => dispatch({ type: "SET_ACTION", value: v })}
              />

              <SectionRow
                title="Configuration"
                summary={configurationSummary(draft)}
                complete={configComplete}
                disabled={!draft.action}
                onEdit={() => setSection("configuration")}
              />

              <SectionRow
                title="Cadence"
                summary="Coming soon: batch notifications into digests (ADR-025)"
                complete={false}
                disabled
                onEdit={() => {}}
              />

              {channel ? (
                <HStack
                  padding={3}
                  borderRadius="md"
                  border="1px solid"
                  borderColor="border"
                >
                  <Text textStyle="sm" color="fg.muted">
                    Send a banner-marked notification to the configured destination
                    before saving.
                  </Text>
                  <Spacer />
                  <Button
                    onClick={onTestFire}
                    loading={testFire.isLoading}
                    disabled={!configComplete}
                    variant="outline"
                  >
                    <Send size={14} /> Test fire
                  </Button>
                </HStack>
              ) : null}
            </VStack>
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
        filters={draft.filters}
        onSave={(filters) => {
          dispatch({ type: "SET_FILTERS", value: filters });
          setSection(null);
        }}
        onCancel={() => setSection(null)}
      />

      <ConfigurationSecondaryDrawer
        open={section === "configuration"}
        draft={draft}
        dispatch={dispatch}
        variables={variables}
        preview={preview.data}
        previewLoading={preview.isLoading}
        subjectValue={subjectValue}
        bodyValue={bodyValue}
        slackValue={slackValue}
        example={scaffold.data?.example}
        organizationId={organization?.id}
        teamSlug={team?.slug}
        projectId={projectId}
        onDone={() => setSection(null)}
      />
    </>
  );
}

function SectionRow({
  title,
  summary,
  complete,
  disabled = false,
  onEdit,
}: {
  title: string;
  summary: string;
  complete: boolean;
  disabled?: boolean;
  onEdit: () => void;
}) {
  return (
    <HStack
      padding={3}
      borderRadius="md"
      border="1px solid"
      borderColor="border"
      opacity={disabled ? 0.6 : 1}
    >
      <VStack align="start" gap={0} flex="1" minWidth="0">
        <HStack>
          <Text fontWeight="semibold">{title}</Text>
          {complete ? <Check size={14} color="green" /> : null}
        </HStack>
        <Text textStyle="sm" color="fg.muted" lineClamp={2}>
          {summary}
        </Text>
      </VStack>
      <Button
        size="sm"
        variant="ghost"
        onClick={onEdit}
        disabled={disabled}
      >
        <Pencil size={14} /> Edit
      </Button>
    </HStack>
  );
}

function TypeInline({
  value,
  onChange,
}: {
  value: TriggerAction | null;
  onChange: (v: TriggerAction) => void;
}) {
  const options: {
    action: TriggerAction;
    icon: React.ReactNode;
    title: string;
    description: string;
  }[] = [
    {
      action: TriggerAction.SEND_SLACK_MESSAGE,
      icon: <SiSlack size={18} />,
      title: "Slack",
      description: "Post a message to a Slack webhook when a trace matches.",
    },
    {
      action: TriggerAction.SEND_EMAIL,
      icon: <Mail size={18} />,
      title: "Email",
      description: "Send an email to one or more team members on every match.",
    },
    {
      action: TriggerAction.ADD_TO_DATASET,
      icon: <Database size={18} />,
      title: "Add to dataset",
      description: "Append matched traces to a dataset for later evaluation.",
    },
    {
      action: TriggerAction.ADD_TO_ANNOTATION_QUEUE,
      icon: <Users size={18} />,
      title: "Add to annotation queue",
      description: "Queue matched traces for a human to label.",
    },
  ];
  return (
    <Box padding={3} borderRadius="md" border="1px solid" borderColor="border">
      <Text fontWeight="semibold" mb={2}>
        Type
      </Text>
      <Box display="grid" gridTemplateColumns="1fr 1fr" gap={2}>
        {options.map((opt) => {
          const active = value === opt.action;
          return (
            <Box
              as="button"
              key={opt.action}
              textAlign="left"
              padding={3}
              borderRadius="md"
              border="1px solid"
              borderColor={active ? "orange.400" : "border"}
              bg={active ? "orange.50" : "bg"}
              _dark={{ bg: active ? "orange.900" : "bg" }}
              onClick={() => onChange(opt.action)}
            >
              <HStack gap={2} mb={1}>
                {opt.icon}
                <Text fontWeight="semibold">{opt.title}</Text>
              </HStack>
              <Text textStyle="xs" color="fg.muted">
                {opt.description}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function summariseFilters(
  filters: Partial<Record<FilterField, FilterParam>>,
): string {
  const keys = Object.keys(filters);
  if (keys.length === 0) return "No conditions yet";
  return `${keys.length} condition${keys.length === 1 ? "" : "s"}: ${keys.slice(0, 3).join(", ")}${keys.length > 3 ? "…" : ""}`;
}

function configurationSummary(draft: AutomationDraft): string {
  if (!draft.action) return "Choose a type first";
  const name = draft.name || "(unnamed)";
  switch (draft.action) {
    case TriggerAction.SEND_EMAIL:
      return `${name} → email to ${draft.members.length} recipient(s)`;
    case TriggerAction.SEND_SLACK_MESSAGE:
      return `${name} → Slack webhook${draft.slackWebhook ? " set" : " (not set)"}`;
    case TriggerAction.ADD_TO_DATASET:
      return `${name} → dataset ${draft.datasetId || "(not chosen)"}`;
    case TriggerAction.ADD_TO_ANNOTATION_QUEUE:
      return `${name} → ${draft.annotators.length} annotator(s)`;
  }
}

// ---------- Filters secondary drawer ----------

function FiltersSecondaryDrawer({
  open,
  filters,
  onSave,
  onCancel,
}: {
  open: boolean;
  filters: Partial<Record<FilterField, FilterParam>>;
  onSave: (filters: Partial<Record<FilterField, FilterParam>>) => void;
  onCancel: () => void;
}) {
  const [local, setLocal] = useState(filters);
  const [codeMode, setCodeMode] = useState(false);
  const [code, setCode] = useState(JSON.stringify(filters, null, 2));
  const [codeError, setCodeError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLocal(filters);
      setCode(JSON.stringify(filters, null, 2));
      setCodeError(null);
    }
  }, [open, filters]);

  const onToggle = (toCode: boolean) => {
    if (toCode) setCode(JSON.stringify(local, null, 2));
    else {
      try {
        const parsed = JSON.parse(code);
        const result = triggerFiltersPermissiveSchema.safeParse(parsed);
        if (!result.success) {
          setCodeError(result.error.errors[0]?.message ?? "Invalid filters");
          return;
        }
        const { sanitized } = sanitizeTriggerFilters(result.data);
        setLocal(sanitized as Partial<Record<FilterField, FilterParam>>);
        setCodeError(null);
      } catch {
        setCodeError("Invalid JSON syntax");
        return;
      }
    }
    setCodeMode(toCode);
  };

  const apply = () => {
    if (codeMode) {
      try {
        const parsed = JSON.parse(code);
        const result = triggerFiltersPermissiveSchema.safeParse(parsed);
        if (!result.success) {
          setCodeError(result.error.errors[0]?.message ?? "Invalid filters");
          return;
        }
        const { sanitized } = sanitizeTriggerFilters(result.data);
        onSave(sanitized as Partial<Record<FilterField, FilterParam>>);
      } catch {
        setCodeError("Invalid JSON syntax");
      }
    } else {
      onSave(local);
    }
  };

  return (
    <Drawer.Root
      open={open}
      placement="end"
      size="xl"
      onOpenChange={({ open: o }) => {
        if (!o) onCancel();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <HStack width="full" gap={3}>
            <Button variant="ghost" size="sm" onClick={onCancel}>
              <ArrowLeft size={16} />
            </Button>
            <Heading size="md">Conditions</Heading>
            <Spacer />
            <Text textStyle="sm" color="fg.muted">
              Code
            </Text>
            <Switch
              checked={codeMode}
              onCheckedChange={({ checked }) => onToggle(checked)}
            />
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          {codeMode ? (
            <VStack align="stretch" gap={2}>
              <Box
                border="1px solid"
                borderColor={codeError ? "red.500" : "border"}
                borderRadius="md"
                overflow="hidden"
                height="500px"
                background="#272822"
              >
                <MonacoEditor
                  height="100%"
                  language="json"
                  value={code}
                  theme="monokai"
                  beforeMount={(monaco: Monaco) => {
                    monaco.editor.defineTheme(
                      "monokai",
                      monokaiTheme as Parameters<typeof monaco.editor.defineTheme>[1],
                    );
                  }}
                  onChange={(v: string | undefined) => setCode(v ?? "{}")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    wordWrap: "on",
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                    lineNumbers: "on",
                    tabSize: 2,
                    padding: { top: 12 },
                  }}
                />
              </Box>
              {codeError ? (
                <Text color="red.500" textStyle="sm">
                  {codeError}
                </Text>
              ) : null}
            </VStack>
          ) : (
            <HorizontalFormControl
              label="Conditions"
              helper="The automation fires when an incoming trace matches every condition."
              minWidth="calc(50% - 16px)"
            >
              <FieldsFilters
                filters={local as Record<FilterField, FilterParam>}
                setFilters={(next) => setLocal((prev) => ({ ...prev, ...next }))}
              />
            </HorizontalFormControl>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button colorPalette="orange" onClick={apply}>
              Done
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

// ---------- Configuration secondary drawer ----------

function ConfigurationSecondaryDrawer({
  open,
  draft,
  dispatch,
  variables,
  preview,
  previewLoading,
  subjectValue,
  bodyValue,
  slackValue,
  example,
  organizationId,
  teamSlug,
  projectId,
  onDone,
}: {
  open: boolean;
  draft: AutomationDraft;
  dispatch: React.Dispatch<DraftAction>;
  variables: string[];
  preview:
    | (
        | {
            channel: "email";
            subject: string;
            html: string;
            usedDefault: boolean;
            missingVariables: string[];
            errors: string[];
          }
        | {
            channel: "slack";
            payload: { text: string } | { blocks: Record<string, unknown>[] };
            usedDefault: boolean;
            missingVariables: string[];
            errors: string[];
          }
      )
    | undefined;
  previewLoading: boolean;
  subjectValue: string;
  bodyValue: string;
  slackValue: string;
  example: unknown;
  organizationId: string | undefined;
  teamSlug: string | undefined;
  projectId: string;
  onDone: () => void;
}) {
  return (
    <Drawer.Root
      open={open}
      placement="end"
      size="xl"
      onOpenChange={({ open: o }) => {
        if (!o) onDone();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <HStack width="full" gap={3}>
            <Button variant="ghost" size="sm" onClick={onDone}>
              <ArrowLeft size={16} />
            </Button>
            <Heading size="md">Configuration</Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={4}>
            <IdentityFields draft={draft} dispatch={dispatch} />
            {draft.action === TriggerAction.SEND_EMAIL && (
              <EmailConfig
                draft={draft}
                dispatch={dispatch}
                variables={variables}
                preview={preview?.channel === "email" ? preview : undefined}
                previewLoading={previewLoading}
                subjectValue={subjectValue}
                bodyValue={bodyValue}
                example={example}
                organizationId={organizationId}
                teamSlug={teamSlug}
              />
            )}
            {draft.action === TriggerAction.SEND_SLACK_MESSAGE && (
              <SlackConfig
                draft={draft}
                dispatch={dispatch}
                variables={variables}
                preview={preview?.channel === "slack" ? preview : undefined}
                previewLoading={previewLoading}
                slackValue={slackValue}
                example={example}
              />
            )}
            {draft.action === TriggerAction.ADD_TO_DATASET && (
              <DatasetConfig
                draft={draft}
                dispatch={dispatch}
                projectId={projectId}
              />
            )}
            {draft.action === TriggerAction.ADD_TO_ANNOTATION_QUEUE && (
              <AnnotationQueueConfig draft={draft} dispatch={dispatch} />
            )}
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button colorPalette="orange" onClick={onDone}>
              Done
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function IdentityFields({
  draft,
  dispatch,
}: {
  draft: AutomationDraft;
  dispatch: React.Dispatch<DraftAction>;
}) {
  return (
    <HStack align="start" gap={3}>
      <Field.Root flex="1">
        <Field.Label>Name</Field.Label>
        <Input
          value={draft.name}
          onChange={(e) => dispatch({ type: "SET_NAME", value: e.target.value })}
          placeholder="High latency alerts"
        />
      </Field.Root>
      <Field.Root width="180px">
        <Field.Label>Alert type</Field.Label>
        <NativeSelect.Root>
          <NativeSelect.Field
            value={draft.alertType ?? ""}
            onChange={(e) =>
              dispatch({
                type: "SET_ALERT_TYPE",
                value: (e.target.value || null) as AlertType | null,
              })
            }
          >
            <option value="">—</option>
            <option value="INFO">Info</option>
            <option value="WARNING">Warning</option>
            <option value="CRITICAL">Critical</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Field.Root>
    </HStack>
  );
}

function EmailConfig({
  draft,
  dispatch,
  variables,
  preview,
  previewLoading,
  subjectValue,
  bodyValue,
  example,
  organizationId,
  teamSlug,
}: {
  draft: AutomationDraft;
  dispatch: React.Dispatch<DraftAction>;
  variables: string[];
  preview:
    | {
        channel: "email";
        subject: string;
        html: string;
        usedDefault: boolean;
        missingVariables: string[];
        errors: string[];
      }
    | undefined;
  previewLoading: boolean;
  subjectValue: string;
  bodyValue: string;
  example: unknown;
  organizationId: string | undefined;
  teamSlug: string | undefined;
}) {
  const teamWithMembers = api.team.getTeamWithMembers.useQuery(
    { slug: teamSlug ?? "", organizationId: organizationId ?? "" },
    { enabled: !!teamSlug && !!organizationId },
  );
  const memberEmails = useMemo(
    () =>
      (teamWithMembers.data?.members ?? [])
        .map((m) => m.user.email)
        .filter((e): e is string => typeof e === "string"),
    [teamWithMembers.data],
  );

  return (
    <HStack align="stretch" gap={4}>
      <VStack align="stretch" gap={3} flex="1" minWidth="0">
        <Field.Root>
          <Field.Label>Recipients</Field.Label>
          <VStack align="stretch" gap={1}>
            {memberEmails.length === 0 ? (
              <Text color="fg.muted" textStyle="sm">
                No team members found.
              </Text>
            ) : (
              memberEmails.map((email) => (
                <HStack key={email}>
                  <input
                    type="checkbox"
                    checked={draft.members.includes(email)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...draft.members, email]
                        : draft.members.filter((m) => m !== email);
                      dispatch({ type: "SET_MEMBERS", value: next });
                    }}
                  />
                  <Text>{email}</Text>
                </HStack>
              ))
            )}
          </VStack>
        </Field.Root>
        <FieldHeader
          label="Subject"
          usingDefault={draft.emailSubject.usingDefault}
          onReset={() =>
            dispatch({ type: "SET_EMAIL_SUBJECT", value: EMPTY_FIELD })
          }
        />
        <LiquidEditor
          variables={variables}
          height="56px"
          value={subjectValue}
          onChange={(value) =>
            dispatch({
              type: "SET_EMAIL_SUBJECT",
              value: { value, usingDefault: false },
            })
          }
        />
        <FieldHeader
          label="Body (Markdown + Liquid)"
          usingDefault={draft.emailBody.usingDefault}
          onReset={() =>
            dispatch({ type: "SET_EMAIL_BODY", value: EMPTY_FIELD })
          }
        />
        <LiquidEditor
          variables={variables}
          height="240px"
          value={bodyValue}
          onChange={(value) =>
            dispatch({
              type: "SET_EMAIL_BODY",
              value: { value, usingDefault: false },
            })
          }
        />
        <VariableReference variables={variables} />
        {example ? <ExampleData example={example} /> : null}
      </VStack>
      <VStack align="stretch" gap={2} flex="1" minWidth="0">
        <HStack>
          <Text textStyle="sm" fontWeight="semibold">
            Preview
          </Text>
          {previewLoading ? <Spinner size="xs" /> : null}
        </HStack>
        <PreviewWarnings data={preview} />
        {preview ? (
          <EmailPreview subject={preview.subject} html={preview.html} />
        ) : (
          <Text color="fg.muted" textStyle="sm">
            Edit a template to preview.
          </Text>
        )}
      </VStack>
    </HStack>
  );
}

function SlackConfig({
  draft,
  dispatch,
  variables,
  preview,
  previewLoading,
  slackValue,
  example,
}: {
  draft: AutomationDraft;
  dispatch: React.Dispatch<DraftAction>;
  variables: string[];
  preview:
    | {
        channel: "slack";
        payload: { text: string } | { blocks: Record<string, unknown>[] };
        usedDefault: boolean;
        missingVariables: string[];
        errors: string[];
      }
    | undefined;
  previewLoading: boolean;
  slackValue: string;
  example: unknown;
}) {
  const isBlockKit = draft.slackTemplateType === "block_kit";
  return (
    <HStack align="stretch" gap={4}>
      <VStack align="stretch" gap={3} flex="1" minWidth="0">
        <Field.Root>
          <Field.Label>Slack webhook URL</Field.Label>
          <Input
            value={draft.slackWebhook}
            onChange={(e) =>
              dispatch({ type: "SET_SLACK_WEBHOOK", value: e.target.value })
            }
            placeholder="https://hooks.slack.com/services/..."
          />
        </Field.Root>
        <Field.Root>
          <Field.Label>Message type</Field.Label>
          <NativeSelect.Root>
            <NativeSelect.Field
              value={draft.slackTemplateType}
              onChange={(e) =>
                dispatch({
                  type: "SET_SLACK_TYPE",
                  value: e.target.value as SlackTemplateType,
                })
              }
            >
              <option value="string">Plain text</option>
              <option value="block_kit">Block Kit (JSON)</option>
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </Field.Root>
        <FieldHeader
          label={
            isBlockKit
              ? "Block Kit template (JSON + Liquid in strings)"
              : "Message template (Liquid)"
          }
          usingDefault={draft.slackTemplate.usingDefault}
          onReset={() =>
            dispatch({ type: "SET_SLACK_TEMPLATE", value: EMPTY_FIELD })
          }
        />
        <LiquidEditor
          variables={variables}
          height="280px"
          language={isBlockKit ? "json" : undefined}
          value={slackValue}
          onChange={(value) =>
            dispatch({
              type: "SET_SLACK_TEMPLATE",
              value: { value, usingDefault: false },
            })
          }
        />
        <VariableReference variables={variables} />
        {example ? <ExampleData example={example} /> : null}
      </VStack>
      <VStack align="stretch" gap={2} flex="1" minWidth="0">
        <HStack>
          <Text textStyle="sm" fontWeight="semibold">
            Preview
          </Text>
          {previewLoading ? <Spinner size="xs" /> : null}
          <Spacer />
          {isBlockKit ? (
            <Badge size="sm" colorPalette="orange">
              Liquid is rendered before JSON.parse
            </Badge>
          ) : null}
        </HStack>
        <PreviewWarnings data={preview} />
        {preview ? (
          <SlackPreview payload={preview.payload} />
        ) : (
          <Text color="fg.muted" textStyle="sm">
            Edit a template to preview.
          </Text>
        )}
      </VStack>
    </HStack>
  );
}

function DatasetConfig({
  draft,
  dispatch,
  projectId,
}: {
  draft: AutomationDraft;
  dispatch: React.Dispatch<DraftAction>;
  projectId: string;
}) {
  const datasets = api.dataset.getAll.useQuery(
    { projectId },
    { enabled: !!projectId, refetchOnWindowFocus: false },
  );
  return (
    <VStack align="stretch" gap={3}>
      <DatasetSelector
        datasets={datasets.data}
        localStorageDatasetId={draft.datasetId}
        errors={{}}
        setValue={(_field: string, value: string) =>
          dispatch({ type: "SET_DATASET_ID", value })
        }
        onCreateNew={() => {}}
      />
      <Text color="fg.muted" textStyle="xs">
        Column mapping uses the dataset's defaults; refine after creating from
        the dataset view.
      </Text>
    </VStack>
  );
}

function AnnotationQueueConfig({
  draft,
  dispatch,
}: {
  draft: AutomationDraft;
  dispatch: React.Dispatch<DraftAction>;
}) {
  return (
    <AddParticipants
      annotators={draft.annotators}
      setAnnotators={(value) =>
        dispatch({
          type: "SET_ANNOTATORS",
          value:
            typeof value === "function"
              ? (value as (
                  prev: { id: string; name: string }[],
                ) => { id: string; name: string }[])(draft.annotators)
              : value,
        })
      }
      queueDrawerOpen={{
        open: false,
        onOpen: () => {},
        onClose: () => {},
      }}
      isTrigger={true}
    />
  );
}
