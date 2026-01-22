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
import type { EvaluatorMappingsConfig } from "../evaluators/EvaluatorEditorDrawer";
import { HorizontalFormControl } from "../HorizontalFormControl";
import { SmallLabel } from "../SmallLabel";
import { Tooltip } from "../ui/tooltip";
import { EvaluatorSelectionBox } from "./EvaluatorSelectionBox";
import { StepRadio } from "./wizard/components/StepButton";
import { LuListTree } from "react-icons/lu";

export type EvaluationLevel = "trace" | "thread";

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
 * Auto-infer mappings for standard fields.
 */
function autoInferMappings(
  requiredFields: string[],
  level: EvaluationLevel
): Record<string, UIFieldMapping> {
  const mappings: Record<string, UIFieldMapping> = {};
  const sourceId = level === "trace" ? "trace" : "thread";

  for (const field of requiredFields) {
    const autoMapping = AUTO_INFER_MAPPINGS[field];
    if (autoMapping && level === "trace") {
      mappings[field] = {
        type: "source",
        sourceId,
        path: [autoMapping],
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
  level: EvaluationLevel;
  name: string;
  selectedEvaluator: Evaluator | null;
  sample: number;
  mappings: Record<string, UIFieldMapping>;
  preconditions: CheckPrecondition[];
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

  // Form state - initialize from persisted state if available
  const [level, setLevel] = useState<EvaluationLevel>(
    () => onlineEvaluationDrawerState?.level ?? "trace"
  );
  const [name, setName] = useState(
    () => onlineEvaluationDrawerState?.name ?? ""
  );
  const [selectedEvaluator, setSelectedEvaluator] = useState<Evaluator | null>(
    () => onlineEvaluationDrawerState?.selectedEvaluator ?? null
  );
  const [sample, setSample] = useState(
    () => onlineEvaluationDrawerState?.sample ?? 1.0
  );
  const [mappings, setMappings] = useState<Record<string, UIFieldMapping>>(
    () => onlineEvaluationDrawerState?.mappings ?? {}
  );
  const [preconditions, setPreconditions] = useState<CheckPrecondition[]>(
    () => onlineEvaluationDrawerState?.preconditions ?? []
  );

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

  // Create mutation
  const createMutation = api.monitors.create.useMutation({
    onSuccess: () => {
      void utils.monitors.getAllForProject.invalidate({
        projectId: project?.id ?? "",
      });
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
      onSave?.();
      onClose();
    },
  });

  // Get evaluator type info for display
  const evaluatorType = selectedEvaluator
    ? ((selectedEvaluator.config as { evaluatorType?: string } | null)
      ?.evaluatorType as EvaluatorTypes | undefined)
    : undefined;

  // Compute required fields and pending mappings
  const requiredFields = useMemo(
    () => getRequiredFields(evaluatorType),
    [evaluatorType]
  );
  const pendingFields = useMemo(
    () => getPendingFields(requiredFields, mappings),
    [requiredFields, mappings]
  );
  const hasPendingMappings = pendingFields.length > 0 && selectedEvaluator !== null;

  // Get available sources based on level
  const availableSources = useMemo(
    () => level === "trace" ? getTraceAvailableSources() : getThreadAvailableSources(),
    [level]
  );

  // Track previous open state to reset form when drawer opens fresh (no persisted state)
  // This effect must run BEFORE the persist effect to check the state before it's updated
  const prevIsOpenRef = useRef(isOpen);
  useEffect(() => {
    // If drawer is opening (was closed, now open) and there's no persisted state, reset form
    if (!prevIsOpenRef.current && isOpen && !onlineEvaluationDrawerState) {
      setLevel("trace");
      setName("");
      setSelectedEvaluator(null);
      setSample(1.0);
      setMappings({});
      setPreconditions([]);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen]);

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
      };
    }
  }, [isOpen, level, name, selectedEvaluator, sample, mappings, preconditions]);

  // Clear persisted state when drawer truly closes (via close button, not navigation)
  const handleClose = useCallback(() => {
    onlineEvaluationDrawerState = null;
    onClose();
  }, [onClose]);

  // Load existing monitor data
  useEffect(() => {
    if (monitorQuery.data && monitorId) {
      setName(monitorQuery.data.name);
      setSample(monitorQuery.data.sample);
      setPreconditions((monitorQuery.data.preconditions as CheckPrecondition[]) ?? []);
      // Load existing mappings
      const existingMappings = monitorQuery.data.mappings as MappingState | null;
      if (existingMappings?.mapping) {
        const uiMappings: Record<string, UIFieldMapping> = {};
        for (const [field, mapping] of Object.entries(existingMappings.mapping)) {
          if (mapping.source) {
            const pathParts: string[] = [mapping.source as string];
            if (mapping.key) pathParts.push(mapping.key);
            if (mapping.subkey) pathParts.push(mapping.subkey);
            uiMappings[field] = {
              type: "source",
              sourceId: level === "trace" ? "trace" : "thread",
              path: pathParts,
            };
          }
        }
        setMappings(uiMappings);
      }
    }
  }, [monitorQuery.data, monitorId, level]);

  // Load linked evaluator
  useEffect(() => {
    if (evaluatorQuery.data) {
      setSelectedEvaluator(evaluatorQuery.data);
    }
  }, [evaluatorQuery.data]);

  // Handle mapping change from evaluator editor
  const handleMappingChange = useCallback(
    (identifier: string, mapping: UIFieldMapping | undefined) => {
      setMappings((prev) => {
        if (mapping) {
          return { ...prev, [identifier]: mapping };
        } else {
          const { [identifier]: _, ...rest } = prev;
          return rest;
        }
      });
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
    setFlowCallbacks("evaluatorList", {
      onSelect: (evaluator: Evaluator) => {
        const newName = name || evaluator.name;
        setSelectedEvaluator(evaluator);
        if (!name) {
          setName(newName);
        }

        // Get evaluator type and required fields
        const evalType = (evaluator.config as { evaluatorType?: string } | null)
          ?.evaluatorType as EvaluatorTypes | undefined;
        const fields = getRequiredFields(evalType);
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
        };
      },
    });

    const mappingsConfig: EvaluatorMappingsConfig = {
      availableSources,
      initialMappings: mappings,
      onMappingChange: handleMappingChange,
    };

    // Open the evaluator editor directly
    // The editor's back button will go to the evaluator list (via goBack)
    openDrawer("evaluatorEditor", {
      evaluatorId: selectedEvaluator.id,
      mappingsConfig,
    });
  }, [selectedEvaluator, name, level, sample, preconditions, availableSources, mappings, handleMappingChange, openDrawer]);

  const handleSelectEvaluator = useCallback(() => {
    // Set flow callback for evaluator selection
    setFlowCallbacks("evaluatorList", {
      onSelect: (evaluator: Evaluator) => {
        const newName = name || evaluator.name;
        setSelectedEvaluator(evaluator);

        // Default name to evaluator name if not set
        if (!name) {
          setName(newName);
        }

        // Get evaluator type and required fields
        const evalType = (evaluator.config as { evaluatorType?: string } | null)
          ?.evaluatorType as EvaluatorTypes | undefined;
        const fields = getRequiredFields(evalType);

        // Auto-infer mappings for trace level
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
        };

        // Always open the evaluator editor so user can see and configure settings
        // This gives users a chance to review/edit the evaluator settings and mappings
        // Use replace: true so Cancel goes back to onlineEvaluation, not evaluatorList
        setTimeout(() => {
          const mappingsConfig: EvaluatorMappingsConfig = {
            availableSources: level === "trace" ? getTraceAvailableSources() : getThreadAvailableSources(),
            initialMappings: autoMappings,
            onMappingChange: (identifier, mapping) => {
              setMappings((prev) => {
                if (mapping) {
                  return { ...prev, [identifier]: mapping };
                } else {
                  const { [identifier]: _, ...rest } = prev;
                  return rest;
                }
              });
            },
          };

          openDrawer("evaluatorEditor", {
            evaluatorId: evaluator.id,
            mappingsConfig,
          }, { replaceCurrentInStack: true });
        }, 100);
      },
    });
    openDrawer("evaluatorList", {});
  }, [name, level, sample, preconditions, openDrawer]);

  const handleLevelChange = useCallback((details: { value: string | null }) => {
    if (!details.value) return;
    const newLevel = details.value as EvaluationLevel;
    setLevel(newLevel);

    // Re-infer mappings for new level
    if (selectedEvaluator) {
      const autoMappings = autoInferMappings(requiredFields, newLevel);
      setMappings(autoMappings);

      // For thread level, always open the editor
      // Compute sources inline with the NEW level value (not from useMemo which uses old level)
      if (newLevel === "thread") {
        setTimeout(() => {
          // We know newLevel is "thread" here, so use thread sources
          const newAvailableSources = getThreadAvailableSources();

          const mappingsConfig: EvaluatorMappingsConfig = {
            availableSources: newAvailableSources,
            initialMappings: autoMappings,
            onMappingChange: handleMappingChange,
          };

          openDrawer("evaluatorEditor", {
            evaluatorId: selectedEvaluator.id,
            mappingsConfig,
          });
        }, 100);
      }
    }
  }, [selectedEvaluator, requiredFields, handleMappingChange, openDrawer]);

  // Precondition handlers
  const addPrecondition = useCallback(() => {
    setPreconditions((prev) => [
      ...prev,
      { field: "output", rule: "contains", value: "" },
    ]);
  }, []);

  const removePrecondition = useCallback((index: number) => {
    setPreconditions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updatePrecondition = useCallback((index: number, field: keyof CheckPrecondition, value: string) => {
    setPreconditions((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    );
  }, []);

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
  ]);

  const isLoading = createMutation.isPending || updateMutation.isPending;
  const canSave = !!selectedEvaluator && !!name.trim() && !isLoading && !hasPendingMappings;

  // Run on text
  const runOnText = sample >= 1
    ? "every message"
    : `${+(sample * 100).toFixed(2)}% of messages`;

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
              helper="Select the level at which to evaluate incoming data"
              align="start"
              labelProps={{ paddingLeft: 0 }}
            >
              <RadioCard.Root
                variant="outline"
                colorPalette="orange"
                value={level}
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

            {/* Evaluator Selection */}
            <HorizontalFormControl
              label="Evaluator"
              helper="Select an evaluator to run on incoming traces"
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
                        {pendingFields.length} field{pendingFields.length > 1 ? "s" : ""} need{pendingFields.length === 1 ? "s" : ""} mapping
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

            {/* Name */}
            <HorizontalFormControl
              label="Name"
              helper="A descriptive name for this online evaluation"
            >
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter evaluation name"
              />
            </HorizontalFormControl>

            {/* Preconditions */}
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

            {/* Sampling Rate */}
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
                    onChange={(e) => setSample(parseFloat(e.target.value) || 1)}
                  />
                </HStack>
                <Text color="gray.500" fontStyle="italic">
                  This evaluation will run on {runOnText}
                  {preconditions.length > 0 && " matching the preconditions"}
                </Text>
              </VStack>
            </HorizontalFormControl>
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
              {monitorId ? "Save Changes" : "Create"}
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
