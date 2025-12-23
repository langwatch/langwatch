import { Button, Field, Text, VStack } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { Checkbox } from "../../../components/ui/checkbox";
import { Dialog } from "../../../components/ui/dialog";
import { toaster } from "../../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { api } from "../../../utils/api";

export const PushToCopiesDialog = ({
  open,
  onClose,
  workflowId,
  workflowName,
}: {
  open: boolean;
  onClose: () => void;
  workflowId: string;
  workflowName: string;
}) => {
  const { project } = useOrganizationTeamProject();
  const pushToCopies = api.workflow.pushToCopies.useMutation();
  const utils = api.useContext();
  const [selectedCopyIds, setSelectedCopyIds] = useState<Set<string>>(
    new Set(),
  );

  const {
    data: copies,
    isLoading,
    error,
  } = api.workflow.getCopies.useQuery(
    {
      projectId: project?.id ?? "",
      workflowId: workflowId,
    },
    {
      enabled: open && !!project?.id && !!workflowId,
    },
  );

  const [availableCopies, setAvailableCopies] = useState<
    Array<{
      id: string;
      name: string;
      projectId: string;
      fullPath: string;
    }>
  >([]);

  useEffect(() => {
    if (!copies) return;

    setAvailableCopies(copies);
    // Select all by default
    setSelectedCopyIds(new Set(copies.map((c) => c.id)));
  }, [copies]);

  const handleToggleCopy = (copyId: string) => {
    const newSelected = new Set(selectedCopyIds);
    if (newSelected.has(copyId)) {
      newSelected.delete(copyId);
    } else {
      newSelected.add(copyId);
    }
    setSelectedCopyIds(newSelected);
  };

  const handlePush = async () => {
    if (!project || selectedCopyIds.size === 0) return;

    try {
      const result = await pushToCopies.mutateAsync({
        workflowId: workflowId,
        projectId: project.id,
        copyIds: Array.from(selectedCopyIds),
      });

      await utils.workflow.getAll.invalidate();

      toaster.create({
        title: "Workflow pushed",
        description: `Latest version of "${workflowName}" has been pushed to ${result.pushedTo} of ${result.selectedCopies} selected replicated workflow(s).`,
        type: "success",
        meta: {
          closable: true,
        },
      });

      onClose();
      setSelectedCopyIds(new Set());
    } catch (error) {
      toaster.create({
        title: "Error pushing workflow",
        description: error instanceof Error ? error.message : "Unknown error",
        type: "error",
      });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Backdrop />
      <Dialog.Content onClick={(e) => e.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>Push to Replicas</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack gap={4} align={"start"}>
            <Text fontSize="sm" color="gray.600">
              Select which replicas to push the latest version to:
            </Text>
            {isLoading ? (
              <Text>Loading replicas...</Text>
            ) : error ? (
              <Text color="red.500">
                Error loading replicas: {error.message}
              </Text>
            ) : availableCopies.length === 0 ? (
              <Text color="gray.500">
                No replicas found. This may be because you don't have
                workflows:update permission on the replica projects, or the
                replicas have been archived.
              </Text>
            ) : (
              <VStack gap={2} align={"start"} width="full">
                {availableCopies.map((copy) => (
                  <Checkbox
                    key={copy.id}
                    checked={selectedCopyIds.has(copy.id)}
                    onChange={() => handleToggleCopy(copy.id)}
                  >
                    <VStack align={"start"} gap={0}>
                      <Text fontWeight="medium">{copy.name}</Text>
                      <Text fontSize="sm" color="gray.500">
                        {copy.fullPath}
                      </Text>
                    </VStack>
                  </Checkbox>
                ))}
              </VStack>
            )}
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            onClick={() => {
              void handlePush();
            }}
            loading={pushToCopies.isLoading}
            disabled={selectedCopyIds.size === 0 || isLoading}
          >
            Push to {selectedCopyIds.size} replica
            {selectedCopyIds.size !== 1 ? "s" : ""}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
};
