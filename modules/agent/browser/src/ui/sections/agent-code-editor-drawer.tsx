import type { AgentInputBinding, Field as AgentField } from "@langwatch/agent-contract";
import { Drawer } from "@langwatch/design-system/drawer";
import {
  Box,
  chakra,
  Field,
  HStack,
  Input,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { isScenarioMappingValid } from "@langwatch/scenario-contract";
import { HelpCircle } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

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
    onChange: (inputs: AgentField[]) => void;
    onMappingChange: MappingChange;
  }): ReactNode;
  renderOutputs(input: {
    outputs: AgentField[];
    onChange: (outputs: AgentField[]) => void;
  }): ReactNode;
  renderMappings(input: {
    inputs: AgentField[];
    outputs: AgentField[];
    mappings: Record<string, AgentInputBinding>;
    outputField?: string;
    onMappingChange: MappingChange;
    onOutputFieldChange(field: string | undefined): void;
  }): ReactNode;
  renderTestPanel(input: { agentId: string; projectId: string }): ReactNode;
  /** The experiment target's deploy label picker, shown above the name in the workbench. */
  deployLabel?: ReactNode;
}

export function AgentCodeEditorDrawer(props: AgentCodeEditorDrawerProps) {
  const agentId = props.agentId;
  const isOpen = props.open !== false && props.open !== undefined;

  const form = useAgentCodeEditor(props);
  const { name, code, inputs, outputs, scenarioMappings, scenarioOutputField } = form.draft;
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const mappingRef = useRef<HTMLDivElement>(null);
  const isSaving = props.isSaving;
  const nameMissing = name.trim().length === 0;
  const mappingMissing = !isScenarioMappingValid({ mappings: scenarioMappings });

  // Save stays clickable; an attempt with a problem shows it and moves focus to the first one.
  const trySave = () => {
    if (isSaving) return;
    setAttempted(true);
    if (nameMissing) {
      nameRef.current?.focus();
      return;
    }
    if (mappingMissing) {
      mappingRef.current?.focus();
      return;
    }
    void form.save();
  };

  return (
    <>
      <Drawer
        open={isOpen}
        onClose={form.close}
        onBack={props.onGoBack}
        backButtonTestId="back-button"
        size="lg"
        title={agentId ? "Edit Code Agent" : "New Code Agent"}
        loading={Boolean(agentId && props.isLoading && !props.errorMessage)}
        error={props.errorMessage ? { title: props.errorMessage } : void 0}
        footer={{
          cancel: { onClick: form.close },
          primaryAction: {
            label: agentId ? "Save Changes" : "Create Agent",
            onClick: trySave,
            loading: isSaving,
            disabledReason: props.errorMessage ? "This agent could not be loaded." : void 0,
            "data-testid": "save-agent-button",
          },
        }}
      >
        <VStack gap={4} align="stretch">
          {props.deployLabel}
          <Field.Root required invalid={attempted && nameMissing}>
            <Field.Label>Agent Name</Field.Label>
            <Input
              ref={nameRef}
              value={name}
              onChange={(e) => form.change({ name: e.target.value })}
              placeholder="Enter agent name"
              data-testid="agent-name-input"
            />
            <Field.ErrorText>Enter an agent name.</Field.ErrorText>
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

          <Box>{props.renderOutputs({ outputs: outputs, onChange: form.changeOutputs })}</Box>

          <Box ref={mappingRef} tabIndex={-1} outline="none">
            {props.renderMappings({
              inputs: form.scenarioInputs,
              mappings: scenarioMappings,
              onMappingChange: form.changeMapping,
              outputs: outputs,
              outputField: scenarioOutputField,
              onOutputFieldChange: (scenarioOutputField) => form.change({ scenarioOutputField }),
            })}
            {attempted && mappingMissing && (
              <Text role="alert" fontSize="xs" color="fg.error" marginTop={1.5}>
                Map the scenario input or messages to one of this agent&apos;s inputs.
              </Text>
            )}
          </Box>

          {agentId && props.projectId ? (
            <Box paddingTop={4} borderTopWidth="1px" borderColor="border">
              {props.renderTestPanel({ agentId, projectId: props.projectId })}
            </Box>
          ) : null}
        </VStack>
      </Drawer>

      {props.renderCodeModal({
        code,
        onChange: (code) => form.change({ code }),
        open: isCodeModalOpen,
        onClose: () => setIsCodeModalOpen(false),
      })}
    </>
  );
}
