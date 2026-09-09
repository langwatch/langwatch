import {
  Alert,
  Box,
  Button,
  chakra,
  Field,
  Heading,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ArrowLeft, HelpCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Drawer } from "@langwatch/design-system/studio-drawer";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { AgentInputBinding, Field as AgentField } from "@langwatch/agent-contract";
import {
  useAgentCodeEditor,
  type AgentCodeEditorOptions,
} from "../../behavior/use-agent-code-editor.ts";

type MappingChange = (identifier: string, mapping: AgentInputBinding | undefined) => void;

export interface AgentCodeEditorDrawerProps extends AgentCodeEditorOptions {
  isLoading?: boolean;
  isSaving?: boolean;
  onGoBack?: () => void;
  onInputMappingsChange?: MappingChange;
  renderCodeEditor(input: {
    code: string;
    onChange(code: string): void;
    onExpand(): void;
  }): ReactNode;
  renderCodeModal(input: {
    code: string;
    onChange(code: string): void;
    open: boolean;
    onClose(): void;
  }): ReactNode;
  renderInputs(input: {
    inputs: AgentField[];
    onChange(inputs: AgentField[]): void;
    onMappingChange: MappingChange;
  }): ReactNode;
  renderOutputs(input: { outputs: AgentField[]; onChange(outputs: AgentField[]): void }): ReactNode;
  renderMappings(input: {
    inputs: AgentField[];
    outputs: AgentField[];
    mappings: Record<string, AgentInputBinding>;
    outputField?: string;
    onMappingChange: MappingChange;
    onOutputFieldChange(field: string | undefined): void;
  }): ReactNode;
  renderTestPanel(input: { agentId: string; projectId: string }): ReactNode;
}

export function AgentCodeEditorDrawer(props: AgentCodeEditorDrawerProps) {
  const agentId = props.agentId;
  const isOpen = props.open === true;

  const form = useAgentCodeEditor(props);
  const { name, code, inputs, outputs, scenarioMappings, scenarioOutputField } = form.draft;
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);
  const isSaving = props.isSaving;

  return (
    <>
      <Drawer.Root
        open={isOpen}
        onOpenChange={({ open }) => !open && form.close()}
        size="lg"
        closeOnInteractOutside={false}
        modal={false}
        preventScroll={false}
      >
        <Drawer.Content bg="bg">
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <HStack gap={2}>
              {props.onGoBack && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={props.onGoBack}
                  padding={1}
                  minWidth="auto"
                  data-testid="back-button"
                >
                  <ArrowLeft size={20} />
                </Button>
              )}
              <Heading>{agentId ? "Edit Code Agent" : "New Code Agent"}</Heading>
            </HStack>
          </Drawer.Header>
          <Drawer.Body display="flex" flexDirection="column" overflow="hidden" padding={0}>
            {props.errorMessage && (
              <Alert.Root status="error">
                <Alert.Content>{props.errorMessage}</Alert.Content>
              </Alert.Root>
            )}
            {!props.errorMessage &&
              (agentId && props.isLoading ? (
                <HStack justify="center" paddingY={8}>
                  <Spinner size="md" />
                </HStack>
              ) : (
                <VStack gap={4} align="stretch" flex={1} paddingX={6} paddingY={4} overflowY="auto">
                  <Field.Root required>
                    <Field.Label>Agent Name</Field.Label>
                    <Input
                      value={name}
                      onChange={(e) => form.change({ name: e.target.value })}
                      placeholder="Enter agent name"
                      data-testid="agent-name-input"
                    />
                  </Field.Root>

                  <Box>
                    <Field.Root>
                      <HStack gap={1}>
                        <Field.Label>Python Code</Field.Label>
                        <Tooltip
                          content="Return a session key beside the outputs to keep a value for the conversation, such as a conversation id. Map an input to the scenario session to receive it on the next turn of the same conversation; it is None on the first turn."
                          positioning={{ placement: "top" }}
                          showArrow
                        >
                          <chakra.button
                            type="button"
                            aria-label="More about session keys"
                            display="flex"
                            color="fg.muted"
                          >
                            <HelpCircle width="14px" />
                          </chakra.button>
                        </Tooltip>
                      </HStack>
                      <Text fontSize="sm" color="fg.muted" marginBottom={2}>
                        Define a Python class with a `__call__` method that takes inputs and returns
                        outputs.
                      </Text>
                      {props.renderCodeEditor({
                        code,
                        onChange: (code) => form.change({ code }),
                        onExpand: () => setIsCodeModalOpen(true),
                      })}
                    </Field.Root>
                  </Box>

                  <Box>
                    {props.renderInputs({
                      inputs: inputs,
                      onChange: form.changeInputs,
                      onMappingChange: (identifier, mapping) =>
                        props.onInputMappingsChange?.(identifier, mapping),
                    })}
                  </Box>

                  <Box>
                    {props.renderOutputs({ outputs: outputs, onChange: form.changeOutputs })}
                  </Box>

                  <Box>
                    {props.renderMappings({
                      inputs: form.scenarioInputs,
                      mappings: scenarioMappings,
                      onMappingChange: form.changeMapping,
                      outputs: outputs,
                      outputField: scenarioOutputField,
                      onOutputFieldChange: (scenarioOutputField) =>
                        form.change({ scenarioOutputField }),
                    })}
                  </Box>

                  {agentId && props.projectId ? (
                    <Box paddingTop={4} borderTopWidth="1px" borderColor="border">
                      {props.renderTestPanel({ agentId, projectId: props.projectId })}
                    </Box>
                  ) : null}
                </VStack>
              ))}
          </Drawer.Body>
          <Drawer.Footer borderTopWidth="1px" borderColor="border">
            <HStack gap={3}>
              <Button variant="outline" onClick={form.close}>
                Cancel
              </Button>
              <Button
                colorPalette="blue"
                onClick={form.save}
                disabled={!form.valid || isSaving || Boolean(props.errorMessage)}
                loading={isSaving}
                data-testid="save-agent-button"
              >
                {agentId ? "Save Changes" : "Create Agent"}
              </Button>
            </HStack>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer.Root>

      {props.renderCodeModal({
        code,
        onChange: (code) => form.change({ code }),
        open: isCodeModalOpen,
        onClose: () => setIsCodeModalOpen(false),
      })}
    </>
  );
}
