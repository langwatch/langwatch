import {
  Box,
  Button,
  Field,
  HStack,
  IconButton,
  Input,
  NativeSelect,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { LuArrowLeft, LuPlus, LuX } from "react-icons/lu";

import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import {
  type FieldMapping as UIFieldMapping,
  type Variable,
  VariablesSection,
} from "~/components/variables";
import {
  getComplexProps,
  getFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { CodeEditor } from "~/optimization_studio/components/code/CodeEditorModal";
import { rewriteCodeSignature } from "~/optimization_studio/utils/codeSignature";
import {
  CODE_EVALUATOR_OUTPUT_FIELDS,
  type CodeEvaluatorConfig,
  DEFAULT_CODE_EVALUATOR_CONFIG,
} from "~/server/evaluators/codeEvaluator";
import { api } from "~/utils/api";
import { isHandledByGlobalHandler } from "~/utils/trpcError";

import type { EvaluatorMappingsConfig } from "./EvaluatorEditorShared";

const FIELD_TYPES = ["str", "float", "bool", "list[str]", "dict"] as const;

type EditableField = { identifier: string; type: string };

export type CodeEvaluatorEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  /** When set, the drawer edits this existing code evaluator instead of creating one. */
  evaluatorId?: string;
  /**
   * Workbench mapping context. When present, the inputs render with their
   * source mapping merged inline (like the prompt drawer); without it, the
   * inputs are a plain identifier + type list.
   */
  mappingsConfig?: EvaluatorMappingsConfig;
  onMappingChange?: (
    identifier: string,
    mapping: UIFieldMapping | undefined,
  ) => void;
  /** Called with the saved evaluator; flow callbacks take precedence. */
  onSave?: (evaluator: { id: string; name: string }) => void;
};

const validFields = (fields: EditableField[]) =>
  fields.filter((f) => f.identifier.trim() !== "");

/** Form state and the create/update mutation behind the drawer; no JSX in here. */
function useCodeEvaluatorForm(props: CodeEvaluatorEditorDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();
  const drawerParams = useDrawerParams();
  const complexProps = getComplexProps();
  const utils = api.useContext();

  const evaluatorId =
    props.evaluatorId ??
    drawerParams.evaluatorId ??
    (complexProps.evaluatorId as string | undefined);
  const isEditing = !!evaluatorId;

  const mappingsConfig =
    props.mappingsConfig ??
    (complexProps.mappingsConfig as EvaluatorMappingsConfig | undefined);
  const onMappingChange =
    props.onMappingChange ??
    getFlowCallbacks("codeEvaluatorEditor")?.onMappingChange;

  const isOpen = props.open !== false && props.open !== undefined;

  const [name, setName] = useState("");
  const [code, setCode] = useState(DEFAULT_CODE_EVALUATOR_CONFIG.code);
  const [inputs, setInputs] = useState<EditableField[]>(
    DEFAULT_CODE_EVALUATOR_CONFIG.inputs.map((f) => ({ ...f })),
  );
  // Outputs are the fixed evaluator contract, not user-editable.
  const outputs: EditableField[] = CODE_EVALUATOR_OUTPUT_FIELDS;
  const [mappings, setMappings] = useState<Record<string, UIFieldMapping>>(
    mappingsConfig?.initialMappings ?? {},
  );

  const evaluatorQuery = api.evaluators.getById.useQuery(
    { id: evaluatorId ?? "", projectId: project?.id ?? "" },
    { enabled: isEditing && !!project?.id && isOpen },
  );

  // Seed the form from the saved evaluator once per id (not on refetch).
  const seededForRef = useRef<string | null>(null);
  useEffect(() => {
    const data = evaluatorQuery.data;
    if (!data || seededForRef.current === data.id) return;
    seededForRef.current = data.id;
    const config = data.config as Partial<CodeEvaluatorConfig> | null;
    setName(data.name);
    if (config?.code) setCode(config.code);
    if (config?.inputs?.length) {
      setInputs(config.inputs.map((f) => ({ ...f })));
    }
  }, [evaluatorQuery.data]);

  // Keep the Python __call__ signature in sync with the declared inputs, the
  // same way the studio code node does, so adding or removing an input field
  // rewrites the entrypoint and the saved evaluator never calls it with an
  // unexpected keyword. Only the signature line changes; the body is kept.
  const setInputsAndSyncCode = (next: EditableField[]) => {
    setInputs(next);
    const valid = validFields(next);
    if (valid.length > 0) {
      setCode((current) => rewriteCodeSignature(current, valid));
    }
  };

  const handleMappingChange = (
    identifier: string,
    mapping: UIFieldMapping | undefined,
  ) => {
    setMappings((prev) => {
      const next = { ...prev };
      if (mapping) {
        next[identifier] = mapping;
      } else {
        delete next[identifier];
      }
      return next;
    });
    onMappingChange?.(identifier, mapping);
  };

  const finishSave = (evaluator: { id: string; name: string }) => {
    void utils.evaluators.getAll.invalidate({ projectId: project?.id ?? "" });
    if (isEditing) {
      void utils.evaluators.getById.invalidate({
        id: evaluator.id,
        projectId: project?.id ?? "",
      });
    }
    toaster.create({
      title: isEditing ? "Code evaluator saved" : "Code evaluator created",
      type: "success",
      meta: { closable: true },
    });
    const onSave =
      getFlowCallbacks("codeEvaluatorEditor")?.onSave ??
      getFlowCallbacks("evaluatorEditor")?.onSave ??
      props.onSave;
    if (onSave) {
      (onSave as (evaluator: { id: string; name: string }) => void)({
        id: evaluator.id,
        name: evaluator.name,
      });
    } else {
      closeDrawer();
    }
  };

  const createMutation = api.evaluators.create.useMutation({
    onSuccess: finishSave,
    onError: (error) => {
      if (isHandledByGlobalHandler(error)) return;
      toaster.create({
        title: "Error creating code evaluator",
        description: error.message,
        type: "error",
        meta: { closable: true },
      });
    },
  });

  const updateMutation = api.evaluators.update.useMutation({
    onSuccess: finishSave,
    onError: (error) => {
      if (isHandledByGlobalHandler(error)) return;
      toaster.create({
        title: "Error saving code evaluator",
        description: error.message,
        type: "error",
        meta: { closable: true },
      });
    },
  });

  const handleSave = () => {
    if (!project?.id || !name.trim()) return;
    const config: CodeEvaluatorConfig = {
      code,
      inputs: validFields(inputs),
      outputs: CODE_EVALUATOR_OUTPUT_FIELDS.map((f) => ({ ...f })),
    };
    if (isEditing) {
      updateMutation.mutate({
        id: evaluatorId,
        projectId: project.id,
        type: "code",
        name: name.trim(),
        config,
      });
    } else {
      createMutation.mutate({
        projectId: project.id,
        name: name.trim(),
        type: "code",
        config,
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const isLoadingEvaluator = isEditing && evaluatorQuery.isLoading;
  const canSave =
    !!name.trim() &&
    code.trim() !== "" &&
    validFields(inputs).length > 0 &&
    !isPending &&
    !isLoadingEvaluator;

  return {
    name,
    setName,
    code,
    setCode,
    inputs,
    setInputs: setInputsAndSyncCode,
    outputs,
    mappings,
    handleMappingChange,
    mappingsConfig,
    showMappings: !!(mappingsConfig && onMappingChange),
    isEditing,
    isLoadingEvaluator,
    handleSave,
    canSave,
    isPending,
  };
}

type CodeEvaluatorFormState = ReturnType<typeof useCodeEvaluatorForm>;

/**
 * Creates or edits a custom CODE evaluator: a Python code block with its inputs
 * and outputs, exactly like the studio code component, stored on the evaluator
 * itself (no workflow record). In the workbench it also maps each input to a
 * source, merged into the inputs list like the prompt drawer.
 */
export function CodeEvaluatorEditorDrawer(
  props: CodeEvaluatorEditorDrawerProps,
) {
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const form = useCodeEvaluatorForm(props);
  const isOpen = props.open !== false && props.open !== undefined;

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => {
        if (!open) {
          props.onClose?.();
          closeDrawer();
        }
      }}
      size="lg"
      closeOnInteractOutside={false}
      modal={false}
    >
      <Drawer.Content bg="bg">
        <Drawer.CloseTrigger />
        <EditorHeader
          canGoBack={canGoBack}
          goBack={goBack}
          isEditing={form.isEditing}
        />
        <Drawer.Body display="flex" flexDirection="column" gap={4}>
          {form.isLoadingEvaluator ? (
            <HStack justify="center" paddingY={8}>
              <Spinner size="md" />
            </HStack>
          ) : (
            <CodeEvaluatorFormFields form={form} />
          )}
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <Button
            colorPalette="blue"
            onClick={form.handleSave}
            disabled={!form.canSave}
            loading={form.isPending}
            data-testid="save-code-evaluator"
          >
            {form.isEditing ? "Save changes" : "Create evaluator"}
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function EditorHeader({
  canGoBack,
  goBack,
  isEditing,
}: {
  canGoBack: boolean;
  goBack: () => void;
  isEditing: boolean;
}) {
  return (
    <Drawer.Header>
      <HStack gap={2}>
        {canGoBack && (
          <Button
            variant="ghost"
            size="sm"
            onClick={goBack}
            padding={1}
            minWidth="auto"
            data-testid="back-button"
          >
            <LuArrowLeft size={20} />
          </Button>
        )}
        <Text fontSize="lg" fontWeight="semibold">
          {isEditing ? "Edit Code Evaluator" : "New Code Evaluator"}
        </Text>
      </HStack>
    </Drawer.Header>
  );
}

function CodeEvaluatorFormFields({ form }: { form: CodeEvaluatorFormState }) {
  return (
    <>
      <Field.Root required>
        <Field.Label>Name</Field.Label>
        <Input
          value={form.name}
          onChange={(e) => form.setName(e.target.value)}
          placeholder="My code evaluator"
          data-testid="code-evaluator-name"
        />
      </Field.Root>

      <Field.Root>
        <Field.Label>Python Code</Field.Label>
        <Field.HelperText margin={0}>
          Define a Python class with a `__call__` method that takes the inputs
          and returns the outputs (passed, score, label or details).
        </Field.HelperText>
        <Box
          width="full"
          height="320px"
          borderWidth="1px"
          borderColor="border"
          borderRadius="md"
          overflow="hidden"
        >
          <CodeEditor
            code={form.code}
            setCode={form.setCode}
            onClose={() => undefined}
            language="python"
            technologies={["python"]}
            inputs={validFields(form.inputs)}
            outputs={validFields(form.outputs)}
          />
        </Box>
      </Field.Root>

      {form.showMappings && form.mappingsConfig ? (
        <VariablesSection
          title="Inputs"
          variables={form.inputs.map((f) => ({
            identifier: f.identifier,
            type: f.type as Variable["type"],
          }))}
          onChange={(vars) =>
            form.setInputs(
              vars.map((v) => ({ identifier: v.identifier, type: v.type })),
            )
          }
          showMappings
          mappings={form.mappings}
          onMappingChange={form.handleMappingChange}
          availableSources={form.mappingsConfig.availableSources}
          canAddRemove
        />
      ) : (
        <FieldListEditor
          label="Inputs"
          fields={form.inputs}
          setFields={form.setInputs}
          testIdPrefix="code-evaluator-input"
        />
      )}
      <OutputContractInfo />
    </>
  );
}

/** Short, human-readable purpose of each fixed evaluator output field. */
const OUTPUT_FIELD_DESCRIPTIONS: Record<string, string> = {
  passed: "Whether the check passed (true or false).",
  score: "A numeric score for the result.",
  label: "A classification label for the result.",
  details: "A human-readable explanation of the result.",
};

/**
 * The evaluator output contract is fixed (passed, score, label, details), just
 * like an evaluator end node. Rather than a dynamic field editor that could
 * declare an output the code never returns, the drawer explains the fields the
 * function may return; whichever the code returns become the result.
 */
function OutputContractInfo() {
  return (
    <VStack align="stretch" gap={2}>
      <Text fontSize="sm" fontWeight="semibold">
        Outputs
      </Text>
      <Text fontSize="xs" color="fg.muted">
        Return a dictionary from your function with any of these fields.
        Whichever you return become the evaluation result.
      </Text>
      <VStack
        align="stretch"
        gap={1.5}
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
        padding={3}
      >
        {CODE_EVALUATOR_OUTPUT_FIELDS.map((field) => (
          <HStack key={field.identifier} gap={2} align="baseline">
            <Text
              fontSize="sm"
              fontFamily="mono"
              fontWeight="medium"
              data-testid={`code-evaluator-output-field-${field.identifier}`}
            >
              {field.identifier}
            </Text>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">
              {field.type}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              {OUTPUT_FIELD_DESCRIPTIONS[field.identifier]}
            </Text>
          </HStack>
        ))}
      </VStack>
    </VStack>
  );
}

function FieldListEditor({
  label,
  fields,
  setFields,
  testIdPrefix,
}: {
  label: string;
  fields: EditableField[];
  setFields: (fields: EditableField[]) => void;
  testIdPrefix: string;
}) {
  return (
    <VStack align="stretch" gap={2}>
      <HStack justify="space-between">
        <Text fontSize="sm" fontWeight="semibold">
          {label}
        </Text>
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            setFields([...fields, { identifier: "", type: "str" }])
          }
          data-testid={`${testIdPrefix}-add`}
        >
          <LuPlus size={14} /> Add
        </Button>
      </HStack>
      {fields.map((field, index) => (
        <HStack key={index} gap={2}>
          <Input
            size="sm"
            value={field.identifier}
            placeholder="identifier"
            onChange={(e) =>
              setFields(
                fields.map((f, i) =>
                  i === index ? { ...f, identifier: e.target.value } : f,
                ),
              )
            }
            data-testid={`${testIdPrefix}-identifier-${index}`}
          />
          <NativeSelect.Root size="sm" width="140px">
            <NativeSelect.Field
              value={field.type}
              onChange={(e) =>
                setFields(
                  fields.map((f, i) =>
                    i === index ? { ...f, type: e.target.value } : f,
                  ),
                )
              }
            >
              {FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={`Remove ${label.toLowerCase()} ${field.identifier}`}
            onClick={() => setFields(fields.filter((_, i) => i !== index))}
            disabled={fields.length <= 1}
          >
            <LuX size={14} />
          </IconButton>
        </HStack>
      ))}
    </VStack>
  );
}
