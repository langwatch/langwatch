import {
  Alert,
  Button,
  HStack,
  Input,
  List,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "react-feather";
import { Dialog } from "./ui/dialog";

export type RelatedEntity = {
  id: string;
  name: string;
};

export type RelatedEntities = {
  workflows?: RelatedEntity[];
  evaluators?: RelatedEntity[];
  agents?: RelatedEntity[];
  monitors?: RelatedEntity[];
};

/**
 * Cascade archive confirmation dialog.
 *
 * Shows a warning when archiving an entity that has related entities
 * that will also be affected (archived or deleted).
 *
 * Note: All interactive elements use stopPropagation() to prevent event bubbling.
 */
export function CascadeArchiveDialog({
  open,
  onClose,
  onConfirm,
  isLoading = false,
  isLoadingRelated = false,
  entityType,
  entityName,
  relatedEntities,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading?: boolean;
  isLoadingRelated?: boolean;
  entityType: "workflow" | "evaluator" | "agent";
  entityName: string;
  relatedEntities: RelatedEntities;
}) {
  const [confirmationText, setConfirmationText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setConfirmationText("");
  }, [open]);

  const hasRelatedEntities =
    (relatedEntities.workflows?.length ?? 0) > 0 ||
    (relatedEntities.evaluators?.length ?? 0) > 0 ||
    (relatedEntities.agents?.length ?? 0) > 0 ||
    (relatedEntities.monitors?.length ?? 0) > 0;

  const getEntityTypeLabel = (type: "workflow" | "evaluator" | "agent") => {
    switch (type) {
      case "workflow":
        return "workflow";
      case "evaluator":
        return "evaluator";
      case "agent":
        return "agent";
    }
  };

  const renderEntityList = (
    entities: RelatedEntity[] | undefined,
    label: string,
    description: string,
  ) => {
    if (!entities || entities.length === 0) return null;

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
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={onClose}
      placement="center"
      initialFocusEl={() => inputRef.current}
    >
      <Dialog.Content maxWidth="500px">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            Delete {getEntityTypeLabel(entityType)}?
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
                  &quot;{entityName}&quot;
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
                        {renderEntityList(
                          relatedEntities.workflows,
                          "Workflows",
                          "will be archived",
                        )}
                        {renderEntityList(
                          relatedEntities.evaluators,
                          "Evaluators",
                          "will be archived",
                        )}
                        {renderEntityList(
                          relatedEntities.agents,
                          "Agents",
                          "will be archived",
                        )}
                        {renderEntityList(
                          relatedEntities.monitors,
                          "Online Evaluations",
                          "will be deleted",
                        )}
                      </VStack>
                    </Alert.Description>
                  </Alert.Content>
                </Alert.Root>
              )}

              <Text>
                This action cannot be undone. Type{" "}
                <Text as="span" fontWeight="semibold">
                  delete
                </Text>{" "}
                below to confirm:
              </Text>

              <Input
                placeholder="Type 'delete' to confirm"
                value={confirmationText}
                autoFocus
                onChange={(e) => {
                  e.stopPropagation();
                  setConfirmationText(e.target.value);
                }}
                ref={inputRef}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    if (
                      confirmationText.toLowerCase() === "delete" &&
                      !isLoading
                    ) {
                      onConfirm();
                    }
                  }
                }}
                data-testid="cascade-archive-confirm-input"
              />
            </VStack>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            variant="outline"
            mr={3}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            colorPalette="red"
            onClick={(e) => {
              e.stopPropagation();
              if (confirmationText.toLowerCase() === "delete" && !isLoading) {
                onConfirm();
              }
            }}
            disabled={
              confirmationText.toLowerCase() !== "delete" ||
              isLoading ||
              isLoadingRelated
            }
            data-testid="cascade-archive-confirm-button"
          >
            {isLoading ? <Spinner size="sm" /> : "Delete"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
