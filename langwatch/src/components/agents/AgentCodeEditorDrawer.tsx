import {
  Box,
  Button,
  Field,
  Heading,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useEffect, useState } from "react";
import { LuArrowLeft } from "react-icons/lu";
import { CodeBlockEditor } from "~/components/blocks/CodeBlockEditor";
import {
  CODE_OUTPUT_TYPES,
  type Output,
  OutputsSection,
  type OutputType,
} from "~/components/outputs/OutputsSection";
import { Drawer } from "~/components/ui/drawer";
import {
  type AvailableSource,
  type FieldMapping,
  type Variable,
  VariablesSection,
} from "~/components/variables";
import {
  getComplexProps,
  getFlowCallbacks,
  useDrawer,
  useDrawerParams,
} from "~/hooks/useDrawer";
import { useLicenseEnforcement } from "~/hooks/useLicenseEnforcement";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { toaster } from "~/components/ui/toaster";
import { CodeEditorModal } from "~/optimization_studio/components/code/CodeEditorModal";
import type {
  CodeComponentConfig,
  Field as DSLField,
} from "~/optimization_studio/types/dsl";
import type {
  AgentComponentConfig,
  TypedAgent,
} from "~/server/agents/agent.repository";
import { api } from "~/utils/api";

const DEFAULT_CODE = `import dspy

class Code(dspy.Module):
    def forward(self, input: str):
        # Your code goes here

        return {"output": input.upper()}
`;

const DEFAULT_INPUTS: DSLField[] = [{ identifier: "input", type: "str" }];
const DEFAULT_OUTPUTS: DSLField[] = [{ identifier: "output", type: "str" }];

/**
 * Extract code value from CodeComponentConfig parameters
 */
const getCodeFromConfig = (config: AgentComponentConfig): string => {
  const codeConfig = config as CodeComponentConfig;
  const codeParam = codeConfig.parameters?.find(
    (p) => p.identifier === "code" && p.type === "code",
  );
  return (codeParam?.value as string) ?? DEFAULT_CODE;
};

/**
 * Extract inputs from CodeComponentConfig
 */
const getInputsFromConfig = (config: AgentComponentConfig): DSLField[] => {
  const codeConfig = config as CodeComponentConfig;
  return codeConfig.inputs ?? DEFAULT_INPUTS;
};

/**
 * Extract outputs from CodeComponentConfig
 */
const getOutputsFromConfig = (config: AgentComponentConfig): DSLField[] => {
  const codeConfig = config as CodeComponentConfig;
  return codeConfig.outputs ?? DEFAULT_OUTPUTS;
};

/**
 * Build DSL-compatible config for code agent
 */
const buildCodeConfig = (
  code: string,
  inputs: DSLField[],
  outputs: DSLField[],
): CodeComponentConfig => ({
  name: "Code",
  description: "Python code block",
  parameters: [
    {
      identifier: "code",
      type: "code",
      value: code,
    },
  ],
  inputs: inputs as CodeComponentConfig["inputs"],
  outputs: outputs as CodeComponentConfig["outputs"],
});

export type AgentCodeEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (agent: TypedAgent) => void;
  /** If provided, loads an existing agent for editing */
  agentId?: string;
  /** Available sources for variable mapping (from Evaluations V3) */
  availableSources?: AvailableSource[];
  /** Current input mappings (from Evaluations V3) */
  inputMappings?: Record<string, FieldMapping>;
  /** Callback when input mappings change (for Evaluations V3) */
  onInputMappingsChange?: (
    identifier: string,
    mapping: FieldMapping | undefined,
  ) => void;
};

/**
 * Drawer for creating/editing a code-based agent.
 * Stores config as DSL-compatible Code component for direct execution.
 */
export function AgentCodeEditorDrawer(props: AgentCodeEditorDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const complexProps = getComplexProps();
  const drawerParams = useDrawerParams();
  const flowCallbacks = getFlowCallbacks("agentCodeEditor");
  const utils = api.useContext();

  const onClose = props.onClose ?? closeDrawer;
  const onSave =
    props.onSave ??
    flowCallbacks?.onSave ??
    (complexProps.onSave as AgentCodeEditorDrawerProps["onSave"]);
  const agentId =
    props.agentId ??
    drawerParams.agentId ??
    (complexProps.agentId as string | undefined);
  const isOpen = props.open !== false && props.open !== undefined;

  // Props from drawer params or direct props (for Evaluations V3)
  const availableSources =
    props.availableSources ??
    (complexProps.availableSources as AvailableSource[] | undefined);
  const inputMappings =
    props.inputMappings ??
    (complexProps.inputMappings as Record<string, FieldMapping> | undefined);
  const onInputMappingsChange =
    props.onInputMappingsChange ??
    (flowCallbacks?.onInputMappingsChange as
      | ((identifier: string, mapping: FieldMapping | undefined) => void)
      | undefined);

  // Show mappings only when we have available sources (i.e., in Evaluations V3 context)
  const showMappings = !!availableSources && availableSources.length > 0;

  // Form state
  const [name, setName] = useState("");
  const [code, setCode] = useState(DEFAULT_CODE);
  const [inputs, setInputs] = useState<DSLField[]>(DEFAULT_INPUTS);
  const [outputs, setOutputs] = useState<DSLField[]>(DEFAULT_OUTPUTS);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Track when code modal is open - we hide the drawer to avoid focus conflicts
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);

  // License enforcement for agent creation
  const { checkAndProceed } = useLicenseEnforcement("agents");

  // Load existing agent if editing
  const agentQuery = api.agents.getById.useQuery(
    { id: agentId ?? "", projectId: project?.id ?? "" },
    { enabled: !!agentId && !!project?.id && isOpen },
  );

  // Initialize form with agent data
  useEffect(() => {
    if (agentQuery.data) {
      setName(agentQuery.data.name);
      setCode(getCodeFromConfig(agentQuery.data.config));
      setInputs(getInputsFromConfig(agentQuery.data.config));
      setOutputs(getOutputsFromConfig(agentQuery.data.config));
      setHasUnsavedChanges(false);
    } else if (!agentId) {
      // Reset form for new agent
      setName("");
      setCode(DEFAULT_CODE);
      setInputs(DEFAULT_INPUTS);
      setOutputs(DEFAULT_OUTPUTS);
      setHasUnsavedChanges(false);
    }
  }, [agentQuery.data, agentId, isOpen]);

  // Mutations
  const createMutation = api.agents.create.useMutation({
    onSuccess: (agent) => {
      void utils.agents.getAll.invalidate({ projectId: project?.id ?? "" });
      onSave?.(agent);
      onClose();
    },
    onError: (error) => {
      toaster.create({
        title: "Error creating agent",
        description: error.message,
        type: "error",
      });
    },
  });

  const updateMutation = api.agents.update.useMutation({
    onSuccess: (agent) => {
      void utils.agents.getAll.invalidate({ projectId: project?.id ?? "" });
      void utils.agents.getById.invalidate({
        id: agent.id,
        projectId: project?.id ?? "",
      });
      onSave?.(agent);
      onClose();
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const isValid = name.trim().length > 0;

  const handleSave = useCallback(() => {
    if (!project?.id || !isValid) return;

    // Build DSL-compatible config with current inputs/outputs
    const config = buildCodeConfig(code, inputs, outputs);

    if (agentId) {
      // Editing existing agent - no limit check needed
      updateMutation.mutate({
        id: agentId,
        projectId: project.id,
        name: name.trim(),
        config,
      });
    } else {
      // Creating new agent - check limit first
      checkAndProceed(() => {
        createMutation.mutate({
          projectId: project.id,
          name: name.trim(),
          type: "code",
          config,
        });
      });
    }
  }, [
    project?.id,
    agentId,
    name,
    code,
    inputs,
    outputs,
    isValid,
    createMutation,
    updateMutation,
    checkAndProceed,
  ]);

  const handleNameChange = (value: string) => {
    setName(value);
    setHasUnsavedChanges(true);
  };

  const handleCodeChange = (value: string) => {
    setCode(value);
    setHasUnsavedChanges(true);
  };

  // Handle inputs change from VariablesSection
  const handleInputsChange = useCallback((newVariables: Variable[]) => {
    const newInputs: DSLField[] = newVariables.map((v) => ({
      identifier: v.identifier,
      type: v.type as DSLField["type"],
    }));
    setInputs(newInputs);
    setHasUnsavedChanges(true);
  }, []);

  // Handle outputs change from OutputsSection
  const handleOutputsChange = useCallback((newOutputs: Output[]) => {
    const newFields: DSLField[] = newOutputs.map((o) => ({
      identifier: o.identifier,
      type: o.type as DSLField["type"],
    }));
    setOutputs(newFields);
    setHasUnsavedChanges(true);
  }, []);

  // Handle mapping change (for Evaluations V3)
  const handleMappingChange = useCallback(
    (identifier: string, mapping: FieldMapping | undefined) => {
      onInputMappingsChange?.(identifier, mapping);
    },
    [onInputMappingsChange],
  );

  // Convert DSL inputs to Variable[] for VariablesSection
  const variablesForUI: Variable[] = inputs.map((input) => ({
    identifier: input.identifier,
    type: input.type,
  }));

  // Convert DSL outputs to Output[] for OutputsSection
  const outputsForUI: Output[] = outputs.map((output) => ({
    identifier: output.identifier,
    type: output.type as OutputType,
  }));

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
    <>
      <Drawer.Root
        open={isOpen}
        onOpenChange={({ open }) => !open && handleClose()}
        size="lg"
        closeOnInteractOutside={false}
        modal={false}
        preventScroll={false}
      >
        <Drawer.Content>
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
              <Heading>
                {agentId ? "Edit Code Agent" : "New Code Agent"}
              </Heading>
            </HStack>
          </Drawer.Header>
          <Drawer.Body
            display="flex"
            flexDirection="column"
            overflow="hidden"
            padding={0}
          >
            {agentId && agentQuery.isLoading ? (
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
                {/* Name field */}
                <Field.Root required>
                  <Field.Label>Agent Name</Field.Label>
                  <Input
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="Enter agent name"
                    data-testid="agent-name-input"
                  />
                </Field.Root>

                {/* Code editor */}
                <Box>
                  <Field.Root>
                    <Field.Label>Python Code</Field.Label>
                    <Text fontSize="sm" color="fg.muted" marginBottom={2}>
                      Write a DSPy module that takes inputs and returns outputs.
                    </Text>
                    <CodeBlockEditor
                      code={code}
                      onChange={handleCodeChange}
                      language="python"
                      externalModal
                      onEditClick={() => setIsCodeModalOpen(true)}
                    />
                  </Field.Root>
                </Box>

                {/* Inputs (Variables) */}
                <Box>
                  <VariablesSection
                    variables={variablesForUI}
                    onChange={handleInputsChange}
                    showMappings={showMappings}
                    availableSources={availableSources}
                    mappings={inputMappings}
                    onMappingChange={handleMappingChange}
                    canAddRemove={true}
                    readOnly={false}
                    title="Inputs"
                    isMappingDisabled={!showMappings}
                  />
                </Box>

                {/* Outputs */}
                <Box>
                  <OutputsSection
                    outputs={outputsForUI}
                    onChange={handleOutputsChange}
                    canAddRemove={true}
                    readOnly={false}
                    title="Outputs"
                    availableTypes={CODE_OUTPUT_TYPES}
                  />
                </Box>
              </VStack>
            )}
          </Drawer.Body>
          <Drawer.Footer borderTopWidth="1px" borderColor="border">
            <HStack gap={3}>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                colorPalette="blue"
                onClick={handleSave}
                disabled={!isValid || isSaving}
                loading={isSaving}
                data-testid="save-agent-button"
              >
                {agentId ? "Save Changes" : "Create Agent"}
              </Button>
            </HStack>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer.Root>

      {/* Code editor modal - rendered outside drawer to avoid focus conflicts */}
      <CodeEditorModal
        code={code}
        setCode={handleCodeChange}
        open={isCodeModalOpen}
        onClose={() => setIsCodeModalOpen(false)}
      />
    </>
  );
}
