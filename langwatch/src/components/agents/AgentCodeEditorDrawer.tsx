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
import { LuArrowLeft } from "react-icons/lu";
import { useState, useCallback, useEffect } from "react";

import { Drawer } from "~/components/ui/drawer";
import { useDrawer, getComplexProps, useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { CodeBlockEditor } from "~/components/blocks/CodeBlockEditor";
import { CodeEditorModal } from "~/optimization_studio/components/code/CodeEditorModal";
import type {
  TypedAgent,
  AgentComponentConfig,
} from "~/server/agents/agent.repository";
import type { CodeComponentConfig } from "~/optimization_studio/types/dsl";

const DEFAULT_CODE = `import dspy

class Code(dspy.Module):
    def forward(self, input: str):
        # Your code goes here

        return {"output": input.upper()}
`;

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
 * Build DSL-compatible config for code agent
 */
const buildCodeConfig = (code: string): CodeComponentConfig => ({
  name: "Code",
  description: "Python code block",
  parameters: [
    {
      identifier: "code",
      type: "code",
      value: code,
    },
  ],
  inputs: [
    {
      identifier: "input",
      type: "str",
    },
  ],
  outputs: [
    {
      identifier: "output",
      type: "str",
    },
  ],
});

export type AgentCodeEditorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSave?: (agent: TypedAgent) => void;
  /** If provided, loads an existing agent for editing */
  agentId?: string;
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
  const utils = api.useContext();

  const onClose = props.onClose ?? closeDrawer;
  const onSave =
    props.onSave ??
    (complexProps.onSave as AgentCodeEditorDrawerProps["onSave"]);
  const agentId =
    props.agentId ??
    drawerParams.agentId ??
    (complexProps.agentId as string | undefined);
  const isOpen = props.open !== false && props.open !== undefined;

  // Form state
  const [name, setName] = useState("");
  const [code, setCode] = useState(DEFAULT_CODE);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Track when code modal is open - we hide the drawer to avoid focus conflicts
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);

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
      setHasUnsavedChanges(false);
    } else if (!agentId) {
      // Reset form for new agent
      setName("");
      setCode(DEFAULT_CODE);
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

    // Build DSL-compatible config
    const config = buildCodeConfig(code);

    if (agentId) {
      updateMutation.mutate({
        id: agentId,
        projectId: project.id,
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
  }, [
    project?.id,
    agentId,
    name,
    code,
    isValid,
    createMutation,
    updateMutation,
  ]);

  const handleNameChange = (value: string) => {
    setName(value);
    setHasUnsavedChanges(true);
  };

  const handleCodeChange = (value: string) => {
    setCode(value);
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
                <Box flex={1}>
                  <Field.Root>
                    <Field.Label>Python Code</Field.Label>
                    <Text fontSize="sm" color="gray.500" marginBottom={2}>
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
              </VStack>
            )}
          </Drawer.Body>
          <Drawer.Footer borderTopWidth="1px" borderColor="gray.200">
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
