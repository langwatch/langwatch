import type { AgentInputBinding, Field as WorkflowField } from "@langwatch/agent-contract";
import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Drawer } from "@langwatch/design-system/studio-drawer";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

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

  return (
    <Drawer.Root
      open={props.open}
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
                aria-label="Back"
              >
                <ArrowLeft size={20} />
              </Button>
            )}
            <Drawer.Title>Edit Workflow Agent</Drawer.Title>
          </HStack>
        </Drawer.Header>
        <Drawer.Body display="flex" flexDirection="column" overflow="hidden" padding={0}>
          {props.isLoading ? (
            <HStack justify="center" paddingY={8}>
              <Spinner size="md" />
            </HStack>
          ) : (
            <VStack gap={4} align="stretch" flex={1} paddingX={6} paddingY={4} overflowY="auto">
              <Field.Root required>
                <Field.Label>Agent Name</Field.Label>
                <Input
                  value={form.name}
                  onChange={(event) => form.changeName(event.target.value)}
                  placeholder="Enter agent name"
                  data-testid="agent-name-input"
                />
              </Field.Root>
              {props.workflowCard && (
                <Field.Root>
                  <Field.Label>Linked Workflow</Field.Label>
                  {props.workflowCard}
                  <Text fontSize="xs" color="fg.muted" marginTop={1}>
                    Edit the workflow&apos;s nodes and logic in the studio. The mappings below
                    control how scenario data flows into its entry inputs and which end output is
                    returned.
                  </Text>
                </Field.Root>
              )}
              {props.workflowInputs.length === 0 && (
                <Text fontSize="xs" color="fg.error">
                  This workflow has no entry inputs yet. Publish a version with at least one entry
                  input before running it as a scenario target.
                </Text>
              )}
              {props.workflowOutputs.length === 0 && (
                <Text fontSize="xs" color="fg.error">
                  This workflow has no end outputs yet. Publish a version with at least one end
                  output before running it as a scenario target.
                </Text>
              )}
              <Box>
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
              </Box>
            </VStack>
          )}
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <HStack gap={3}>
            <Button variant="outline" onClick={form.close}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              onClick={form.save}
              disabled={!form.isValid || props.isSaving}
              loading={props.isSaving}
              data-testid="save-agent-button"
            >
              Save Changes
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
