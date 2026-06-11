import {
  Box,
  Button,
  Field,
  HStack,
  IconButton,
  Input,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { LuArrowLeft, LuPlus, LuX } from "react-icons/lu";

import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { getFlowCallbacks, useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { CodeEditor } from "~/optimization_studio/components/code/CodeEditorModal";
import {
  type CodeEvaluatorConfig,
  DEFAULT_CODE_EVALUATOR_CONFIG,
} from "~/server/evaluators/codeEvaluator";
import { api } from "~/utils/api";
import { isHandledByGlobalHandler } from "~/utils/trpcError";

const FIELD_TYPES = ["str", "float", "bool", "list[str]", "dict"] as const;

type EditableField = { identifier: string; type: string };

export type CodeEvaluatorEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  /** Called with the created evaluator; flow callbacks take precedence. */
  onSave?: (evaluator: { id: string; name: string }) => void;
};

/**
 * Creates a custom CODE evaluator: a Python code block with its inputs and
 * outputs, exactly like the studio code component, stored on the evaluator
 * itself (no workflow record) and edited right here in the drawer.
 */
export function CodeEvaluatorEditorDrawer(
  props: CodeEvaluatorEditorDrawerProps,
) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const utils = api.useContext();
  const isOpen = props.open !== false && props.open !== undefined;

  const [name, setName] = useState("");
  const [code, setCode] = useState(DEFAULT_CODE_EVALUATOR_CONFIG.code);
  const [inputs, setInputs] = useState<EditableField[]>(
    DEFAULT_CODE_EVALUATOR_CONFIG.inputs.map((f) => ({ ...f })),
  );
  const [outputs, setOutputs] = useState<EditableField[]>(
    DEFAULT_CODE_EVALUATOR_CONFIG.outputs.map((f) => ({ ...f })),
  );

  const createMutation = api.evaluators.create.useMutation({
    onSuccess: (evaluator) => {
      void utils.evaluators.getAll.invalidate({
        projectId: project?.id ?? "",
      });
      toaster.create({
        title: "Code evaluator created",
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
    },
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

  const validFields = (fields: EditableField[]) =>
    fields.filter((f) => f.identifier.trim() !== "");

  const handleSave = () => {
    if (!project?.id || !name.trim()) return;
    const config: CodeEvaluatorConfig = {
      code,
      inputs: validFields(inputs),
      outputs: validFields(outputs),
    };
    createMutation.mutate({
      projectId: project.id,
      name: name.trim(),
      type: "code",
      config,
    });
  };

  const canSave =
    !!name.trim() &&
    code.trim() !== "" &&
    validFields(inputs).length > 0 &&
    validFields(outputs).length > 0 &&
    !createMutation.isPending;

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
              New Code Evaluator
            </Text>
          </HStack>
        </Drawer.Header>
        <Drawer.Body display="flex" flexDirection="column" gap={4}>
          <Field.Root required>
            <Field.Label>Name</Field.Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My code evaluator"
              data-testid="code-evaluator-name"
            />
          </Field.Root>

          <Field.Root>
            <Field.Label>Python Code</Field.Label>
            <Field.HelperText margin={0}>
              Define a Python class with a `__call__` method that takes the
              inputs and returns the outputs (passed, score, label or details).
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
                code={code}
                setCode={setCode}
                onClose={() => undefined}
                language="python"
                technologies={["python"]}
                inputs={validFields(inputs)}
                outputs={validFields(outputs)}
              />
            </Box>
          </Field.Root>

          <FieldListEditor
            label="Inputs"
            fields={inputs}
            setFields={setInputs}
            testIdPrefix="code-evaluator-input"
          />
          <FieldListEditor
            label="Outputs"
            fields={outputs}
            setFields={setOutputs}
            testIdPrefix="code-evaluator-output"
          />
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <Button
            colorPalette="blue"
            onClick={handleSave}
            disabled={!canSave}
            loading={createMutation.isPending}
            data-testid="save-code-evaluator"
          >
            Create evaluator
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
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
