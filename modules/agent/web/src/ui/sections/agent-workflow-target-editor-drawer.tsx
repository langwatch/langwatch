import { Button, Field, Heading, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/studio-drawer";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

export interface AgentWorkflowTargetEditorDrawerProps {
  open: boolean;
  isLoading: boolean;
  hasLookupFailed: boolean;
  workflowCard?: ReactNode;
  mappings: ReactNode;
  onClose(): void;
  onGoBack?: () => void;
}

export function AgentWorkflowTargetEditorDrawer(props: AgentWorkflowTargetEditorDrawerProps) {
  return (
    <Drawer.Root
      open={props.open}
      onOpenChange={({ open }) => !open && props.onClose()}
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
            <Heading>Workflow Agent</Heading>
          </HStack>
        </Drawer.Header>
        <Drawer.Body display="flex" flexDirection="column" overflow="hidden" padding={0}>
          {props.isLoading ? (
            <HStack justify="center" paddingY={8}>
              <Spinner size="md" />
            </HStack>
          ) : (
            <VStack gap={4} align="stretch" flex={1} paddingX={6} paddingY={4} overflowY="auto">
              {props.workflowCard && (
                <Field.Root>
                  <Field.Label>Workflow</Field.Label>
                  {props.workflowCard}
                </Field.Root>
              )}
              {props.hasLookupFailed ? (
                <Text fontSize="sm" color="fg.error" data-testid="workflow-lookup-error">
                  Couldn&apos;t load this workflow&apos;s agent or its linked workflow, so its real
                  input fields aren&apos;t known. Mapping is unavailable until it loads
                  successfully.
                </Text>
              ) : (
                props.mappings
              )}
            </VStack>
          )}
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <Button onClick={props.onClose} data-testid="close-drawer-button">
            Close
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
