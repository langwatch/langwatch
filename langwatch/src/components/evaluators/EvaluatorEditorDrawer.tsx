import {
  Button,
  Field,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { useState, useCallback, useEffect } from "react";

import { Drawer } from "~/components/ui/drawer";
import { useDrawer, getComplexProps, useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import {
  AVAILABLE_EVALUATORS,
  type EvaluatorTypes,
} from "~/server/evaluations/evaluators.generated";

export type EvaluatorEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (evaluator: { id: string; name: string }) => void;
  onBack?: () => void;
  /** Evaluator type (e.g., "langevals/exact_match") */
  evaluatorType?: string;
  /** If provided, loads an existing evaluator for editing */
  evaluatorId?: string;
};

/**
 * Drawer for creating/editing a built-in evaluator.
 * Shows a name input and settings based on the evaluator type's schema.
 */
export function EvaluatorEditorDrawer(props: EvaluatorEditorDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, openDrawer } = useDrawer();
  const complexProps = getComplexProps();
  const drawerParams = useDrawerParams();
  const utils = api.useContext();

  const onClose = props.onClose ?? closeDrawer;
  const onSave =
    props.onSave ??
    (complexProps.onSave as EvaluatorEditorDrawerProps["onSave"]);
  const onBack =
    props.onBack ?? (() => openDrawer("evaluatorTypeSelector"));
  // Get evaluatorType from props, URL params, or complexProps (in that order)
  const evaluatorType =
    props.evaluatorType ??
    drawerParams.evaluatorType ??
    (complexProps.evaluatorType as string | undefined);
  const evaluatorId =
    props.evaluatorId ?? drawerParams.evaluatorId ?? (complexProps.evaluatorId as string | undefined);
  const isOpen = props.open !== false && props.open !== undefined;

  // Form state
  const [name, setName] = useState("");
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Get evaluator definition
  const evaluatorDef = evaluatorType
    ? AVAILABLE_EVALUATORS[evaluatorType as EvaluatorTypes]
    : undefined;

  // Initialize default settings from evaluator definition
  useEffect(() => {
    if (evaluatorDef?.settings && !evaluatorId) {
      const defaults: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(evaluatorDef.settings)) {
        defaults[key] = (value as { default: unknown }).default;
      }
      setSettings(defaults);
      // Set default name based on evaluator name
      setName(evaluatorDef.name);
    }
  }, [evaluatorDef, evaluatorId]);

  // Load existing evaluator if editing
  const evaluatorQuery = api.evaluators.getById.useQuery(
    { id: evaluatorId ?? "", projectId: project?.id ?? "" },
    { enabled: !!evaluatorId && !!project?.id && isOpen },
  );

  // Initialize form with evaluator data
  useEffect(() => {
    if (evaluatorQuery.data) {
      setName(evaluatorQuery.data.name);
      const config = evaluatorQuery.data.config as {
        settings?: Record<string, unknown>;
      } | null;
      if (config?.settings) {
        setSettings(config.settings);
      }
      setHasUnsavedChanges(false);
    }
  }, [evaluatorQuery.data]);

  // Mutations
  const createMutation = api.evaluators.create.useMutation({
    onSuccess: (evaluator) => {
      void utils.evaluators.getAll.invalidate({ projectId: project?.id ?? "" });
      onSave?.({ id: evaluator.id, name: evaluator.name });
      onClose();
    },
  });

  const updateMutation = api.evaluators.update.useMutation({
    onSuccess: (evaluator) => {
      void utils.evaluators.getAll.invalidate({ projectId: project?.id ?? "" });
      void utils.evaluators.getById.invalidate({
        id: evaluator.id,
        projectId: project?.id ?? "",
      });
      onSave?.({ id: evaluator.id, name: evaluator.name });
      onClose();
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isValid = name.trim().length > 0;

  const handleSave = useCallback(() => {
    if (!project?.id || !isValid || !evaluatorType) return;

    const config = {
      evaluatorType,
      settings,
    };

    if (evaluatorId) {
      updateMutation.mutate({
        id: evaluatorId,
        projectId: project.id,
        name: name.trim(),
        config,
      });
    } else {
      createMutation.mutate({
        projectId: project.id,
        name: name.trim(),
        type: "evaluator",
        config,
      });
    }
  }, [
    project?.id,
    evaluatorId,
    evaluatorType,
    name,
    settings,
    isValid,
    createMutation,
    updateMutation,
  ]);

  const handleNameChange = (value: string) => {
    setName(value);
    setHasUnsavedChanges(true);
  };

  const handleClose = () => {
    if (hasUnsavedChanges) {
      if (
        !window.confirm(
          "You have unsaved changes. Are you sure you want to close?",
        )
      ) {
        return;
      }
    }
    onClose();
  };

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && handleClose()}
      size="lg"
    >
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <HStack gap={2}>
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              padding={1}
              minWidth="auto"
              data-testid="back-button"
            >
              <ArrowLeft size={20} />
            </Button>
            <Text fontSize="xl" fontWeight="semibold">
              {evaluatorDef?.name ?? "Configure Evaluator"}
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body
          display="flex"
          flexDirection="column"
          overflow="hidden"
          padding={0}
        >
          {evaluatorId && evaluatorQuery.isLoading ? (
            <HStack justify="center" paddingY={8}>
              <Spinner size="md" />
            </HStack>
          ) : (
            <VStack
              gap={4}
              align="stretch"
              flex={1}
              paddingX={6}
              paddingY={4}
              overflowY="auto"
            >
              {/* Description */}
              {evaluatorDef?.description && (
                <Text fontSize="sm" color="gray.600">
                  {evaluatorDef.description}
                </Text>
              )}

              {/* Name field */}
              <Field.Root required>
                <Field.Label>Evaluator Name</Field.Label>
                <Input
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Enter evaluator name"
                  data-testid="evaluator-name-input"
                />
              </Field.Root>

              {/* Settings fields */}
              {evaluatorDef?.settings &&
                Object.entries(evaluatorDef.settings).map(([key, value]) => {
                  const settingDef = value as {
                    description?: string;
                    default: unknown;
                  };
                  const currentValue = settings[key] ?? settingDef.default;

                  return (
                    <SettingField
                      key={key}
                      fieldKey={key}
                      description={settingDef.description}
                      value={currentValue}
                      onChange={(newValue) => {
                        setSettings((prev) => ({ ...prev, [key]: newValue }));
                        setHasUnsavedChanges(true);
                      }}
                    />
                  );
                })}
            </VStack>
          )}
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="gray.200">
          <HStack gap={3}>
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              colorScheme="green"
              onClick={handleSave}
              disabled={!isValid || isSaving}
              loading={isSaving}
              data-testid="save-evaluator-button"
            >
              {evaluatorId ? "Save Changes" : "Create Evaluator"}
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

// ============================================================================
// Setting Field Component
// ============================================================================

type SettingFieldProps = {
  fieldKey: string;
  description?: string;
  value: unknown;
  onChange: (value: unknown) => void;
};

/**
 * Renders a form field for an evaluator setting based on its type.
 */
function SettingField({
  fieldKey,
  description,
  value,
  onChange,
}: SettingFieldProps) {
  const label = fieldKey
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());

  // Determine field type based on value
  if (typeof value === "boolean") {
    return (
      <Field.Root>
        <HStack justify="space-between" width="full">
          <VStack align="start" gap={0}>
            <Field.Label marginBottom={0}>{label}</Field.Label>
            {description && (
              <Text fontSize="xs" color="gray.500">
                {description}
              </Text>
            )}
          </VStack>
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => onChange(e.target.checked)}
          />
        </HStack>
      </Field.Root>
    );
  }

  if (typeof value === "number") {
    return (
      <Field.Root>
        <Field.Label>{label}</Field.Label>
        {description && (
          <Text fontSize="xs" color="gray.500" marginBottom={1}>
            {description}
          </Text>
        )}
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
      </Field.Root>
    );
  }

  // Default to text input
  return (
    <Field.Root>
      <Field.Label>{label}</Field.Label>
      {description && (
        <Text fontSize="xs" color="gray.500" marginBottom={1}>
          {description}
        </Text>
      )}
      <Input
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field.Root>
  );
}
