import {
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
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { ArrowLeft, Check, Database, Mail, Send, Users } from "lucide-react";
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
  type VariableInfo,
} from "./editors/templateAuthoring";
import {
  CONDITIONS_JSON_SCHEMA,
  CONDITIONS_MODEL_URI,
  registerJsonSchema,
} from "./editors/monacoSchemas";
import { useMonacoTheme } from "./editors/useMonacoTheme";
import {
  ACTION_LABEL,
  type AutomationDraft,
  type ConditionSource,
  type DraftAction,
  EMPTY_FIELD,
  INITIAL_DRAFT,
  actionParamsFromDraft,
  conditionsAreSet,
  configIsComplete,
  configurationSummary,
  notifyChannel,
  reducer,
  summariseConditions,
  templatesFromDraft,
  type SlackTemplateType,
} from "./logic/draftReducer";
import {
  explainDomainError,
  readDomainError,
} from "./logic/errorExplainer";
import { DatasetSelector } from "~/components/datasets/DatasetSelector";
import { FieldsFilters } from "~/components/filters/FieldsFilters";
import { HorizontalFormControl } from "~/components/HorizontalFormControl";
import { Drawer } from "~/components/ui/drawer";
import { Switch } from "~/components/ui/switch";
import { toaster } from "~/components/ui/toaster";
import { AddParticipants } from "~/components/traces/AddParticipants";

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

const PREVIEW_DEBOUNCE_MS = 400;
type Section = null | "filters" | "configuration";

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
    const hasCustomGraph = !!t.customGraphId;
    dispatch({
      type: "HYDRATE",
      value: {
        ...INITIAL_DRAFT,
        action: t.action as TriggerAction,
        name: t.name,
        alertType: t.alertType,
        source: hasCustomGraph ? "customGraph" : "trace",
        customGraphId: t.customGraphId,
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

  const conditionsSet = conditionsAreSet(draft);
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
        onError: (err) => {
          const domain = readDomainError(err);
          const { title, description } = domain
            ? explainDomainError(domain)
            : { title: "Test fire failed", description: err.message };
          toaster.create({
            title,
            type: "error",
            description: description || err.message,
            meta: { closable: true },
          });
        },
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
        filters: draft.source === "customGraph" ? {} : draft.filters,
        customGraphId: draft.source === "customGraph" ? draft.customGraphId : null,
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
                    ? summariseConditions(draft)
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
        scaffoldLoaded={!!scaffold.data}
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

function SourceCard({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <Box
      as="button"
      flex="1"
      textAlign="left"
      padding={3}
      borderRadius="md"
      border="1px solid"
      borderColor={active ? "orange.400" : "border"}
      bg={active ? "orange.50" : "bg"}
      _dark={{ bg: active ? "orange.900" : "bg" }}
      onClick={onClick}
    >
      <Text fontWeight="semibold">{title}</Text>
      <Text textStyle="xs" color="fg.muted" mt={1}>
        {description}
      </Text>
    </Box>
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
  // The whole row is the click target; the explicit "Edit" button is gone per
  // user feedback. A completed section picks up a distinct border so the eye
  // can scan the main view for what still needs filling in.
  return (
    <HStack
      as="button"
      type="button"
      padding={3}
      borderRadius="md"
      border="1px solid"
      borderColor={complete ? "green.400" : "border"}
      bg={complete ? "green.50" : "bg"}
      _dark={{ bg: complete ? "green.900" : "bg" }}
      opacity={disabled ? 0.6 : 1}
      cursor={disabled ? "not-allowed" : "pointer"}
      onClick={disabled ? undefined : onEdit}
      _hover={disabled ? undefined : { borderColor: complete ? "green.500" : "orange.400" }}
      width="full"
      textAlign="left"
    >
      <VStack align="start" gap={0} flex="1" minWidth="0">
        <HStack>
          <Text fontWeight="semibold">{title}</Text>
          {complete ? <Check size={14} color="var(--chakra-colors-green-500)" /> : null}
        </HStack>
        <Text textStyle="sm" color="fg.muted" lineClamp={2}>
          {summary}
        </Text>
      </VStack>
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

// ---------- Filters secondary drawer ----------

interface FiltersDrawerResult {
  source: ConditionSource;
  filters: Partial<Record<FilterField, FilterParam>>;
  customGraphId: string | null;
}

function FiltersSecondaryDrawer({
  open,
  source,
  filters,
  customGraphId,
  projectId,
  onSave,
  onCancel,
}: {
  open: boolean;
  source: ConditionSource;
  filters: Partial<Record<FilterField, FilterParam>>;
  customGraphId: string | null;
  projectId: string;
  onSave: (result: FiltersDrawerResult) => void;
  onCancel: () => void;
}) {
  const [localSource, setLocalSource] = useState<ConditionSource>(source);
  const [local, setLocal] = useState(filters);
  const [localCustomGraphId, setLocalCustomGraphId] = useState<string | null>(
    customGraphId,
  );
  const [codeMode, setCodeMode] = useState(false);
  const [code, setCode] = useState(JSON.stringify(filters, null, 2));
  const [codeError, setCodeError] = useState<string | null>(null);
  const conditionsEditorTheme = useMonacoTheme();

  useEffect(() => {
    if (open) {
      setLocalSource(source);
      setLocal(filters);
      setLocalCustomGraphId(customGraphId);
      setCode(JSON.stringify(filters, null, 2));
      setCodeError(null);
    }
  }, [open, source, filters, customGraphId]);

  const graphs = api.graphs.getAll.useQuery(
    { projectId },
    { enabled: open && localSource === "customGraph" && !!projectId },
  );

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
    if (localSource === "customGraph") {
      onSave({
        source: "customGraph",
        filters: {},
        customGraphId: localCustomGraphId,
      });
      return;
    }
    if (codeMode) {
      try {
        const parsed = JSON.parse(code);
        const result = triggerFiltersPermissiveSchema.safeParse(parsed);
        if (!result.success) {
          setCodeError(result.error.errors[0]?.message ?? "Invalid filters");
          return;
        }
        const { sanitized } = sanitizeTriggerFilters(result.data);
        onSave({
          source: "trace",
          filters: sanitized as Partial<Record<FilterField, FilterParam>>,
          customGraphId: null,
        });
      } catch {
        setCodeError("Invalid JSON syntax");
      }
    } else {
      onSave({ source: "trace", filters: local, customGraphId: null });
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
            {localSource === "trace" ? (
              <>
                <Text textStyle="sm" color="fg.muted">
                  Code
                </Text>
                <Switch
                  checked={codeMode}
                  onCheckedChange={({ checked }) => onToggle(checked)}
                />
              </>
            ) : null}
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <Box mb={4}>
            <Text textStyle="xs" fontWeight="semibold" color="fg.muted" mb={2}>
              Source
            </Text>
            <HStack gap={2}>
              <SourceCard
                active={localSource === "trace"}
                title="Trace data"
                description="Match on incoming traces using filter fields."
                onClick={() => setLocalSource("trace")}
              />
              <SourceCard
                active={localSource === "customGraph"}
                title="Custom graph"
                description="Fire when a custom-graph alert threshold is crossed."
                onClick={() => setLocalSource("customGraph")}
              />
            </HStack>
          </Box>
          {localSource === "customGraph" ? (
            <VStack align="stretch" gap={2}>
              <Field.Root>
                <Field.Label>Custom graph</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    value={localCustomGraphId ?? ""}
                    onChange={(e) =>
                      setLocalCustomGraphId(e.target.value || null)
                    }
                  >
                    <option value="">Select a graph…</option>
                    {(graphs.data ?? []).map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name ?? g.id}
                        {g.trigger ? " — already automated" : ""}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Field.Root>
              <Text textStyle="xs" color="fg.muted">
                The automation fires when this custom graph's alert threshold
                is crossed. Configure thresholds from the analytics view.
              </Text>
            </VStack>
          ) : codeMode ? (
            <VStack align="stretch" gap={2}>
              <Box
                border="1px solid"
                borderColor={codeError ? "red.500" : "border"}
                borderRadius="md"
                overflow="hidden"
                height="500px"
                background={conditionsEditorTheme === "monokai" ? "#272822" : "white"}
              >
                <MonacoEditor
                  height="100%"
                  language="json"
                  path={CONDITIONS_MODEL_URI}
                  value={code}
                  theme={conditionsEditorTheme}
                  beforeMount={(monaco: Monaco) => {
                    monaco.editor.defineTheme(
                      "monokai",
                      monokaiTheme as Parameters<typeof monaco.editor.defineTheme>[1],
                    );
                    registerJsonSchema(
                      monaco,
                      CONDITIONS_MODEL_URI,
                      CONDITIONS_JSON_SCHEMA,
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
  scaffoldLoaded,
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
  /** When false, defaults haven't arrived yet — render a spinner instead of
   *  the editors so they don't mount with empty values that the user then
   *  has to refresh away. */
  scaffoldLoaded: boolean;
  draft: AutomationDraft;
  dispatch: React.Dispatch<DraftAction>;
  variables: VariableInfo[];
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
          {!scaffoldLoaded ? (
            <HStack padding={6} color="fg.muted" gap={3}>
              <Spinner size="sm" />
              <Text>Loading default templates…</Text>
            </HStack>
          ) : (
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
          )}
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
  variables: VariableInfo[];
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
    <VStack align="stretch" gap={4}>
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
        height="280px"
        value={bodyValue}
        onChange={(value) =>
          dispatch({
            type: "SET_EMAIL_BODY",
            value: { value, usingDefault: false },
          })
        }
      />
      <Box
        border="1px solid"
        borderColor="border"
        borderRadius="md"
        padding={3}
      >
        <HStack mb={2}>
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
      </Box>
      <VariableReference variables={variables} />
      {example ? <ExampleData example={example} /> : null}
    </VStack>
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
  variables: VariableInfo[];
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
    <VStack align="stretch" gap={4}>
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
        height="320px"
        language={isBlockKit ? "json" : undefined}
        value={slackValue}
        onChange={(value) =>
          dispatch({
            type: "SET_SLACK_TEMPLATE",
            value: { value, usingDefault: false },
          })
        }
      />
      <Box
        border="1px solid"
        borderColor="border"
        borderRadius="md"
        padding={3}
      >
        <HStack mb={2}>
          <Text textStyle="sm" fontWeight="semibold">
            Preview
          </Text>
          {previewLoading ? <Spinner size="xs" /> : null}
        </HStack>
        <PreviewWarnings data={preview} />
        {preview ? (
          <SlackPreview payload={preview.payload} />
        ) : (
          <Text color="fg.muted" textStyle="sm">
            Edit a template to preview.
          </Text>
        )}
      </Box>
      <VariableReference variables={variables} />
      {example ? <ExampleData example={example} /> : null}
    </VStack>
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
