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
import { EvaluationExecutionMode, type Evaluator } from "@prisma/client";
import { AlertTriangle, HelpCircle, Spool, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import type { AvailableSource, FieldMapping as UIFieldMapping } from "~/components/variables";
import { Drawer } from "~/components/ui/drawer";
import {
  getComplexProps,
  setFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "~/server/evaluations/evaluators.generated";
import type { CheckPrecondition } from "~/server/evaluations/types";
import { TRACE_MAPPINGS, THREAD_MAPPINGS, type MappingState } from "~/server/tracer/tracesMapping";
import { api } from "~/utils/api";
import { validateEvaluatorMappings } from "~/evaluations-v3/utils/mappingValidation";
import type { EvaluatorMappingsConfig } from "../evaluators/EvaluatorEditorDrawer";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { SmallLabel } from "../SmallLabel";
import { Tooltip } from "../ui/tooltip";
import { EvaluatorSelectionBox } from "./EvaluatorSelectionBox";
import { StepRadio } from "./wizard/components/StepButton";
import { LuListTree } from "react-icons/lu";

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
 * Static children for metadata field.
 * These are the reserved metadata keys that are always available.
 */
const METADATA_CHILDREN = [
  { name: "thread_id", type: "str" as const },
  { name: "user_id", type: "str" as const },
  { name: "customer_id", type: "str" as const },
  { name: "labels", type: "list" as const },
  { name: "topic_id", type: "str" as const },
  { name: "subtopic_id", type: "str" as const },
];

/**
 * Static children for spans field.
 * These are the common span subfields.
 */
const SPANS_CHILDREN = [
  { name: "input", type: "str" as const },
  { name: "output", type: "str" as const },
  { name: "params", type: "dict" as const },
  { name: "contexts", type: "list" as const },
];

/**
 * Convert TRACE_MAPPINGS to AvailableSource format for the mapping UI.
 * Provides static children for known nested fields like metadata and spans.
 */
function getTraceAvailableSources(): AvailableSource[] {
  // Filter out "threads" from trace-level sources - it's confusing at trace level
  // (threads is for getting all traces in a thread, which is a thread-level concept)
  const traceFields = Object.entries(TRACE_MAPPINGS)
    .filter(([key]) => key !== "threads")
    .map(([key, config]) => {
      const hasKeys = "keys" in config && typeof config.keys === "function";

      // Provide static children for known nested fields
      if (key === "metadata") {
        return {
          name: key,
          type: "dict" as const,
          children: METADATA_CHILDREN,
          // Allow selecting metadata itself (returns full metadata object)
          isComplete: true,
        };
      }

      if (key === "spans") {
        return {
          name: key,
          type: "list" as const,
          children: SPANS_CHILDREN,
          // Allow selecting spans itself (returns all spans)
          isComplete: true,
        };
      }

      // Other fields with keys() function - mark as complete (no nested selection needed)
      if (hasKeys) {
        return {
          name: key,
          type: "dict" as const,
          isComplete: true,
        };
      }

      return {
        name: key,
        type: "str" as const,
      };
    });

  return [{
    id: "trace",
    name: "Trace",
    type: "dataset",
    fields: traceFields,
  }];
}

/**
 * Static children for thread traces field.
 * These are the common trace fields that can be extracted from each trace in a thread.
 */
const THREAD_TRACES_CHILDREN = [
  { name: "input", type: "str" as const },
  { name: "output", type: "str" as const },
  { name: "contexts", type: "list" as const },
  { name: "timestamp", type: "str" as const },
  { name: "trace_id", type: "str" as const },
];

/**
 * Convert THREAD_MAPPINGS to AvailableSource format for the mapping UI.
 */
function getThreadAvailableSources(): AvailableSource[] {
  return [{
    id: "thread",
    name: "Thread",
    type: "dataset",
    fields: Object.entries(THREAD_MAPPINGS).map(([key, config]) => {
      // Special handling for "traces" - provide nested children for field selection
      if (key === "traces") {
        return {
          name: key,
          type: "list" as const,
          children: THREAD_TRACES_CHILDREN,
          // Allow selecting traces itself (returns all trace data)
          isComplete: true,
        };
      }

      const hasKeys = "keys" in config && typeof config.keys === "function";

      // For thread mappings, most fields are complete selections
      if (hasKeys) {
        return {
          name: key,
          type: "dict" as const,
          isComplete: true,
        };
      }

      return {
        name: key,
        type: "str" as const,
      };
    }),
  }];
}

/**
 * Get required fields from an evaluator definition.
 */
function getRequiredFields(evaluatorType: EvaluatorTypes | undefined): string[] {
  if (!evaluatorType) return [];
  const def = AVAILABLE_EVALUATORS[evaluatorType];
  if (!def) return [];
  return def.requiredFields ?? ["input", "output"];
}

/**
 * Get all fields (required + optional) from an evaluator definition.
 */
function getAllFields(evaluatorType: EvaluatorTypes | undefined): string[] {
  if (!evaluatorType) return [];
  const def = AVAILABLE_EVALUATORS[evaluatorType];
  if (!def) return [];
  const required = def.requiredFields ?? ["input", "output"];
  const optional = def.optionalFields ?? [];
  return [...required, ...optional];
}

/**
 * Auto-infer mappings for standard fields (both required and optional).
 * This ensures that common fields like input/output are pre-filled.
 */
function autoInferMappings(
  allFields: string[],
  level: EvaluationLevel
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

/**
 * Compute which fields are pending (unmapped).
 */
function getPendingFields(
  requiredFields: string[],
  mappings: Record<string, UIFieldMapping>
): string[] {
  return requiredFields.filter((field) => {
    const mapping = mappings[field];
    if (!mapping) return true;
    if (mapping.type === "source" && mapping.path.length === 0) return true;
    if (mapping.type === "value" && !mapping.value) return true;
    return false;
  });
}

// Precondition options
const ruleOptions: Record<CheckPrecondition["rule"], string> = {
  not_contains: "does not contain",
  contains: "contains",
  matches_regex: "matches regex",
};

const fieldOptions: Record<string, string> = {
  output: "output",
  input: "input",
  "metadata.labels": "metadata.labels",
};

// Module-level state to persist across drawer navigation (component unmounts/remounts)
let onlineEvaluationDrawerState: {
  level: EvaluationLevel; // Can be null (no selection), "trace", or "thread"
  name: string;
  selectedEvaluator: Evaluator | null;
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

/**
 * Drawer for creating/editing online evaluations (monitors).
 * Allows selecting an evaluator, configuring sampling, preconditions, and mappings.
 */
export function OnlineEvaluationDrawer(props: OnlineEvaluationDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, openDrawer } = useDrawer();
  const complexProps = getComplexProps();
  const drawerParams = useDrawerParams();
  const utils = api.useContext();

  const onClose = props.onClose ?? closeDrawer;
  const onSave =
    props.onSave ??
    (complexProps.onSave as OnlineEvaluationDrawerProps["onSave"]);

  const monitorId =
    props.monitorId ??
    drawerParams.monitorId ??
    (complexProps.monitorId as string | undefined);

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
      preconditions: onlineEvaluationDrawerState?.preconditions ?? [],
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
  const [selectedEvaluator, setSelectedEvaluator] = useState<Evaluator | null>(
    () => onlineEvaluationDrawerState?.selectedEvaluator ?? null
  );
  const [mappings, setMappings] = useState<Record<string, UIFieldMapping>>(
    () => onlineEvaluationDrawerState?.mappings ?? {}
  );

  // Track if the form has been modified (dirty state)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Skip the first watch trigger (initial render)
  const isInitialRenderRef = useRef(true);

  // Track form changes using react-hook-form's watch
  useEffect(() => {
    const subscription = form.watch(() => {
      // Skip the first trigger which happens on mount
      if (isInitialRenderRef.current) {
        isInitialRenderRef.current = false;
        return;
      }
      setHasUnsavedChanges(true);
    });
    return () => subscription.unsubscribe();
  }, [form]);

  // Load existing monitor if editing
  const monitorQuery = api.monitors.getById.useQuery(
    { id: monitorId ?? "", projectId: project?.id ?? "" },
    { enabled: !!monitorId && !!project?.id && isOpen }
  );

  // Load evaluator if monitor has evaluatorId
  const evaluatorQuery = api.evaluators.getById.useQuery(
    {
      id: monitorQuery.data?.evaluatorId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!monitorQuery.data?.evaluatorId && !!project?.id && isOpen,
    }
  );

  // Load pending evaluator (newly created from the flow)
  const pendingEvaluatorId = onlineEvaluationDrawerState?.pendingEvaluatorId;
  const pendingEvaluatorQuery = api.evaluators.getById.useQuery(
    {
      id: pendingEvaluatorId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!pendingEvaluatorId && !!project?.id && isOpen,
    }
  );

  // Create mutation
  const createMutation = api.monitors.create.useMutation({
    onSuccess: () => {
      void utils.monitors.getAllForProject.invalidate({
        projectId: project?.id ?? "",
      });
      // Clear persisted state after successful save
      onlineEvaluationDrawerState = null;
      onSave?.();
      onClose();
    },
  });

  // Update mutation
  const updateMutation = api.monitors.update.useMutation({
    onSuccess: () => {
      void utils.monitors.getAllForProject.invalidate({
        projectId: project?.id ?? "",
      });
      // Clear persisted state after successful save
      onlineEvaluationDrawerState = null;
      onSave?.();
      onClose();
    },
  });

  // Get evaluator type info for display
  const evaluatorType = selectedEvaluator
    ? ((selectedEvaluator.config as { evaluatorType?: string } | null)
      ?.evaluatorType as EvaluatorTypes | undefined)
    : undefined;

  // Compute required fields and all fields
  const requiredFields = useMemo(
    () => getRequiredFields(evaluatorType),
    [evaluatorType]
  );
  const allFields = useMemo(
    () => getAllFields(evaluatorType),
    [evaluatorType]
  );

  // Use shared validation logic (same as evaluations v3)
  // This ensures consistent validation across the platform
  const mappingValidation = useMemo(() => {
    if (!evaluatorType) {
      return { isValid: true, hasAnyMapping: false, missingRequiredFields: [] };
    }
    return validateEvaluatorMappings(evaluatorType, mappings);
  }, [evaluatorType, mappings]);

  // For backward compatibility with existing code
  const pendingFields = mappingValidation.missingRequiredFields;
  // Invalid if: required fields missing OR no fields mapped (when there are fields)
  const hasPendingMappings = selectedEvaluator !== null && !mappingValidation.isValid;

  // Get available sources based on level (empty if no level selected)
  const availableSources = useMemo(
    () => {
      if (!level) return [];
      return level === "trace" ? getTraceAvailableSources() : getThreadAvailableSources();
    },
    [level]
  );

  // Track previous open state to reset form when drawer opens fresh (no persisted state)
  // This effect must run BEFORE the persist effect to check the state before it's updated
  const prevIsOpenRef = useRef(false); // Start as false so first open is detected
  useEffect(() => {
    // If drawer is opening (was closed, now open) and there's no persisted state, reset form
    if (!prevIsOpenRef.current && isOpen && !onlineEvaluationDrawerState) {
      form.reset({
        level: null, // Start with no level selected for progressive disclosure
        name: "",
        sample: 1.0,
        preconditions: [],
        threadIdleTimeout: 300,
      });
      setSelectedEvaluator(null);
      setMappings({});
      setHasUnsavedChanges(false); // Reset dirty state for new form
      isInitialRenderRef.current = true; // Reset the initial render flag
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, form]);

  // Persist state changes to module-level storage
  useEffect(() => {
    if (isOpen) {
      onlineEvaluationDrawerState = {
        level,
        name,
        selectedEvaluator,
        sample,
        mappings,
        preconditions,
        threadIdleTimeout,
      };
    }
  }, [isOpen, level, name, selectedEvaluator, sample, mappings, preconditions, threadIdleTimeout]);

  // Mark form as dirty when user makes changes to non-form-managed state
  const markDirty = useCallback(() => setHasUnsavedChanges(true), []);

  // Clear persisted state when drawer truly closes (via close button, not navigation)
  const handleClose = useCallback(() => {
    if (hasUnsavedChanges) {
      if (
        !window.confirm(
          "You have unsaved changes. Are you sure you want to close?"
        )
      ) {
        return;
      }
    }
    onlineEvaluationDrawerState = null;
    setHasUnsavedChanges(false);
    onClose();
  }, [onClose, hasUnsavedChanges]);

  // Load existing monitor data
  useEffect(() => {
    if (monitorQuery.data && monitorId) {
      const monitorName = monitorQuery.data.name;
      const monitorSample = monitorQuery.data.sample;
      const monitorPreconditions = (monitorQuery.data.preconditions as CheckPrecondition[]) ?? [];
      const monitorThreadIdleTimeout = monitorQuery.data.threadIdleTimeout ?? null;
      // Load level from monitor data (defaults to "trace" for backward compatibility)
      const monitorLevel = (monitorQuery.data.level as EvaluationLevel) ?? "trace";

      // Reset form with loaded data
      form.reset({
        name: monitorName,
        sample: monitorSample,
        preconditions: monitorPreconditions,
        threadIdleTimeout: monitorThreadIdleTimeout,
        level: monitorLevel,
      });

      // Load existing mappings
      const existingMappings = monitorQuery.data.mappings as MappingState | null;
      const uiMappings: Record<string, UIFieldMapping> = {};
      if (existingMappings?.mapping) {
        for (const [field, mapping] of Object.entries(existingMappings.mapping)) {
          if (mapping.source) {
            const pathParts: string[] = [mapping.source as string];
            if (mapping.key) pathParts.push(mapping.key);
            if (mapping.subkey) pathParts.push(mapping.subkey);
            uiMappings[field] = {
              type: "source",
              sourceId: monitorLevel === "trace" ? "trace" : "thread",
              path: pathParts,
            };
          }
        }
        setMappings(uiMappings);
      }

      // Loading existing data doesn't count as "dirty"
      setHasUnsavedChanges(false);
    }
  }, [monitorQuery.data, monitorId, form]);

  // Load linked evaluator
  useEffect(() => {
    if (evaluatorQuery.data) {
      setSelectedEvaluator(evaluatorQuery.data);
    }
  }, [evaluatorQuery.data]);

  // Load pending evaluator (newly created from the flow)
  useEffect(() => {
    if (pendingEvaluatorQuery.data && pendingEvaluatorId) {
      const evaluator = pendingEvaluatorQuery.data;
      setSelectedEvaluator(evaluator);
      markDirty(); // User created and selected a new evaluator

      // Set name if not already set
      if (!name) {
        form.setValue("name", evaluator.name);
      }

      // Get evaluator type and auto-infer mappings
      const evalType = (evaluator.config as { evaluatorType?: string } | null)
        ?.evaluatorType as EvaluatorTypes | undefined;
      const fields = getAllFields(evalType);
      const autoMappings = autoInferMappings(fields, level);
      setMappings(autoMappings);

      // Clear the pending evaluator ID
      if (onlineEvaluationDrawerState) {
        onlineEvaluationDrawerState = {
          ...onlineEvaluationDrawerState,
          selectedEvaluator: evaluator,
          mappings: autoMappings,
          pendingEvaluatorId: undefined,
        };
      }
    }
  }, [pendingEvaluatorQuery.data, pendingEvaluatorId, name, level, form, markDirty]);

  // Handle mapping change from evaluator editor
  // IMPORTANT: This persists to module-level state FIRST because OnlineEvaluationDrawer
  // may not be mounted when EvaluatorEditorDrawer is open (CurrentDrawer renders one at a time)
  // We cannot rely on setMappings callback to persist because it may not run when unmounted.
  const handleMappingChange = useCallback(
    (identifier: string, mapping: UIFieldMapping | undefined) => {
      // First, persist to module-level state (this always runs, even if component is unmounted)
      if (onlineEvaluationDrawerState) {
        const prevMappings = onlineEvaluationDrawerState.mappings;
        const newMappings = mapping
          ? { ...prevMappings, [identifier]: mapping }
          : Object.fromEntries(Object.entries(prevMappings).filter(([k]) => k !== identifier));

        onlineEvaluationDrawerState = {
          ...onlineEvaluationDrawerState,
          mappings: newMappings,
        };
      }

      // Then update React state (only matters if component is mounted)
      setMappings((prev) => {
        return mapping
          ? { ...prev, [identifier]: mapping }
          : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== identifier));
      });

      // Mark as dirty since user changed mappings
      setHasUnsavedChanges(true);
    },
    []
  );

  // Open evaluator editor with mappings config
  const openEvaluatorEditorForMappings = useCallback(() => {
    if (!selectedEvaluator) return;

    const mappingsConfig: EvaluatorMappingsConfig = {
      availableSources,
      initialMappings: mappings,
      onMappingChange: handleMappingChange,
    };

    openDrawer("evaluatorEditor", {
      evaluatorId: selectedEvaluator.id,
      mappingsConfig,
    });
  }, [selectedEvaluator, availableSources, mappings, handleMappingChange, openDrawer]);

  // Open evaluator editor when clicking on already-selected evaluator
  // This opens the editor directly with mappings config
  const handleEditSelectedEvaluator = useCallback(() => {
    if (!selectedEvaluator) return;

    // Set up the flow callback for if user wants to change evaluator from the list
    // (accessible via "back" button in evaluator editor)
    setFlowCallbacks("evaluatorList", {
      onSelect: (evaluator: Evaluator) => {
        const newName = name || evaluator.name;
        setSelectedEvaluator(evaluator);
        setHasUnsavedChanges(true); // User selected a different evaluator
        if (!name) {
          form.setValue("name", newName);
        }

        // Get evaluator type and all fields (required + optional)
        const evalType = (evaluator.config as { evaluatorType?: string } | null)
          ?.evaluatorType as EvaluatorTypes | undefined;
        const fields = getAllFields(evalType);
        const autoMappings = autoInferMappings(fields, level);
        setMappings(autoMappings);

        // Persist state
        onlineEvaluationDrawerState = {
          level,
          name: newName,
          selectedEvaluator: evaluator,
          sample,
          mappings: autoMappings,
          preconditions,
          threadIdleTimeout,
        };

        // Build mappings config and navigate to evaluator editor
        const newMappingsConfig: EvaluatorMappingsConfig = {
          availableSources: level === "trace" ? getTraceAvailableSources() : getThreadAvailableSources(),
          initialMappings: autoMappings,
          onMappingChange: handleMappingChange,
        };

        // Use "Select Evaluator" button text since we're selecting a different evaluator
        openDrawer("evaluatorEditor", {
          evaluatorId: evaluator.id,
          mappingsConfig: newMappingsConfig,
          saveButtonText: "Select Evaluator",
        }, { replaceCurrentInStack: true });
      },
    });

    const mappingsConfig: EvaluatorMappingsConfig = {
      availableSources,
      initialMappings: mappings,
      onMappingChange: handleMappingChange,
    };

    // Open the evaluator editor directly - use default "Save Changes" text
    // since we're editing an already-selected evaluator
    openDrawer("evaluatorEditor", {
      evaluatorId: selectedEvaluator.id,
      mappingsConfig,
    });
  }, [selectedEvaluator, name, level, sample, preconditions, availableSources, mappings, handleMappingChange, openDrawer]);

  const handleSelectEvaluator = useCallback(() => {
    // Helper function to handle evaluator selection (used by both existing and new evaluators)
    const selectEvaluatorAndOpenEditor = (evaluator: Evaluator) => {
      const newName = name || evaluator.name;
      setSelectedEvaluator(evaluator);
      setHasUnsavedChanges(true); // User selected an evaluator

      // Default name to evaluator name if not set
      if (!name) {
        form.setValue("name", newName);
      }

      // Get evaluator type and all fields (required + optional)
      const evalType = (evaluator.config as { evaluatorType?: string } | null)
        ?.evaluatorType as EvaluatorTypes | undefined;
      const fields = getAllFields(evalType);

      // Auto-infer mappings for all fields (required + optional)
      const autoMappings = autoInferMappings(fields, level);

      setMappings(autoMappings);

      // Immediately persist state (useEffect may not run before navigation)
      onlineEvaluationDrawerState = {
        level,
        name: newName,
        selectedEvaluator: evaluator,
        sample,
        mappings: autoMappings,
        preconditions,
        threadIdleTimeout,
      };

      // Build mappings config for the evaluator editor
      const mappingsConfig: EvaluatorMappingsConfig = {
        availableSources: level === "trace" ? getTraceAvailableSources() : getThreadAvailableSources(),
        initialMappings: autoMappings,
        onMappingChange: handleMappingChange,
      };

      // Open evaluator editor immediately (replaceCurrentInStack replaces evaluatorList with evaluatorEditor)
      // This way, Cancel/back from evaluatorEditor goes to onlineEvaluation, not evaluatorList
      // Use "Select Evaluator" button text since we're selecting, not editing
      openDrawer("evaluatorEditor", {
        evaluatorId: evaluator.id,
        mappingsConfig,
        saveButtonText: "Select Evaluator",
      }, { replaceCurrentInStack: true });
    };

    // Helper to set up the evaluatorEditor callback for NEW evaluators
    const setupNewEvaluatorCallback = () => {
      setFlowCallbacks("evaluatorEditor", {
        onSave: (savedEvaluator: { id: string; name: string }) => {
          // Store the new evaluator info in module-level state
          // The evaluator will be loaded when the online evaluation drawer reopens
          const newName = name || savedEvaluator.name;
          if (!name) {
            form.setValue("name", newName);
          }

          // Persist state with the new evaluator ID (the full evaluator will be loaded via query)
          onlineEvaluationDrawerState = {
            level,
            name: newName,
            selectedEvaluator: null, // Will be loaded via query
            sample,
            mappings: {},
            preconditions,
            threadIdleTimeout,
            // Store the new evaluator ID to load it when the drawer reopens
            pendingEvaluatorId: savedEvaluator.id,
          };

          // Navigate directly to online evaluation drawer (resetting the stack)
          openDrawer("onlineEvaluation", {}, { resetStack: true });

          // Return true to indicate we handled navigation (prevents default goBack())
          return true;
        },
      });
    };

    // Set flow callback for evaluator selection (when user selects an existing evaluator)
    // Also set onCreateNew to set up the evaluatorEditor callback for new evaluators
    setFlowCallbacks("evaluatorList", {
      onSelect: selectEvaluatorAndOpenEditor,
      onCreateNew: () => {
        // Set up the callback for when the new evaluator is saved
        setupNewEvaluatorCallback();
        // Open the category selector (default behavior)
        openDrawer("evaluatorCategorySelector");
      },
    });

    openDrawer("evaluatorList", {});
  }, [name, level, sample, preconditions, openDrawer, handleMappingChange, threadIdleTimeout]);

  const handleLevelChange = useCallback((details: { value: string | null }) => {
    if (!details.value) return;
    const newLevel = details.value as EvaluationLevel;
    form.setValue("level", newLevel);

    // Clear and re-infer mappings for new level
    // Important: We must completely replace mappings when switching levels
    // because trace-level and thread-level have completely different sources
    if (selectedEvaluator) {
      // Start fresh with auto-inferred mappings for the new level
      const autoMappings = autoInferMappings(allFields, newLevel);
      setMappings(autoMappings);

      // Also persist to module-level state
      if (onlineEvaluationDrawerState) {
        onlineEvaluationDrawerState = {
          ...onlineEvaluationDrawerState,
          level: newLevel,
          mappings: autoMappings, // Replace, don't merge
        };
      }
    } else {
      // No evaluator selected, just clear mappings
      setMappings({});
      if (onlineEvaluationDrawerState) {
        onlineEvaluationDrawerState = {
          ...onlineEvaluationDrawerState,
          level: newLevel,
          mappings: {},
        };
      }
    }
  }, [selectedEvaluator, allFields, form]);

  // Precondition handlers
  const addPrecondition = useCallback(() => {
    const current = form.getValues("preconditions");
    form.setValue("preconditions", [
      ...current,
      { field: "output", rule: "contains", value: "" },
    ]);
  }, [form]);

  const removePrecondition = useCallback((index: number) => {
    const current = form.getValues("preconditions");
    form.setValue("preconditions", current.filter((_, i) => i !== index));
  }, [form]);

  const updatePrecondition = useCallback((index: number, field: keyof CheckPrecondition, value: string) => {
    const current = form.getValues("preconditions");
    form.setValue("preconditions",
      current.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    );
  }, [form]);

  const handleSave = useCallback(() => {
    if (!selectedEvaluator || !project?.id || !name.trim()) return;
    if (hasPendingMappings) return;

    const evaluatorConfig = selectedEvaluator.config as {
      evaluatorType?: string;
      settings?: Record<string, unknown>;
    } | null;

    const checkType = evaluatorConfig?.evaluatorType ?? "langevals/basic";
    const settings = evaluatorConfig?.settings ?? {};

    // Convert UIFieldMapping to MappingState format
    const mappingState: MappingState = {
      mapping: {},
      expansions: [],
    };
    for (const [field, mapping] of Object.entries(mappings)) {
      if (mapping.type === "source" && mapping.path.length > 0) {
        const parts = mapping.path;
        mappingState.mapping[field] = {
          source: parts[0] as keyof typeof TRACE_MAPPINGS,
          key: parts[1],
          subkey: parts[2],
        };
      }
    }

    if (monitorId) {
      // Update existing monitor
      updateMutation.mutate({
        id: monitorId,
        projectId: project.id,
        name: name.trim(),
        checkType,
        preconditions,
        settings,
        mappings: mappingState,
        sample,
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
        evaluatorId: selectedEvaluator.id,
        level: level ?? "trace",
        threadIdleTimeout: level === "thread" ? threadIdleTimeout : null,
      });
    } else {
      // Create new monitor
      createMutation.mutate({
        projectId: project.id,
        name: name.trim(),
        checkType,
        preconditions,
        settings,
        mappings: mappingState,
        sample,
        executionMode: EvaluationExecutionMode.ON_MESSAGE,
        evaluatorId: selectedEvaluator.id,
        level: level ?? "trace",
        threadIdleTimeout: level === "thread" ? threadIdleTimeout : null,
      });
    }
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
  const canSave = !!level && !!selectedEvaluator && !!name.trim() && !isLoading && !hasPendingMappings;

  // Run on text
  const runOnText = sample >= 1
    ? "every trace"
    : `${+(sample * 100).toFixed(2)}% of traces`;

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && handleClose()}
      size="lg"
    >
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <Heading size="md">
            {monitorId ? "Edit Online Evaluation" : "New Online Evaluation"}
          </Heading>
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
                    description="Evaluate all traces in a conversation thread together"
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
                  <Text lineHeight="1.5">
                    Select an evaluator to run on incoming traces
                    {selectedEvaluator && (
                      <><br />
                        <Text
                          as="span"
                          color="blue.500"
                          cursor="pointer"
                          textDecoration="underline"
                          _hover={{ color: "blue.600" }}
                          onClick={() => {
                            setSelectedEvaluator(null);
                            form.setValue("name", "");
                            setMappings({});
                            setHasUnsavedChanges(true);
                          }}
                        >
                          (Remove Selection)
                        </Text>
                      </>
                    )}
                  </Text>
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
                    <Alert.Root status="warning">
                      <Alert.Indicator>
                        <AlertTriangle size={16} />
                      </Alert.Indicator>
                      <Box flex="1">
                        <Alert.Title>
                          {pendingFields.length > 0
                            ? `${pendingFields.length} field${pendingFields.length > 1 ? "s" : ""} need${pendingFields.length === 1 ? "s" : ""} mapping`
                            : "At least one field needs mapping"}
                        </Alert.Title>
                        <Alert.Description>
                          Configure how evaluator inputs map to trace data.
                        </Alert.Description>
                      </Box>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={openEvaluatorEditorForMappings}
                      >
                        Configure
                      </Button>
                    </Alert.Root>
                  )}
                </VStack>
              </HorizontalFormControl>
            )}

            {/* Name - only show after evaluator is selected */}
            {level && selectedEvaluator && (
              <HorizontalFormControl
                label="Name"
                helper="A descriptive name for this online evaluation"
              >
                <Input
                  {...form.register("name")}
                  placeholder="Enter evaluation name"
                />
              </HorizontalFormControl>
            )}

            {/* Preconditions - only show after evaluator is selected */}
            {level && selectedEvaluator && (
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
                <VStack align="start" gap={3}>
                  {preconditions.map((precondition, index) => (
                    <Box
                      key={index}
                      borderLeft="4px solid"
                      borderLeftColor="blue.400"
                      width="full"
                    >
                      <VStack
                        padding={3}
                        width="full"
                        align="start"
                        position="relative"
                      >
                        <Button
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
                              {Object.entries(fieldOptions).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </NativeSelect.Field>
                            <NativeSelect.Indicator />
                          </NativeSelect.Root>

                          <NativeSelect.Root minWidth="fit-content">
                            <NativeSelect.Field
                              value={precondition.rule}
                              onChange={(e) => updatePrecondition(index, "rule", e.target.value)}
                            >
                              {Object.entries(ruleOptions).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </NativeSelect.Field>
                            <NativeSelect.Indicator />
                          </NativeSelect.Root>
                        </HStack>
                        <HStack width="full">
                          {precondition.rule.includes("regex") && (
                            <Text fontSize="16px">{"/"}</Text>
                          )}
                          <Input
                            value={precondition.value}
                            onChange={(e) => updatePrecondition(index, "value", e.target.value)}
                            placeholder={
                              precondition.rule.includes("regex") ? "regex" : "text"
                            }
                          />
                          {precondition.rule.includes("regex") && (
                            <Text fontSize="16px">{"/gi"}</Text>
                          )}
                        </HStack>
                      </VStack>
                    </Box>
                  ))}
                  <Text color="gray.500" fontStyle="italic">
                    This evaluation will run on {runOnText}
                    {preconditions.length > 0 && " matching the preconditions"}
                  </Text>
                  <Button variant="outline" onClick={addPrecondition}>
                    Add Precondition
                  </Button>
                </VStack>
              </HorizontalFormControl>
            )}

            {/* Sampling Rate - only show after evaluator is selected */}
            {level && selectedEvaluator && (
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
            )}

            {/* Thread Idle Timeout - only show for thread level */}
            {level === "thread" && selectedEvaluator && (
              <HorizontalFormControl
                label={
                  <HStack>
                    Conversation Idle Time
                    <Tooltip content="Wait for the conversation to be idle (no new messages) before running the evaluation. This prevents re-evaluating on every single message in a conversation.">
                      <HelpCircle size={14} />
                    </Tooltip>
                  </HStack>
                }
                helper="How long to wait after the last message before evaluating the thread"
              >
                <NativeSelect.Root width="250px">
                  <NativeSelect.Field
                    value={threadIdleTimeout === null ? "" : String(threadIdleTimeout)}
                    onChange={(e) => {
                      const val = e.target.value;
                      form.setValue("threadIdleTimeout", val === "" ? null : parseInt(val, 10));
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
              </HorizontalFormControl>
            )}
          </VStack>
        </Drawer.Body>
        <Drawer.Footer
          borderTopWidth="1px"
          borderColor="border"
          paddingX={4}
          paddingY={3}
        >
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
