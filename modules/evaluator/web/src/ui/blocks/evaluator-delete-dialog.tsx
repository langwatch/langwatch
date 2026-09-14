/**
 * A narrowed copy of platform/app's CascadeArchiveDialog, specialized for evaluators to
 * show only evaluator-specific related entities (linked workflow and online evaluations).
 * Requires typed confirmation because deletion is destructive with no undo.
 */

import { Alert, Button, HStack, Input, List, Spinner, Text, VStack } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "react-feather";

export type EvaluatorRelatedEntity = { id: string; name: string };

export type EvaluatorDeleteDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
  isLoadingRelated?: boolean;
  evaluatorName: string;
  /** The linked workflow, which is ARCHIVED rather than deleted. */
  workflow: EvaluatorRelatedEntity | null;
  /** The online evaluations, which are DELETED. */
  monitors: readonly EvaluatorRelatedEntity[];
};

const CONFIRMATION = "delete";

function RelatedList({
  entities,
  label,
  description,
}: {
  entities: readonly EvaluatorRelatedEntity[];
  label: string;
  description: string;
}) {
  if (entities.length === 0) return null;

  return (
    <VStack align="stretch" gap={1}>
      <Text fontWeight="medium" fontSize="sm">
        {label} ({entities.length}) - {description}
      </Text>
      <List.Root paddingLeft={4}>
        {entities.slice(0, 5).map((entity) => (
          <List.Item key={entity.id} fontSize="sm" color="fg.muted">
            {entity.name}
          </List.Item>
        ))}
        {entities.length > 5 && (
          <List.Item fontSize="sm" color="fg.subtle">
            ...and {entities.length - 5} more
          </List.Item>
        )}
      </List.Root>
    </VStack>
  );
}

export function EvaluatorDeleteDialog({
  open,
  onClose,
  onConfirm,
  isLoading = false,
  isLoadingRelated = false,
  evaluatorName,
  workflow,
  monitors,
}: EvaluatorDeleteDialogProps) {
  const [confirmationText, setConfirmationText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setConfirmationText("");
  }, [open]);

  const workflows = workflow ? [workflow] : [];
  const hasRelatedEntities = workflows.length > 0 || monitors.length > 0;
  const confirmed = confirmationText.toLowerCase() === CONFIRMATION;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open: isOpen }) => !isOpen && onClose()}
      placement="center"
      initialFocusEl={() => inputRef.current}
    >
      <Dialog.Content bg="bg" maxWidth="500px" onClick={(event) => event.stopPropagation()}>
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            Delete evaluator?
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
                  &quot;{evaluatorName}&quot;
                </Text>
                .
              </Text>

              {hasRelatedEntities && (
                <Alert.Root status="warning">
                  <Alert.Indicator>
                    <AlertTriangle size={16} />
                  </Alert.Indicator>
                  <Alert.Content>
                    <Alert.Title>This will also affect:</Alert.Title>
                    <Alert.Description>
                      <VStack align="stretch" gap={2} marginTop={2}>
                        <RelatedList
                          entities={workflows}
                          label="Workflows"
                          description="will be archived"
                        />
                        <RelatedList
                          entities={monitors}
                          label="Online Evaluations"
                          description="will be deleted"
                        />
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
