import type { AgentInputBinding, Field as WorkflowField } from "@langwatch/agent-contract";
import { Drawer } from "@langwatch/design-system/drawer";
import { Box, Field, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { isScenarioMappingValid } from "@langwatch/scenario-contract";
import { useRef, useState, type ReactNode } from "react";

import {
  useWorkflowAgentEditor,
  type WorkflowAgentEditorOptions,
} from "../../behavior/use-workflow-agent-editor.ts";

/** What agent's workflow editor hands the caller's mapping section. */
export type AgentWorkflowMappingProps = {
  inputs: WorkflowField[];
  outputs: WorkflowField[];
  mappings: Record<string, AgentInputBinding>;
  outputField?: string;
  onMappingChange(identifier: string, mapping: AgentInputBinding | undefined): void;
  onOutputFieldChange(field: string | undefined): void;
};

/** What a caller hands agent's workflow editor drawer. */
export type AgentWorkflowEditorDrawerProps = WorkflowAgentEditorOptions & {
  workflowCard?: ReactNode;
  renderMappings(props: AgentWorkflowMappingProps): ReactNode;
  onGoBack?: () => void;
};

export function AgentWorkflowEditorDrawer(props: AgentWorkflowEditorDrawerProps) {
  const form = useWorkflowAgentEditor(props);
  const [attempted, setAttempted] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const mappingRef = useRef<HTMLDivElement>(null);
  const nameMissing = form.name.trim().length === 0;
  const mappingMissing = !isScenarioMappingValid({ mappings: form.mappings });
  const unavailableReason = workflowUnavailableReason(props);

  // Save stays clickable while the workflow is usable; an attempt with a problem shows it.
  const trySave = () => {
    if (props.isSaving) return;
    setAttempted(true);
    if (nameMissing) {
      nameRef.current?.focus();
      return;
    }
    if (mappingMissing) {
      mappingRef.current?.focus();
      return;
    }
    form.save();
  };

  return (
    <Drawer
      open={props.open}
      onClose={form.close}
      onBack={props.onGoBack}
      backButtonTestId="back-button"
      size="lg"
      title="Edit Workflow Agent"
      loading={props.isLoading}
      footer={{
        cancel: { onClick: form.close },
        primaryAction: {
          label: "Save Changes",
          onClick: trySave,
          loading: props.isSaving,
          disabledReason: unavailableReason,
          "data-testid": "save-agent-button",
        },
      }}
    >
      <VStack gap={4} align="stretch">
        <Field.Root required invalid={attempted && nameMissing}>
          <Field.Label>Agent Name</Field.Label>
          <Input
            ref={nameRef}
            value={form.name}
            onChange={(event) => form.changeName(event.target.value)}
            placeholder="Enter agent name"
            data-testid="agent-name-input"
          />
          <Field.ErrorText>Enter an agent name.</Field.ErrorText>
        </Field.Root>
        {props.workflowCard && (
          <Field.Root>
            <Field.Label>Linked Workflow</Field.Label>
            {props.workflowCard}
            <Text fontSize="xs" color="fg.muted" marginTop={1}>
              Edit the workflow&apos;s nodes and logic in the studio. The mappings below control how
              scenario data flows into its entry inputs and which end output is returned.
            </Text>
          </Field.Root>
        )}
        {props.workflowInputs.length === 0 && (
          <Text fontSize="xs" color="fg.error">
            This workflow has no entry inputs yet. Publish a version with at least one entry input
            before running it as a scenario target.
          </Text>
        )}
        {props.workflowOutputs.length === 0 && (
          <Text fontSize="xs" color="fg.error">
            This workflow has no end outputs yet. Publish a version with at least one end output
            before running it as a scenario target.
          </Text>
        )}
        <Box ref={mappingRef} tabIndex={-1} outline="none">
          {props.renderMappings({
            inputs:
              props.workflowInputs.length > 0
                ? props.workflowInputs
                : [{ identifier: "input", type: "str" }],
            outputs: props.workflowOutputs,
            mappings: form.mappings,
            outputField: form.outputField,
            onMappingChange: form.changeMapping,
            onOutputFieldChange: form.changeOutputField,
          })}
          {attempted && mappingMissing && (
            <Text role="alert" fontSize="xs" color="fg.error" marginTop={1.5}>
              Map the scenario input or messages to one of this workflow&apos;s entry inputs.
            </Text>
          )}
        </Box>
      </VStack>
    </Drawer>
  );
}

function workflowUnavailableReason(props: AgentWorkflowEditorDrawerProps) {
  if (props.isLoading) return "The workflow is still loading.";
  if (props.workflowInputs.length === 0) return "This workflow has no entry inputs yet.";
  if (props.workflowOutputs.length === 0) return "This workflow has no end outputs yet.";
  return void 0;
}
