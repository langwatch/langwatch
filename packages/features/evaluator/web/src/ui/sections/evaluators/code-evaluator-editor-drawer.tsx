import { Box, Button, HStack, Spinner, Text } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { LuArrowLeft } from "react-icons/lu";

import { Drawer } from "@langwatch/workflow-web/components/ui/drawer";
import { toaster } from "@langwatch/workflow-web/studio-host/toaster";
import {
  type FieldMapping as UIFieldMapping,
  type Variable,
  VariablesSection,
} from "@langwatch/prompt-web/surfaces/variables";
import { showErrorToast } from "@langwatch/workflow-web/studio-host/errors";
import {
  getComplexProps,
  getFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "@langwatch/ui-drawer";
import { useOrganizationTeamProject } from "@langwatch/workflow-web/studio-host/use-organization-team-project";
import { CodeEditor } from "@langwatch/workflow-web/optimization_studio/components/code/workflow-code-editor.transport";
import { rewriteCodeSignature } from "@langwatch/workflow-web";
import {
  type CodeEvaluatorConfig,
  codeEvaluatorOutputFields,
  defaultCodeEvaluatorConfig,
} from "@langwatch/evaluator-contract";
import { api } from "@langwatch/workflow-web/studio-host/api";

import {
  CodeEvaluatorEditor,
  codeEvaluatorDisabledReason,
  type CodeEvaluatorField,
  validCodeEvaluatorFields,
} from "@langwatch/evaluator-web";
import type { EvaluatorMappingsConfig } from "./evaluator-editor-shared";

type EditableField = CodeEvaluatorField;

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
  onMappingChange?: (identifier: string, mapping: UIFieldMapping | undefined) => void;
  /** Called with the saved evaluator; flow callbacks take precedence. */
  onSave?: (evaluator: { id: string; name: string }) => void;
};

/** Form state and the create/update mutation behind the drawer; no JSX in here. */
function useCodeEvaluatorForm(props: CodeEvaluatorEditorDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();
  const drawerParams = useDrawerParams();
  const complexProps = getComplexProps();
  const utils = api.useUtils();

  const evaluatorId =
    props.evaluatorId ??
    drawerParams.evaluatorId ??
    (complexProps.evaluatorId as string | undefined);
  const isEditing = !!evaluatorId;

  const mappingsConfig =
    props.mappingsConfig ?? (complexProps.mappingsConfig as EvaluatorMappingsConfig | undefined);
  const onMappingChange =
    props.onMappingChange ?? getFlowCallbacks("codeEvaluatorEditor")?.onMappingChange;

  const isOpen = props.open !== false && props.open !== undefined;

  const [name, setName] = useState("");
  const [code, setCode] = useState(defaultCodeEvaluatorConfig.code);
  const [inputs, setInputs] = useState<EditableField[]>(
    defaultCodeEvaluatorConfig.inputs.map((f) => ({ ...f })),
  );
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
    const valid = validCodeEvaluatorFields(next);
    if (valid.length > 0) {
      setCode((current) => rewriteCodeSignature(current, valid));
    }
  };

  const handleMappingChange = (identifier: string, mapping: UIFieldMapping | undefined) => {
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
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't create code evaluator",
      }),
  });

  const updateMutation = api.evaluators.update.useMutation({
    onSuccess: finishSave,
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't save code evaluator" }),
  });

  const handleSave = () => {
    if (!project?.id || !name.trim()) return;
    const config: CodeEvaluatorConfig = {
      code,
      inputs: validCodeEvaluatorFields(inputs),
      outputs: codeEvaluatorOutputFields.map((field) => ({ ...field })),
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
    validCodeEvaluatorFields(inputs).length > 0 &&
    !isPending &&
    !isLoadingEvaluator;

  // Why the button is disabled, so it explains itself instead of being a
  // silent dead button. Suppressed while saving/loading (those are transient
  // and the button shows its own loading state).
  const disabledReason =
    isPending || isLoadingEvaluator
      ? null
      : codeEvaluatorDisabledReason({
          hasName: !!name.trim(),
          hasCode: code.trim() !== "",
          hasInput: validCodeEvaluatorFields(inputs).length > 0,
          isEditing,
        });

  return {
    name,
    setName,
    code,
    setCode,
    inputs,
    setInputs: setInputsAndSyncCode,
    mappings,
    handleMappingChange,
    mappingsConfig,
    showMappings: !!(mappingsConfig && onMappingChange),
    isEditing,
    isLoadingEvaluator,
    handleSave,
    canSave,
    disabledReason,
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
export function CodeEvaluatorEditorDrawer(props: CodeEvaluatorEditorDrawerProps) {
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
        <EditorHeader canGoBack={canGoBack} goBack={goBack} isEditing={form.isEditing} />
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
          <HStack width="full" justify="space-between" gap={3}>
            {form.disabledReason ? (
              <Text fontSize="sm" color="fg.muted" data-testid="code-evaluator-disabled-reason">
                {form.disabledReason}
              </Text>
            ) : (
              <Box />
            )}
            <Button
              colorPalette="blue"
              onClick={form.handleSave}
              disabled={!form.canSave}
              loading={form.isPending}
              data-testid="save-code-evaluator"
            >
              {form.isEditing ? "Save changes" : "Create evaluator"}
            </Button>
          </HStack>
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
  // Read once, so the mapping renderer below closes over a value rather than a
  // property the compiler has to re-check inside the callback.
  const mappingsConfig = form.showMappings ? form.mappingsConfig : void 0;

  return (
    <CodeEvaluatorEditor
      name={form.name}
      code={form.code}
      inputs={form.inputs}
      onNameChange={form.setName}
      onInputsChange={form.setInputs}
      renderCodeEditor={({ code, inputs, outputs }) => (
        <CodeEditor
          code={code}
          setCode={form.setCode}
          onClose={() => void 0}
          language="python"
          technologies={["python"]}
          inputs={inputs}
          outputs={outputs}
        />
      )}
      renderInputMappings={
        mappingsConfig
          ? ({ inputs, onInputsChange }) => (
              <VariablesSection
                title="Inputs"
                variables={inputs.map((field) => ({
                  identifier: field.identifier,
                  type: field.type as Variable["type"],
                }))}
                onChange={(variables) =>
                  onInputsChange(
                    variables.map((variable) => ({
                      identifier: variable.identifier,
                      type: variable.type,
                    })),
                  )
                }
                showMappings
                mappings={form.mappings}
                onMappingChange={form.handleMappingChange}
                availableSources={mappingsConfig.availableSources}
                canAddRemove
              />
            )
          : void 0
      }
    />
  );
}
