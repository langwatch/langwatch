import { Alert, Button, HStack, Input, List, Spinner, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Deleting one agent, and saying what goes with it.
 *
 * A family-local copy of `platform/app/src/components/CascadeArchiveDialog.tsx`,
 * narrowed to the one entity type the Agents screen deletes and the one related
 * kind an agent can drag with it — a workflow agent's linked graph. The platform
 * component keeps its generic entity union for the evaluator and workflow
 * callers it still serves, and dies with them; deletes-only forbids repointing
 * them at this one.
 *
 * The confirmation typing, the two `data-testid`s and the stop-propagation on
 * every control are carried over unchanged: the dialog opens from a card that is
 * itself a click target, so a bubbled click reopens the agent behind it.
 */

/** The graph a workflow agent points at, archived along with the agent. */
export type AgentRelatedWorkflow = {
  id: string;
  name: string;
};

export type AgentArchiveDialogProps = {
  open: boolean;
  agentName: string;
  /** The linked workflow, when the agent has one and it has been read. */
  relatedWorkflow: AgentRelatedWorkflow | null;
  isLoading: boolean;
  isLoadingRelated: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

const CONFIRMATION = "delete";

export function AgentArchiveDialog({
  open,
  agentName,
  relatedWorkflow,
  isLoading,
  isLoadingRelated,
  onClose,
  onConfirm,
}: AgentArchiveDialogProps) {
  const [confirmationText, setConfirmationText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setConfirmationText("");
  }, [open]);

  const confirmed = confirmationText.toLowerCase() === CONFIRMATION;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={onClose}
      placement="center"
      initialFocusEl={() => inputRef.current}
    >
      <Dialog.Content bg="bg" maxWidth="500px" onClick={(event) => event.stopPropagation()}>
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            Delete agent?
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          {isLoadingRelated ? (
            <HStack justify="center" paddingY={4}>
              <Spinner size="sm" />
              <Text>Loading related items...</Text>
            </HStack>
          ) : (
            <VStack align="stretch" gap={4}>
              <Text>
                You are about to delete{" "}
                <Text as="span" fontWeight="semibold">
                  &quot;{agentName}&quot;
                </Text>
                .
              </Text>

              {relatedWorkflow && (
                <Alert.Root status="warning">
                  <Alert.Indicator>
                    <TriangleAlert size={16} />
                  </Alert.Indicator>
                  <Alert.Content>
                    <Alert.Title>This will also affect:</Alert.Title>
                    <Alert.Description>
                      <VStack align="stretch" gap={1} marginTop={2}>
                        <Text fontWeight="medium" fontSize="sm">
                          Workflows (1) - will be archived
                        </Text>
                        <List.Root paddingLeft={4}>
                          <List.Item fontSize="sm" color="fg.muted">
                            {relatedWorkflow.name}
                          </List.Item>
                        </List.Root>
                      </VStack>
                    </Alert.Description>
                  </Alert.Content>
                </Alert.Root>
              )}

              <Text>
                This action cannot be undone. Type{" "}
                <Text as="span" fontWeight="semibold">
                  {CONFIRMATION}
                </Text>{" "}
                below to confirm:
              </Text>

              <Input
                placeholder="Type 'delete' to confirm"
                value={confirmationText}
                autoFocus
                onChange={(event) => {
                  event.stopPropagation();
                  setConfirmationText(event.target.value);
                }}
                ref={inputRef}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter" && confirmed && !isLoading) onConfirm();
                }}
                data-testid="cascade-archive-confirm-input"
              />
            </VStack>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            variant="outline"
            marginRight={3}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            colorPalette="red"
            onClick={(event) => {
              event.stopPropagation();
              if (confirmed && !isLoading) onConfirm();
            }}
            disabled={!confirmed || isLoading || isLoadingRelated}
            data-testid="cascade-archive-confirm-button"
          >
            {isLoading ? <Spinner size="sm" /> : "Delete"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
