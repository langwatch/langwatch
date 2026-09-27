import {
  Alert,
  Box,
  Button,
  Heading,
  HStack,
  Input,
  NativeSelect,
  RadioCard,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { WireOf } from "@langwatch/api/web";
import {
  getComplexProps,
  getDrawerStack,
  navigateToDrawer,
  setFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "@langwatch/browser-host/drawer";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { Drawer } from "@langwatch/design-system/studio-drawer";
import type { EvaluatorWithFields } from "@langwatch/evaluator-contract";
import { createEvaluatorEditorCallbacks } from "@langwatch/experiment-browser/evaluator-editor-callbacks";
import { validateEvaluatorMappingsWithFields } from "@langwatch/experiment-contract/mapping-validation";
import type { FieldMapping as UIFieldMapping } from "@langwatch/prompt-browser-kit";
import { EvaluationExecutionMode } from "@langwatch/workflow-contract";
import { AlertTriangle, ArrowLeft, HelpCircle, Spool, X } from "lucide-react";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { LuListTree } from "react-icons/lu";
import { z } from "zod";

import type {
  CheckPrecondition,
  CheckPreconditionFields,
  CheckPreconditionRule,
} from "../../../model/evaluations/types.ts";
import {
  DEFAULT_PRECONDITION,
  fieldRequiresKey,
  getAllowedRulesForField,
  getFieldOptionsByCategory,
  getFieldValueType,
  isDefaultOnlyPrecondition,
  isRuleAllowedForField,
  RULE_LABELS,
} from "../../../model/preconditions/precondition-field-utils.ts";

/** An evaluator as the drawer holds one: off a query, so its instants are strings. */
type WireEvaluatorWithFields = WireOf<EvaluatorWithFields>;
import { api } from "@langwatch/browser-trpc/workflow-api";
import type { MappingState, TRACE_MAPPINGS } from "@langwatch/dataset-contract";
import { HorizontalFormControl } from "@langwatch/design-system/horizontal-form-control";
import { SmallLabel } from "@langwatch/design-system/small-label";
import { Tooltip } from "@langwatch/design-system/tooltip";

import { EvaluatorSelectionBox } from "../../elements/evaluations/evaluator-selection-box.tsx";
import { StepRadio } from "../../elements/evaluations/step-button.tsx";
import type { EvaluatorMappingsConfig } from "../evaluators/evaluator-editor-shared.tsx";

const evaluatorSettingsSchema = z.record(z.string(), z.json());
import { deserializeMappingStateToUI } from "../../../model/evaluations/deserialize-mapping-state-to-ui.ts";
import { serializeMappingsToMappingState } from "../../../model/evaluations/serialize-mappings-to-mapping-state.ts";

export type EvaluationLevel = "trace" | "thread" | null;

export type OnlineEvaluationDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: () => void;
  /** If provided, loads an existing monitor for editing */
  monitorId?: string;
};

/** Auto-inferred mappings for standard evaluator fields */
const AUTO_INFER_MAPPINGS: Record<string, keyof typeof TRACE_MAPPINGS> = {
  input: "input",
  output: "output",
  contexts: "contexts",
  "contexts.string_list": "contexts.string_list",
};
/**
 * Get all field identifiers from an evaluator.
 * Fields are pre-computed by the API for both built-in and workflow evaluators.
 */
function getEvaluatorFieldIds(evaluator: WireEvaluatorWithFields | null | undefined): string[] {
  if (!evaluator?.fields) return [];
  return evaluator.fields.map((f) => f.identifier);
}

/**
 * Auto-infer mappings for standard fields (both required and optional).
 * This ensures that common fields like input/output are pre-filled.
 */
function autoInferMappings(
  allFields: string[],
  level: EvaluationLevel,
): Record<string, UIFieldMapping> {
  const mappings: Record<string, UIFieldMapping> = {};
  const sourceId = level === "trace" ? "trace" : "thread";

  for (const field of allFields) {
    const autoMapping = AUTO_INFER_MAPPINGS[field];
    if (autoMapping && level === "trace") {
      mappings[field] = {
        type: "source",
        sourceId,
        path: [autoMapping],
      };
    }
    // For thread level, auto-map "input" to "traces"
    if (field === "input" && level === "thread") {
      mappings[field] = {
        type: "source",
        sourceId,
        path: ["traces"],
      };
    }
  }

  return mappings;
}

// Module-level state to persist across drawer navigation (component unmounts/remounts)
let onlineEvaluationDrawerState: {
  level: EvaluationLevel; // Can be null (no selection), "trace", or "thread"
  name: string;
  selectedEvaluator: WireEvaluatorWithFields | null;
  sample: number;
  mappings: Record<string, UIFieldMapping>;
  preconditions: CheckPrecondition[];
  threadIdleTimeout: number | null; // Seconds to wait after last message (thread level only)
  pendingEvaluatorId?: string; // ID of newly created evaluator to load
} | null = null;

/** Clear persisted drawer state (for testing) */
export const clearOnlineEvaluationDrawerState = () => {
  onlineEvaluationDrawerState = null;
};

/** Set persisted drawer state (for testing) */
export const setOnlineEvaluationDrawerState = (state: typeof onlineEvaluationDrawerState) => {
  onlineEvaluationDrawerState = state;
};

/** Drawers of the online evaluation flow; navigating to these preserves state. */
const FLOW_SUB_DRAWERS = new Set(["evaluatorList", "evaluatorEditor", "evaluatorCategorySelector"]);

/**
 * True when the stack holds "onlineEvaluation" as a parent entry or a flow
 * sub-drawer; `closeDrawer()` empties the stack, so an abandoned flow reads false.
 */
function isInActiveEvaluationFlow(): boolean {
  const stack = getDrawerStack();
  return stack.some(
    (entry) => entry.drawer === "onlineEvaluation" || FLOW_SUB_DRAWERS.has(entry.drawer),
  );
}

/** Workflow evaluators check as "workflow", code ones by id, built-ins by configured type. */
function monitorCheckType({
  isWorkflowEvaluator,
  evaluatorKind,
  evaluatorId,
  configuredEvaluatorType,
}: {
  isWorkflowEvaluator: boolean;
  evaluatorKind: string;
  evaluatorId: string;
  configuredEvaluatorType: string | undefined;
}): string {
  if (isWorkflowEvaluator) return "workflow";
  if (evaluatorKind === "code") return `code/${evaluatorId}`;
  return configuredEvaluatorType ?? "langevals/basic";
}

/**
 * Drawer for creating/editing online evaluations (monitors).
 * Allows selecting an evaluator, configuring sampling, preconditions, and mappings.
 */
export function OnlineEvaluationDrawer(props: OnlineEvaluationDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, openDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const drawerParams = useDrawerParams();
  const utils = api.useUtils();

  const onClose = props.onClose ?? closeDrawer;
  const onSave = props.onSave ?? (complexProps.onSave as OnlineEvaluationDrawerProps["onSave"]);

  const monitorId =
    props.monitorId ?? drawerParams.monitorId ?? (complexProps.monitorId as string | undefined);

  const isOpen = props.open !== false && props.open !== undefined;

  // Form type for react-hook-form
  type FormValues = {
    level: EvaluationLevel;
    name: string;
    sample: number;
    preconditions: CheckPrecondition[];
    threadIdleTimeout: number | null;
    // Note: selectedEvaluator and mappings are managed separately because they're complex objects
    // that need special handling (module-level persistence, callbacks, etc.)
  };

  // Form state using react-hook-form
  const form = useForm<FormValues>({
    defaultValues: {
      level: onlineEvaluationDrawerState?.level ?? null,
      name: onlineEvaluationDrawerState?.name ?? "",
      sample: onlineEvaluationDrawerState?.sample ?? 1.0,
      preconditions: onlineEvaluationDrawerState?.preconditions ?? [DEFAULT_PRECONDITION],
      threadIdleTimeout: onlineEvaluationDrawerState?.threadIdleTimeout ?? 300,
    },
  });

  // Watch form values for easy access
  const level = form.watch("level");
  const name = form.watch("name");
  const sample = form.watch("sample");
  const preconditions = form.watch("preconditions");
  const threadIdleTimeout = form.watch("threadIdleTimeout");

  // These are managed separately due to complex interactions with drawer system
  const [selectedEvaluator, setSelectedEvaluator] = useState<WireEvaluatorWithFields | null>(
    () => onlineEvaluationDrawerState?.selectedEvaluator ?? null,
  );
  const [mappings, setMappings] = useState<Record<string, UIFieldMapping>>(
    () => onlineEvaluationDrawerState?.mappings ?? {},
  );

  // Track if the form has been modified (dirty state)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useClearStateOnLeave();

  // Skip the first watch trigger (initial render)
  const isInitialRenderRef = useRef(true);

  useEffect(() => {
    const subscription = form.watch(() =>
      markDirtyAfterMount(isInitialRenderRef, setHasUnsavedChanges),
    );
    return () => subscription.unsubscribe();
  }, [form]);

  const pendingEvaluatorId = onlineEvaluationDrawerState?.pendingEvaluatorId;
  const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { monitorQuery, evaluatorQuery, pendingEvaluatorQuery } = useDrawerQueries({
    monitorId,
    projectId: project?.id,
    pendingEvaluatorId,
    isOpen,
  });

  // Create mutation
  const finishSave = (savedMonitorId: string | undefined) => {
    invalidateMonitorQueries({
      utils,
      projectId: project?.id ?? "",
      timeZone: localTimeZone,
      monitorId: savedMonitorId,
    });
    // Clear persisted state after successful save
    onlineEvaluationDrawerState = null;
    onSave?.();
    onClose();
  };
  const createMutation = api.monitors.create.useMutation({
    onSuccess: () => finishSave(undefined),
  });

  // Update mutation
  const updateMutation = api.monitors.update.useMutation({
    onSuccess: () => finishSave(monitorId),
  });

  // Compute all fields from the evaluator (pre-computed by API for both built-in and workflow)
  const allFields = useMemo(() => getEvaluatorFieldIds(selectedEvaluator), [selectedEvaluator]);

  // Use shared validation logic (same as evaluations v3)
  // Fields include required/optional flag from the API
  const mappingValidation = useMemo(
    () => validateMappingsFor(selectedEvaluator, mappings),
    [selectedEvaluator, mappings],
  );

  // For backward compatibility with existing code
  const pendingFields = mappingValidation.missingRequiredFields;
  // Invalid if: required fields missing OR no fields mapped (when there are fields)
  const hasPendingMappings = selectedEvaluator !== null && !mappingValidation.isValid;

  // Track if we've already loaded the monitor data (to prevent re-loading on remount)
  const monitorDataLoadedRef = useRef(false);

  // Track previous open state to reset form when drawer opens fresh (no persisted state)
  // This effect must run BEFORE the persist effect to check the state before it's updated
  const prevIsOpenRef = useRef(false); // Start as false so first open is detected
  useEffect(() => {
    // If drawer is opening (was closed, now open), check if we need to reset.
    // Reset when: no persisted state, OR stale state from a previous abandoned session.
    // Stale state = module-level state exists but we're NOT returning from a flow sub-drawer
    // (the stack would have "onlineEvaluation" if returning from evaluator list/editor).
    if (opensFresh(prevIsOpenRef.current, isOpen)) {
      onlineEvaluationDrawerState = null;
      form.reset({
        level: null, // Start with no level selected for progressive disclosure
        name: "",
        sample: 1.0,
        preconditions: [DEFAULT_PRECONDITION],
        threadIdleTimeout: 300,
      });
      setSelectedEvaluator(null);
      setMappings({});
      setHasUnsavedChanges(false); // Reset dirty state for new form
      isInitialRenderRef.current = true; // Reset the initial render flag
      monitorDataLoadedRef.current = false; // Reset so data can be loaded for edit mode
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, form]);

  // Persist state changes to module-level storage
  useEffect(() => {
    if (!isOpen) return;
    // Preserve pendingEvaluatorId if it exists (don't overwrite with undefined)
    onlineEvaluationDrawerState = {
      level,
      name,
      selectedEvaluator,
      sample,
      mappings,
      preconditions,
      threadIdleTimeout,
      pendingEvaluatorId: onlineEvaluationDrawerState?.pendingEvaluatorId,
    };
  }, [isOpen, level, name, selectedEvaluator, sample, mappings, preconditions, threadIdleTimeout]);

  // Mark form as dirty when user makes changes to non-form-managed state
  const markDirty = useCallback(() => setHasUnsavedChanges(true), []);

  // Clear persisted state when drawer truly closes (via close button, not navigation)
  const handleClose = useCallback(() => {
    if (!confirmDiscard(hasUnsavedChanges)) return;
    onlineEvaluationDrawerState = null;
    setHasUnsavedChanges(false);
    monitorDataLoadedRef.current = false; // Reset so data reloads next time
    (canGoBack ? goBack : onClose)();
  }, [onClose, hasUnsavedChanges, canGoBack, goBack]);

  useLoadIntoDrawer({
    monitorId,
    monitor: monitorQuery.data,
    linkedEvaluator: evaluatorQuery.data,
    pendingEvaluatorId,
    pendingEvaluator: pendingEvaluatorQuery.data,
    form,
    name,
    level,
    mappings,
    selectedEvaluator,
    setSelectedEvaluator,
    setMappings,
    setHasUnsavedChanges,
    markDirty,
    monitorDataLoadedRef,
    isInitialRenderRef,
  });

  // Handle mapping change from evaluator editor
  // IMPORTANT: This persists to module-level state FIRST because OnlineEvaluationDrawer
  // may not be mounted when EvaluatorEditorDrawer is open (CurrentDrawer renders one at a time)
  // We cannot rely on setMappings callback to persist because it may not run when unmounted.
  const { openEvaluatorEditorForMappings, handleEditSelectedEvaluator, handleSelectEvaluator } =
    useEvaluatorFlow({
      draft: { level, name, sample, preconditions, threadIdleTimeout },
      selectedEvaluator,
      mappings,
      form,
      openDrawer,
      setSelectedEvaluator,
      setMappings,
      setHasUnsavedChanges,
    });

  const handleLevelChange = useCallback(
    (details: { value: string | null }) => {
      if (!details.value) return;
      const newLevel = details.value as EvaluationLevel;
      form.setValue("level", newLevel);
      const newMappings = mappingsForLevel({ selectedEvaluator, allFields, level: newLevel });
      setMappings(newMappings);
      persistDrawerStatePatch({ level: newLevel, mappings: newMappings });
    },
    [selectedEvaluator, allFields, form],
  );

  // Track whether preconditions are expanded (user clicked "Add precondition")
  const { preconditionsExpanded, addPrecondition, removePrecondition, updatePrecondition } =
    usePreconditions(form);

  // Compute field groups for the dropdown
  const fieldGroups = useMemo(() => getFieldOptionsByCategory(), []);

  const handleSave = useCallback(() => {
    saveMonitor({
      monitorId,
      projectId: project?.id,
      blocked: hasPendingMappings,
      draft: { selectedEvaluator, name, preconditions, mappings, sample, level, threadIdleTimeout },
      create: createMutation.mutate,
      update: updateMutation.mutate,
    });
  }, [
    selectedEvaluator,
    project?.id,
    name,
    hasPendingMappings,
    mappings,
    monitorId,
    sample,
    preconditions,
    updateMutation,
    createMutation,
    level,
    threadIdleTimeout,
  ]);

  const isLoading = createMutation.isPending || updateMutation.isPending;
  const canSave = canSaveMonitor({ level, selectedEvaluator, name, isLoading, hasPendingMappings });

  // Run on text
  const runOnText = runOnTextFor(sample);

  return (
    <Drawer.Root open={isOpen} onOpenChange={({ open }) => !open && handleClose()} size="lg">
      <Drawer.Content bg="bg">
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <HStack gap={2}>
            {canGoBack && (
              <Button variant="ghost" size="sm" onClick={goBack} padding={1} minWidth="auto">
                <ArrowLeft size={20} />
              </Button>
            )}
            <Heading size="md">
              {monitorId ? "Edit Online Evaluation" : "New Online Evaluation"}
            </Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <VStack gap={0} align="stretch">
            {/* Evaluation Level */}
            <HorizontalFormControl
              label="Evaluation Level"
              helper="Select at which level should the online evaluation run"
              align="start"
              labelProps={{ paddingLeft: 0 }}
            >
              <RadioCard.Root
                variant="outline"
                colorPalette="orange"
                value={level ?? ""}
                onValueChange={handleLevelChange}
                width="full"
              >
                <VStack gap={2} width="full" align="stretch">
                  <StepRadio
                    value="trace"
                    title="Trace Level"
                    description="Evaluate each trace individually as it arrives"
                    icon={<LuListTree />}
                    width="full"
                  />
                  <StepRadio
                    value="thread"
                    title="Thread Level"
                    description="Evaluate all traces in a thread together"
                    icon={<Spool />}
                    width="full"
                  />
                </VStack>
              </RadioCard.Root>
            </HorizontalFormControl>

            {/* Evaluator Selection - only show after level is selected */}
            {level && (
              <HorizontalFormControl
                label="Evaluator"
                helper={
                  <EvaluatorHelperText
                    hasSelection={!!selectedEvaluator}
                    onRemoveSelection={() => {
                      setSelectedEvaluator(null);
                      form.setValue("name", "");
                      setMappings({});
                      setHasUnsavedChanges(true);
                    }}
                  />
                }
              >
                <VStack align="stretch" gap={2}>
                  <EvaluatorSelectionBox
                    selectedEvaluator={selectedEvaluator}
                    onSelectClick={handleSelectEvaluator}
                    onEditClick={handleEditSelectedEvaluator}
                    placeholder="Select Evaluator"
                  />

                  {/* Pending Mappings Warning */}
                  {hasPendingMappings && (
                    <PendingMappingsAlert
                      pendingCount={pendingFields.length}
                      onConfigure={openEvaluatorEditorForMappings}
                    />
                  )}
                </VStack>
              </HorizontalFormControl>
            )}

            {/* Name - only show after evaluator is selected */}
            {level && selectedEvaluator && (
              <>
                <HorizontalFormControl
                  label="Name"
                  helper="A descriptive name for this online evaluation"
                >
                  <Input {...form.register("name")} placeholder="Enter evaluation name" />
                </HorizontalFormControl>
                <HorizontalFormControl
                  label={
                    <HStack>
                      Preconditions (Optional)
                      <Tooltip content="Conditions that must be met for this evaluation to run">
                        <HelpCircle size={14} />
                      </Tooltip>
                    </HStack>
                  }
                  helper="Only run this evaluation when certain conditions are met"
                >
                  <PreconditionsEditor
                    preconditions={preconditions}
                    expanded={preconditionsExpanded}
                    runOnText={runOnText}
                    fieldGroups={fieldGroups}
                    onAdd={addPrecondition}
                    onUpdate={updatePrecondition}
                    onRemove={removePrecondition}
                  />
                </HorizontalFormControl>
                <HorizontalFormControl
                  label={
                    <HStack>
                      Sampling (Optional)
                      <Tooltip content="You can use this to save costs on expensive evaluations if you have too many messages incoming. From 0.01 to run on 1% of the messages to 1.0 to run on 100% of the messages">
                        <HelpCircle size={14} />
                      </Tooltip>
                    </HStack>
                  }
                  helper=""
                >
                  <VStack align="start">
                    <HStack>
                      <Input
                        width="110px"
                        type="number"
                        min="0.01"
                        max="1"
                        step="0.1"
                        value={sample}
                        onChange={(e) => form.setValue("sample", parseFloat(e.target.value) || 1)}
                      />
                    </HStack>
                    <Text color="gray.500" fontStyle="italic">
                      This evaluation will run on {runOnText}
                      {preconditions.length > 0 && " matching the preconditions"}
                    </Text>
                  </VStack>
                </HorizontalFormControl>
              </>
            )}

            {/* Thread Idle Timeout - only show for thread level */}
            {level === "thread" && selectedEvaluator && (
              <HorizontalFormControl
                label={
                  <HStack>
                    Thread Idle Time
                    <Tooltip content="Wait for the thread to be idle (no new messages) before running the evaluation. This prevents re-evaluating on every single message in a thread.">
                      <HelpCircle size={14} />
                    </Tooltip>
                  </HStack>
                }
                helper="How long to wait after the last message before evaluating the thread"
              >
                <ThreadIdleTimeoutSelect
                  value={threadIdleTimeout}
                  onChange={(value) => form.setValue("threadIdleTimeout", value)}
                />
              </HorizontalFormControl>
            )}
          </VStack>
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border" paddingX={4} paddingY={3}>
          <HStack gap={3} width="full" justify="flex-end">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              onClick={handleSave}
              disabled={!canSave}
              title={hasPendingMappings ? "Complete all mappings first" : undefined}
            >
              {isLoading && <Spinner size="sm" marginRight={2} />}
              {monitorId ? "Save Changes" : "Create Online Evaluation"}
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function invalidateMonitorQueries({
  utils,
  projectId,
  timeZone,
  monitorId,
}: {
  utils: ReturnType<typeof api.useUtils>;
  projectId: string;
  timeZone: string;
  monitorId: string | undefined;
}) {
  void utils.monitors.getAllForProject.invalidate({ projectId });
  void utils.monitors.getPerformanceForProject.invalidate({ projectId, timeZone });
  if (monitorId) void utils.monitors.getById.invalidate({ id: monitorId, projectId });
}

/** Required and optional fields come pre-computed from the API; no fields means nothing to map. */
function validateMappingsFor(
  selectedEvaluator: WireEvaluatorWithFields | null,
  mappings: Record<string, UIFieldMapping>,
) {
  if (!selectedEvaluator?.fields) {
    return { isValid: true, hasAnyMapping: false, missingRequiredFields: [] };
  }
  const requiredFields = selectedEvaluator.fields
    .filter((f) => !f.optional)
    .map((f) => f.identifier);
  const optionalFields = selectedEvaluator.fields
    .filter((f) => f.optional)
    .map((f) => f.identifier);
  return validateEvaluatorMappingsWithFields(requiredFields, optionalFields, mappings);
}

/**
 * An opening drawer resets unless it returns from a flow sub-drawer: stale module state from an
 * abandoned session does not count.
 */
function opensFresh(wasOpen: boolean, isOpen: boolean): boolean {
  if (wasOpen || !isOpen) return false;
  const hasStaleState = !!onlineEvaluationDrawerState && !isInActiveEvaluationFlow();
  return !onlineEvaluationDrawerState || hasStaleState;
}

/** Patches the module-level drawer state, when there is one to patch. */
function persistDrawerStatePatch(patch: Partial<NonNullable<typeof onlineEvaluationDrawerState>>) {
  if (!onlineEvaluationDrawerState) return;
  onlineEvaluationDrawerState = { ...onlineEvaluationDrawerState, ...patch };
}

/** A saved monitor as the form holds it; level defaults to "trace" for older monitors. */
function monitorFormValues(monitor: {
  name: string;
  sample: number;
  preconditions: unknown;
  threadIdleTimeout?: number | null;
  level?: unknown;
  mappings?: unknown;
}) {
  const level = (monitor.level as EvaluationLevel) ?? "trace";
  const existingMappings = monitor.mappings as MappingState | null;
  return {
    values: {
      name: monitor.name,
      sample: monitor.sample,
      preconditions: (monitor.preconditions as CheckPrecondition[]) ?? [],
      threadIdleTimeout: monitor.threadIdleTimeout ?? null,
      level,
    },
    mappings: existingMappings?.mapping
      ? deserializeMappingStateToUI(existingMappings, level as "trace" | "thread")
      : undefined,
  };
}

function withMappingChange(
  mappings: Record<string, UIFieldMapping>,
  identifier: string,
  mapping: UIFieldMapping | undefined,
): Record<string, UIFieldMapping> {
  if (mapping) return { ...mappings, [identifier]: mapping };
  return Object.fromEntries(Object.entries(mappings).filter(([k]) => k !== identifier));
}

/**
 * Opens the evaluator editor on an evaluator with its mappings. onMappingChange goes through
 * flowCallbacks (durable), never mappingsConfig (ephemeral complexProps, lost on remount).
 * Selecting replaces the list in the stack, so back returns to the online evaluation.
 */
function openEvaluatorEditor({
  openDrawer,
  evaluatorId,
  level,
  initialMappings,
  onMappingChange,
  selecting = false,
}: {
  openDrawer: ReturnType<typeof useDrawer>["openDrawer"];
  evaluatorId: string;
  level: EvaluationLevel;
  initialMappings: Record<string, UIFieldMapping>;
  onMappingChange: (identifier: string, mapping: UIFieldMapping | undefined) => void;
  selecting?: boolean;
}) {
  setFlowCallbacks("evaluatorEditor", createEvaluatorEditorCallbacks({ onMappingChange }));
  const mappingsConfig: EvaluatorMappingsConfig = { level: level ?? undefined, initialMappings };
  if (!selecting) {
    openDrawer("evaluatorEditor", { evaluatorId, mappingsConfig });
    return;
  }
  openDrawer(
    "evaluatorEditor",
    { evaluatorId, mappingsConfig, saveButtonText: "Select Evaluator" },
    { replaceCurrentInStack: true },
  );
}

/**
 * A new evaluator saved from the flow is remembered by id and loaded when the online evaluation
 * reopens; navigation is module-level because this drawer may not be mounted by then.
 */
function registerNewEvaluatorFlow(draft: {
  level: EvaluationLevel;
  name: string;
  sample: number;
  preconditions: CheckPrecondition[];
  threadIdleTimeout: number | null;
}) {
  setFlowCallbacks(
    "evaluatorEditor",
    createEvaluatorEditorCallbacks({
      onSave: (savedEvaluator) => {
        onlineEvaluationDrawerState = {
          ...draft,
          name: draft.name || savedEvaluator.name,
          selectedEvaluator: null,
          mappings: {},
          pendingEvaluatorId: savedEvaluator.id,
        };
        navigateToDrawer("onlineEvaluation", { resetStack: true });
        // Handled navigation, so the editor does not also go back.
        return true;
      },
    }),
  );
}

/**
 * A new field resets a rule it does not allow, resets the value across boolean and non-boolean
 * fields, and clears key/subkey.
 */
function withPreconditionEdit(
  p: CheckPrecondition,
  key: keyof CheckPrecondition,
  value: string,
): CheckPrecondition {
  if (key !== "field") return { ...p, [key]: value };
  const newField = value as CheckPreconditionFields;
  const updates: Partial<CheckPrecondition> = {
    field: newField,
    key: undefined,
    subkey: undefined,
  };
  if (!isRuleAllowedForField(newField, p.rule as CheckPreconditionRule)) {
    updates.rule = getAllowedRulesForField(newField)[0] ?? "is";
  }
  const newType = getFieldValueType(newField);
  if (newType !== getFieldValueType(p.field as CheckPreconditionFields)) {
    updates.value = newType === "boolean" ? "true" : "";
  }
  return { ...p, ...updates };
}

function monitorPayload({
  selectedEvaluator,
  projectId,
  name,
  preconditions,
  mappings,
  sample,
  level,
  threadIdleTimeout,
}: {
  selectedEvaluator: WireEvaluatorWithFields;
  projectId: string;
  name: string;
  preconditions: CheckPrecondition[];
  mappings: Record<string, UIFieldMapping>;
  sample: number;
  level: EvaluationLevel;
  threadIdleTimeout: number | null;
}) {
  const evaluatorConfig = selectedEvaluator.config as {
    evaluatorType?: string;
    settings?: Record<string, unknown>;
  } | null;
  return {
    projectId,
    name: name.trim(),
    checkType: monitorCheckType({
      isWorkflowEvaluator: selectedEvaluator.type === "workflow",
      evaluatorKind: selectedEvaluator.type,
      evaluatorId: selectedEvaluator.id,
      configuredEvaluatorType: evaluatorConfig?.evaluatorType,
    }),
    preconditions,
    settings: evaluatorSettingsSchema.parse(evaluatorConfig?.settings ?? {}),
    mappings: serializeMappingsToMappingState(mappings),
    sample,
    executionMode: EvaluationExecutionMode.ON_MESSAGE,
    evaluatorId: selectedEvaluator.id,
    level: level ?? "trace",
    threadIdleTimeout: level === "thread" ? threadIdleTimeout : null,
  };
}

type PreconditionFieldGroups = ReturnType<typeof getFieldOptionsByCategory>;

function PreconditionRow({
  precondition,
  index,
  fieldGroups,
  onUpdate,
  onRemove,
}: {
  precondition: CheckPrecondition;
  index: number;
  fieldGroups: PreconditionFieldGroups;
  onUpdate: (index: number, key: keyof CheckPrecondition, value: string) => void;
  onRemove: (index: number) => void;
}) {
  const updatePrecondition = onUpdate;
  const removePrecondition = onRemove;
  const currentField = precondition.field as CheckPreconditionFields;
  const allowedRules = getAllowedRulesForField(currentField);
  const valueType = getFieldValueType(currentField);
  const keyInfo = fieldRequiresKey(currentField);
  return (
    <Box borderLeft="4px solid" borderLeftColor="blue.400" width="full">
      <VStack padding={3} width="full" align="start" position="relative">
        <Button
          aria-label={`Remove precondition ${index + 1}`}
          position="absolute"
          right={0}
          top={0}
          padding={0}
          size="sm"
          variant="ghost"
          onClick={() => removePrecondition(index)}
          color="gray.400"
        >
          <X size={16} />
        </Button>
        <SmallLabel>{index === 0 ? "When" : "and"}</SmallLabel>
        <HStack gap={2} flexWrap="wrap">
          <NativeSelect.Root minWidth="fit-content">
            <NativeSelect.Field
              value={precondition.field}
              onChange={(e) => updatePrecondition(index, "field", e.target.value)}
            >
              {fieldGroups.map((group) => (
                <optgroup key={group.category} label={group.category}>
                  {group.fields.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>

          {keyInfo && (
            <Input
              value={precondition.key ?? ""}
              onChange={(e) => updatePrecondition(index, "key", e.target.value)}
              placeholder={keyInfo.label}
              minWidth="120px"
              maxWidth="200px"
            />
          )}

          <NativeSelect.Root minWidth="fit-content">
            <NativeSelect.Field
              value={precondition.rule}
              onChange={(e) => updatePrecondition(index, "rule", e.target.value)}
            >
              {allowedRules.map((rule) => (
                <option key={rule} value={rule}>
                  {RULE_LABELS[rule]}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </HStack>
        <HStack width="full">
          {valueType === "boolean" ? (
            <NativeSelect.Root minWidth="fit-content">
              <NativeSelect.Field
                value={precondition.value}
                onChange={(e) => updatePrecondition(index, "value", e.target.value)}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          ) : (
            <>
              {precondition.rule.includes("regex") && <Text fontSize="16px">{"/"}</Text>}
              <Input
                value={precondition.value}
                onChange={(e) => updatePrecondition(index, "value", e.target.value)}
                placeholder={precondition.rule.includes("regex") ? "regex" : "text"}
              />
              {precondition.rule.includes("regex") && <Text fontSize="16px">{"/gi"}</Text>}
            </>
          )}
        </HStack>
      </VStack>
    </Box>
  );
}

function PendingMappingsAlert({
  pendingCount,
  onConfigure,
}: {
  pendingCount: number;
  onConfigure: () => void;
}) {
  return (
    <Alert.Root status="warning">
      <Alert.Indicator>
        <AlertTriangle size={16} />
      </Alert.Indicator>
      <Box flex="1">
        <Alert.Title>
          {pendingCount > 0
            ? `${pendingCount} field${pendingCount > 1 ? "s" : ""} need${pendingCount === 1 ? "s" : ""} mapping`
            : "At least one field needs mapping"}
        </Alert.Title>
        <Alert.Description>Configure how evaluator inputs map to trace data.</Alert.Description>
      </Box>
      <Button size="sm" variant="outline" onClick={onConfigure}>
        Configure
      </Button>
    </Alert.Root>
  );
}

function ThreadIdleTimeoutSelect({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <NativeSelect.Root width="250px">
      <NativeSelect.Field
        value={value === null ? "" : String(value)}
        onChange={(e) => {
          const val = e.target.value;
          onChange(val === "" ? null : parseInt(val, 10));
        }}
      >
        <option value="">Disabled - evaluate on every trace</option>
        <option value="60">1 minute</option>
        <option value="300">5 minutes</option>
        <option value="600">10 minutes</option>
        <option value="900">15 minutes</option>
        <option value="1800">30 minutes</option>
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  );
}

function PreconditionsEditor({
  preconditions,
  expanded,
  runOnText,
  fieldGroups,
  onAdd,
  onUpdate,
  onRemove,
}: {
  preconditions: CheckPrecondition[];
  expanded: boolean;
  runOnText: string;
  fieldGroups: PreconditionFieldGroups;
  onAdd: () => void;
  onUpdate: (index: number, key: keyof CheckPrecondition, value: string) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <VStack align="start" gap={3}>
      {isDefaultOnlyPrecondition(preconditions) && !expanded ? (
        <>
          <Text color="gray.500" fontStyle="italic">
            This evaluation will run on every application trace
          </Text>
          <Button variant="outline" onClick={onAdd}>
            Add Precondition
          </Button>
        </>
      ) : (
        <>
          {preconditions.map((precondition, index) => (
            <PreconditionRow
              key={index}
              precondition={precondition}
              index={index}
              fieldGroups={fieldGroups}
              onUpdate={onUpdate}
              onRemove={onRemove}
            />
          ))}
          <Text color="gray.500" fontStyle="italic">
            This evaluation will run on {runOnText}
            {preconditions.length > 0 && " matching the preconditions"}
          </Text>
          <Button variant="outline" onClick={onAdd}>
            Add Precondition
          </Button>
        </>
      )}
    </VStack>
  );
}

function EvaluatorHelperText({
  hasSelection,
  onRemoveSelection,
}: {
  hasSelection: boolean;
  onRemoveSelection: () => void;
}) {
  return (
    <Text lineHeight="1.5">
      Select an evaluator to run on incoming traces
      {hasSelection && (
        <>
          <br />
          <Text
            as="span"
            color="blue.500"
            cursor="pointer"
            textDecoration="underline"
            _hover={{ color: "blue.600" }}
            onClick={onRemoveSelection}
          >
            (Remove Selection)
          </Text>
        </>
      )}
    </Text>
  );
}

type DrawerFormValues = {
  level: EvaluationLevel;
  name: string;
  sample: number;
  preconditions: CheckPrecondition[];
  threadIdleTimeout: number | null;
};

/**
 * Loads what the drawer edits: a saved monitor once, its linked evaluator, a pending evaluator
 * created in the flow, and mappings inferred once per evaluator while none exist.
 */
function useLoadIntoDrawer({
  monitorId,
  monitor,
  linkedEvaluator,
  pendingEvaluatorId,
  pendingEvaluator,
  form,
  name,
  level,
  mappings,
  selectedEvaluator,
  setSelectedEvaluator,
  setMappings,
  setHasUnsavedChanges,
  markDirty,
  monitorDataLoadedRef,
  isInitialRenderRef,
}: {
  monitorId: string | undefined;
  monitor: Parameters<typeof monitorFormValues>[0] | null | undefined;
  linkedEvaluator: WireEvaluatorWithFields | null | undefined;
  pendingEvaluatorId: string | undefined;
  pendingEvaluator: WireEvaluatorWithFields | null | undefined;
  form: UseFormReturn<DrawerFormValues>;
  name: string;
  level: EvaluationLevel;
  mappings: Record<string, UIFieldMapping>;
  selectedEvaluator: WireEvaluatorWithFields | null;
  setSelectedEvaluator: (evaluator: WireEvaluatorWithFields | null) => void;
  setMappings: (mappings: Record<string, UIFieldMapping>) => void;
  setHasUnsavedChanges: (dirty: boolean) => void;
  markDirty: () => void;
  monitorDataLoadedRef: { current: boolean };
  isInitialRenderRef: { current: boolean };
}) {
  // Load existing monitor data - only once when data first becomes available
  // Skip if we already have persisted state for this monitor (user navigated away and back)
  useEffect(() => {
    // Skip if already loaded for this monitor
    if (monitorDataLoadedRef.current) {
      return;
    }

    // Skip if there's persisted state (user made changes and navigated away)
    // This preserves user's changes when they go to evaluator editor and come back
    if (onlineEvaluationDrawerState?.selectedEvaluator) {
      return;
    }

    if (!monitor || !monitorId) return;
    monitorDataLoadedRef.current = true;
    const loaded = monitorFormValues(monitor);
    form.reset(loaded.values);
    if (loaded.mappings) setMappings(loaded.mappings);
    // Loading existing data doesn't count as "dirty"
    setHasUnsavedChanges(false);
    isInitialRenderRef.current = true; // Reset watch trigger flag
  }, [
    monitor,
    monitorId,
    form,
    setMappings,
    setHasUnsavedChanges,
    isInitialRenderRef,
    monitorDataLoadedRef,
  ]);

  // Load linked evaluator
  useEffect(() => {
    if (linkedEvaluator) {
      setSelectedEvaluator(linkedEvaluator);
    }
  }, [linkedEvaluator, setSelectedEvaluator]);

  // Auto-infer mappings when evaluator with fields is selected but mappings are empty
  // This handles all evaluator types (built-in and workflow) since fields are pre-computed
  const lastAutoInferredEvaluatorRef = useRef<string | null>(null);
  useEffect(() => {
    // Once per evaluator, and only while nothing is mapped yet.
    if (!selectedEvaluator?.fields || !level) return;
    if (lastAutoInferredEvaluatorRef.current === selectedEvaluator.id) return;
    if (Object.keys(mappings).length > 0) return;
    lastAutoInferredEvaluatorRef.current = selectedEvaluator.id;
    const autoMappings = autoInferMappings(getEvaluatorFieldIds(selectedEvaluator), level);
    setMappings(autoMappings);
    persistDrawerStatePatch({ mappings: autoMappings });
  }, [selectedEvaluator, level, mappings, setMappings]);

  // Load pending evaluator (newly created from the flow)
  useEffect(() => {
    if (!pendingEvaluator || !pendingEvaluatorId) return;
    const evaluator = pendingEvaluator;
    setSelectedEvaluator(evaluator);
    markDirty(); // User created and selected a new evaluator
    if (!name) form.setValue("name", evaluator.name);
    // Auto-infer mappings using pre-computed fields from the API
    const autoMappings = autoInferMappings(getEvaluatorFieldIds(evaluator), level);
    setMappings(autoMappings);
    // Clear the pending evaluator ID
    persistDrawerStatePatch({
      selectedEvaluator: evaluator,
      mappings: autoMappings,
      pendingEvaluatorId: undefined,
    });
  }, [
    pendingEvaluator,
    pendingEvaluatorId,
    name,
    level,
    form,
    markDirty,
    setMappings,
    setSelectedEvaluator,
  ]);
}

function confirmDiscard(hasUnsavedChanges: boolean): boolean {
  return (
    !hasUnsavedChanges ||
    window.confirm("You have unsaved changes. Are you sure you want to close?")
  );
}

function canSaveMonitor({
  level,
  selectedEvaluator,
  name,
  isLoading,
  hasPendingMappings,
}: {
  level: EvaluationLevel;
  selectedEvaluator: WireEvaluatorWithFields | null;
  name: string;
  isLoading: boolean;
  hasPendingMappings: boolean;
}): boolean {
  return !!level && !!selectedEvaluator && !!name.trim() && !isLoading && !hasPendingMappings;
}

function runOnTextFor(sample: number): string {
  return sample >= 1 ? "every trace" : `${+(sample * 100).toFixed(2)}% of traces`;
}

/**
 * Choosing, creating and editing the evaluator: each path persists the draft to module state
 * before navigating, since this drawer may be unmounted while the evaluator drawers are open.
 */
function useEvaluatorFlow({
  draft,
  selectedEvaluator,
  mappings,
  form,
  openDrawer,
  setSelectedEvaluator,
  setMappings,
  setHasUnsavedChanges,
}: {
  draft: {
    level: EvaluationLevel;
    name: string;
    sample: number;
    preconditions: CheckPrecondition[];
    threadIdleTimeout: number | null;
  };
  selectedEvaluator: WireEvaluatorWithFields | null;
  mappings: Record<string, UIFieldMapping>;
  form: UseFormReturn<DrawerFormValues>;
  openDrawer: ReturnType<typeof useDrawer>["openDrawer"];
  setSelectedEvaluator: (evaluator: WireEvaluatorWithFields | null) => void;
  setMappings: Dispatch<SetStateAction<Record<string, UIFieldMapping>>>;
  setHasUnsavedChanges: (dirty: boolean) => void;
}) {
  const { level, name, sample, preconditions, threadIdleTimeout } = draft;
  const handleMappingChange = useCallback(
    (identifier: string, mapping: UIFieldMapping | undefined) => {
      // First, persist to module-level state (this always runs, even if component is unmounted)
      if (onlineEvaluationDrawerState) {
        persistDrawerStatePatch({
          mappings: withMappingChange(onlineEvaluationDrawerState.mappings, identifier, mapping),
        });
      }
      // Then update React state (only matters if component is mounted)
      setMappings((prev) => withMappingChange(prev, identifier, mapping));
      // Mark as dirty since user changed mappings
      setHasUnsavedChanges(true);
    },
    [setMappings, setHasUnsavedChanges],
  );

  // Open evaluator editor with mappings config
  const openEvaluatorEditorForMappings = useCallback(() => {
    if (!selectedEvaluator) return;
    openEvaluatorEditor({
      openDrawer,
      evaluatorId: selectedEvaluator.id,
      level,
      initialMappings: mappings,
      onMappingChange: handleMappingChange,
    });
  }, [selectedEvaluator, level, mappings, handleMappingChange, openDrawer]);

  // Picking an evaluator (existing or from the list) names the check, infers its mappings,
  // persists before navigating, and opens the editor in place of the list.
  const adoptEvaluatorAndOpenEditor = useCallback(
    (evaluator: WireEvaluatorWithFields) => {
      const newName = name || evaluator.name;
      setSelectedEvaluator(evaluator);
      setHasUnsavedChanges(true);
      if (!name) form.setValue("name", newName);
      const autoMappings = autoInferMappings(getEvaluatorFieldIds(evaluator), level);
      setMappings(autoMappings);
      onlineEvaluationDrawerState = {
        level,
        name: newName,
        selectedEvaluator: evaluator,
        sample,
        mappings: autoMappings,
        preconditions,
        threadIdleTimeout,
      };
      openEvaluatorEditor({
        openDrawer,
        evaluatorId: evaluator.id,
        level,
        initialMappings: autoMappings,
        onMappingChange: handleMappingChange,
        selecting: true,
      });
    },
    [
      name,
      level,
      sample,
      preconditions,
      threadIdleTimeout,
      form,
      openDrawer,
      handleMappingChange,
      setSelectedEvaluator,
      setMappings,
      setHasUnsavedChanges,
    ],
  );

  // Open evaluator editor when clicking on already-selected evaluator
  // This opens the editor directly with mappings config
  const handleEditSelectedEvaluator = useCallback(() => {
    if (!selectedEvaluator) return;
    // Changing evaluator from the list stays reachable via the editor's "back" button.
    setFlowCallbacks("evaluatorList", { onSelect: adoptEvaluatorAndOpenEditor });
    // Editing the already-selected evaluator keeps the default "Save Changes" text.
    openEvaluatorEditor({
      openDrawer,
      evaluatorId: selectedEvaluator.id,
      level,
      initialMappings: mappings,
      onMappingChange: handleMappingChange,
    });
  }, [
    selectedEvaluator,
    level,
    mappings,
    handleMappingChange,
    openDrawer,
    adoptEvaluatorAndOpenEditor,
  ]);

  const handleSelectEvaluator = useCallback(() => {
    setFlowCallbacks("evaluatorList", {
      onSelect: adoptEvaluatorAndOpenEditor,
      onCreateNew: () => {
        registerNewEvaluatorFlow({ level, name, sample, preconditions, threadIdleTimeout });
        openDrawer("evaluatorCategorySelector");
      },
    });
    openDrawer("evaluatorList", {});
  }, [
    name,
    level,
    sample,
    preconditions,
    threadIdleTimeout,
    openDrawer,
    adoptEvaluatorAndOpenEditor,
  ]);

  return {
    openEvaluatorEditorForMappings,
    handleEditSelectedEvaluator,
    handleSelectEvaluator,
  };
}

/** The precondition list: edits go to the form; the list opens once one is added. */
function usePreconditions(form: UseFormReturn<DrawerFormValues>) {
  const [preconditionsExpanded, setPreconditionsExpanded] = useState(false);

  // Precondition handlers
  const addPrecondition = useCallback(() => {
    const current = form.getValues("preconditions");
    form.setValue("preconditions", [
      ...current,
      { field: "metadata.labels", rule: "contains", value: "" },
    ]);
    setPreconditionsExpanded(true);
  }, [form]);

  const removePrecondition = useCallback(
    (index: number) => {
      const current = form.getValues("preconditions");
      const updated = current.filter((_, i) => i !== index);
      form.setValue("preconditions", updated);
      // Collapse back to summary if only default precondition remains
      if (isDefaultOnlyPrecondition(updated)) {
        setPreconditionsExpanded(false);
      }
    },
    [form],
  );

  const updatePrecondition = useCallback(
    (index: number, key: keyof CheckPrecondition, value: string) => {
      const current = form.getValues("preconditions");
      const updated = current.map((p, i) =>
        i === index ? withPreconditionEdit(p, key, value) : p,
      );
      form.setValue("preconditions", updated);
    },
    [form],
  );

  return { preconditionsExpanded, addPrecondition, removePrecondition, updatePrecondition };
}

/** Clears module-level state on unmount unless in an active flow; StrictMode's simulated
 * cleanup can see "onlineEvaluation" mid-mount, so the check is the flow, not the stack top. */
function useClearStateOnLeave() {
  useLayoutEffect(() => {
    return () => {
      if (!isInActiveEvaluationFlow()) onlineEvaluationDrawerState = null;
    };
  }, []);
}

/** Any form edit after the first (mount) trigger marks the drawer dirty. */
function markDirtyAfterMount(
  isInitialRenderRef: { current: boolean },
  setHasUnsavedChanges: (dirty: boolean) => void,
) {
  if (isInitialRenderRef.current) {
    isInitialRenderRef.current = false;
    return;
  }
  setHasUnsavedChanges(true);
}

/** The monitor being edited, its linked evaluator, and an evaluator just created in the flow. */
function useDrawerQueries({
  monitorId,
  projectId,
  pendingEvaluatorId,
  isOpen,
}: {
  monitorId: string | undefined;
  projectId: string | undefined;
  pendingEvaluatorId: string | undefined;
  isOpen: boolean;
}) {
  const canLoad = !!projectId && isOpen;
  const monitorQuery = api.monitors.getById.useQuery(
    { id: monitorId ?? "", projectId: projectId ?? "" },
    { enabled: !!monitorId && canLoad },
  );
  const linkedEvaluatorId = monitorQuery.data?.evaluatorId;
  const evaluatorQuery = api.evaluators.getById.useQuery(
    { id: linkedEvaluatorId ?? "", projectId: projectId ?? "" },
    { enabled: !!linkedEvaluatorId && canLoad },
  );
  const pendingEvaluatorQuery = api.evaluators.getById.useQuery(
    { id: pendingEvaluatorId ?? "", projectId: projectId ?? "" },
    { enabled: !!pendingEvaluatorId && canLoad },
  );
  return { monitorQuery, evaluatorQuery, pendingEvaluatorQuery };
}

/** Trace and thread levels map from different sources, so mappings are replaced, not merged. */
function mappingsForLevel({
  selectedEvaluator,
  allFields,
  level,
}: {
  selectedEvaluator: WireEvaluatorWithFields | null;
  allFields: string[];
  level: EvaluationLevel;
}): Record<string, UIFieldMapping> {
  return selectedEvaluator ? autoInferMappings(allFields, level) : {};
}

type MonitorPayload = ReturnType<typeof monitorPayload>;

function saveMonitor({
  monitorId,
  projectId,
  blocked,
  draft,
  create,
  update,
}: {
  monitorId: string | undefined;
  projectId: string | undefined;
  blocked: boolean;
  draft: Omit<Parameters<typeof monitorPayload>[0], "projectId" | "selectedEvaluator"> & {
    selectedEvaluator: WireEvaluatorWithFields | null;
  };
  create: (payload: MonitorPayload) => void;
  update: (payload: MonitorPayload & { id: string }) => void;
}) {
  const { selectedEvaluator } = draft;
  if (!selectedEvaluator || !projectId || !draft.name.trim() || blocked) return;
  const payload = monitorPayload({ ...draft, selectedEvaluator, projectId });
  if (monitorId) {
    update({ id: monitorId, ...payload });
  } else {
    create(payload);
  }
}
