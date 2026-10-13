import { Drawer } from "@langwatch/design-system/drawer";
import { Field, Text, VStack } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

export interface AgentWorkflowTargetEditorDrawerProps {
  open: boolean;
  isLoading: boolean;
  hasLookupFailed: boolean;
  workflowCard?: ReactNode;
  mappings: ReactNode;
  onClose: () => void;
  onGoBack?: () => void;
}

export function AgentWorkflowTargetEditorDrawer(props: AgentWorkflowTargetEditorDrawerProps) {
  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      onBack={props.onGoBack}
      backButtonTestId="back-button"
      size="lg"
      title="Workflow Agent"
      loading={props.isLoading}
      footer={{
        primaryAction: {
          label: "Close",
          onClick: props.onClose,
          "data-testid": "close-drawer-button",
        },
      }}
    >
      <VStack gap={4} align="stretch">
        {props.workflowCard && (
          <Field.Root>
            <Field.Label>Workflow</Field.Label>
            {props.workflowCard}
          </Field.Root>
        )}
        {props.hasLookupFailed ? (
          <Text fontSize="sm" color="fg.error" data-testid="workflow-lookup-error">
            Couldn&apos;t load this workflow&apos;s agent or its linked workflow, so its real input
            fields aren&apos;t known. Mapping is unavailable until it loads successfully.
          </Text>
        ) : (
          props.mappings
        )}
      </VStack>
    </Drawer>
  );
}
