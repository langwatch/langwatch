import {
  getComplexProps,
  getFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "@langwatch/browser-host/drawer";
import { showErrorToast } from "@langwatch/browser-host/errors";
import { toaster } from "@langwatch/browser-host/toaster";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { Drawer } from "@langwatch/design-system/drawer";
import { Alert, HStack, Spinner, VStack } from "@langwatch/design-system/primitives";
import { type Variable, VariablesSection } from "@langwatch/design-system/variable-mapping";
import { evaluatorClient } from "@langwatch/evaluator-client";
import {
  type CodeEvaluatorConfig,
  codeEvaluatorOutputFields,
  defaultCodeEvaluatorConfig,
} from "@langwatch/evaluator-contract";
import { type FieldMapping as UIFieldMapping } from "@langwatch/workflow-contract";
import { useEffect, useRef, useState } from "react";

import { codeEvaluatorDisabledReason } from "../../../model/code-evaluator-disabled-reason.ts";
import { rewriteCodeSignature } from "../../../model/workflow/code-signature.ts";
import {
  CodeEvaluatorEditor,
  type CodeEvaluatorField,
  validCodeEvaluatorFields,
} from "../../blocks/code-evaluator-editor.tsx";
import { renderSourceTypeIcon } from "../../elements/workflow/workflow-icons.tsx";
import { EvaluatorCodeEditor } from "./evaluator-code-editor.tsx";
import {
  type EvaluatorGateConfig,
  EvaluatorGateSection,
  type EvaluatorMappingsConfig,
} from "./evaluator-editor-shared.tsx";

type EditableField = CodeEvaluatorField;

/** What a caller hands evaluator's code evaluator editor drawer. */
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
  gate?: EvaluatorGateConfig;
  onRequiredChange?: (required: boolean) => void;
  onRemove?: () => void;
};

function seedFromSavedEvaluator(
  data: { name: string; config: unknown },
  setters: {
    setName: (name: string) => void;
    setCode: (code: string) => void;
    setInputs: (inputs: EditableField[]) => void;
  },
) {
  const config = data.config as Partial<CodeEvaluatorConfig> | null;
  setters.setName(data.name);
  if (config?.code) setters.setCode(config.code);
  if (config?.inputs?.length) setters.setInputs(config.inputs.map((f) => ({ ...f })));
}

function withMapping(
  prev: Record<string, UIFieldMapping>,
  identifier: string,
  mapping: UIFieldMapping | undefined,
): Record<string, UIFieldMapping> {
  const next = { ...prev };
  if (mapping) next[identifier] = mapping;
  else delete next[identifier];
  return next;
}

/** Flow callbacks take precedence over the prop; with none, the drawer closes. */
function handOffSaved({
  evaluator,
  onSave: propOnSave,
  closeDrawer,
}: {
  evaluator: { id: string; name: string };
  onSave: CodeEvaluatorEditorDrawerProps["onSave"];
  closeDrawer: () => void;
}) {
  const onSave =
    getFlowCallbacks("codeEvaluatorEditor")?.onSave ??
    getFlowCallbacks("evaluatorEditor")?.onSave ??
    propOnSave;
  if (!onSave) {
    closeDrawer();
    return;
  }
  (onSave as (evaluator: { id: string; name: string }) => void)({
    id: evaluator.id,
    name: evaluator.name,
  });
}

/** What the author still has to add, in words; null once the form is complete. */
function missingMessage({
  name,
  code,
  inputs,
  isEditing,
}: {
  name: string;
  code: string;
  inputs: EditableField[];
  isEditing: boolean;
}) {
  return codeEvaluatorDisabledReason({
    hasName: !!name.trim(),
    hasCode: code.trim() !== "",
    hasInput: validCodeEvaluatorFields(inputs).length > 0,
    isEditing,
  });
}

/** Form state and the create/update mutation behind the drawer; no JSX in here. */
function useCodeEvaluatorForm(props: CodeEvaluatorEditorDrawerProps, onFocusName?: () => void) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();
  const drawerParams = useDrawerParams();
  const complexProps = getComplexProps();
  const utils = evaluatorClient.useUtils();

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

  const evaluatorQuery = evaluatorClient.evaluators.getById.useQuery(
    { id: evaluatorId ?? "", projectId: project?.id ?? "" },
    { enabled: isEditing && !!project?.id && isOpen },
  );

  // Seed the form from the saved evaluator once per id (not on refetch).
  const seededForRef = useRef<string | null>(null);
  useEffect(() => {
    const data = evaluatorQuery.data;
    if (!data || seededForRef.current === data.id) return;
    seededForRef.current = data.id;
    seedFromSavedEvaluator(data, { setName, setCode, setInputs });
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
    setMappings((prev) => withMapping(prev, identifier, mapping));
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
    handOffSaved({ evaluator, onSave: props.onSave, closeDrawer });
  };

  const createMutation = evaluatorClient.evaluators.create.useMutation({
    onSuccess: finishSave,
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't create code evaluator",
      }),
  });

  const updateMutation = evaluatorClient.evaluators.update.useMutation({
    onSuccess: finishSave,
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't save code evaluator" }),
  });

  const [attempted, setAttempted] = useState(false);
  const missing = missingMessage({ name, code, inputs, isEditing });
  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleSave = () => {
    if (isPending || !project?.id) return;
    if (missing) {
      setAttempted(true);
      if (!name.trim()) onFocusName?.();
      return;
    }
    const config: CodeEvaluatorConfig = {
      code,
      inputs: validCodeEvaluatorFields(inputs),
      outputs: codeEvaluatorOutputFields.map((field) => ({ ...field })),
    };
    const trimmed = name.trim();
    if (!evaluatorId) {
      createMutation.mutate({ projectId: project.id, name: trimmed, type: "code", config });
      return;
    }
    updateMutation.mutate({
      id: evaluatorId,
      projectId: project.id,
      type: "code",
      name: trimmed,
      config,
    });
  };

  const isLoadingEvaluator = isEditing && evaluatorQuery.isLoading;

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
    missing: attempted ? missing : null,
    isPending,
  };
}

type CodeEvaluatorFormState = ReturnType<typeof useCodeEvaluatorForm>;

/**
 * Creates or edits a custom CODE evaluator: a Python code block with its inputs and outputs,
 * exactly like the studio code component, stored on the evaluator itself (no workflow record).
 */
export function CodeEvaluatorEditorDrawer(props: CodeEvaluatorEditorDrawerProps) {
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const contentRef = useRef<HTMLDivElement>(null);
  const form = useCodeEvaluatorForm(props, () =>
    contentRef.current?.querySelector<HTMLInputElement>("input")?.focus(),
  );
  const isOpen = props.open !== false && props.open !== undefined;

  return (
    <Drawer
      open={isOpen}
      onClose={() => {
        props.onClose?.();
        closeDrawer();
      }}
      onBack={canGoBack ? goBack : void 0}
      backButtonTestId="back-button"
      size="lg"
      title={form.isEditing ? "Edit Code Evaluator" : "New Code Evaluator"}
      contentRef={contentRef}
      footer={{
        ...(props.onRemove
          ? {
              destructiveAction: {
                label: "Remove evaluator",
                onClick: props.onRemove,
                "data-testid": "evaluator-remove-button",
              },
            }
          : {}),
        primaryAction: {
          label: form.isEditing ? "Save changes" : "Create evaluator",
          onClick: form.handleSave,
          loading: form.isPending,
          "data-testid": "save-code-evaluator",
          ...(form.isLoadingEvaluator ? { disabledReason: "The evaluator is still loading." } : {}),
        },
      }}
    >
      <VStack gap={4} align="stretch">
        {form.missing && (
          <Alert.Root status="error" role="alert" data-testid="code-evaluator-disabled-reason">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{form.missing}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
        )}
        {form.isLoadingEvaluator ? (
          <HStack justify="center" paddingY={8}>
            <Spinner size="md" />
          </HStack>
        ) : (
          <CodeEvaluatorFormFields form={form} />
        )}
        {props.gate && (
          <EvaluatorGateSection
            gate={props.gate}
            required={props.gate.required}
            onRequiredChange={props.onRequiredChange}
          />
        )}
      </VStack>
    </Drawer>
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
        <EvaluatorCodeEditor
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
                renderSourceIcon={renderSourceTypeIcon}
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
