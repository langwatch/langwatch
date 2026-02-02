import { Button, Text, VStack } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { Checkbox } from "../ui/checkbox";
import { Dialog } from "../ui/dialog";
import { toaster } from "../ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export const PushToCopiesDialog = ({
  open,
  onClose,
  evaluatorId,
  evaluatorName,
}: {
  open: boolean;
  onClose: () => void;
  evaluatorId: string;
  evaluatorName: string;
}) => {
  const { project } = useOrganizationTeamProject();
  const pushToCopies = api.evaluators.pushToCopies.useMutation();
  const utils = api.useContext();
  const [selectedCopyIds, setSelectedCopyIds] = useState<Set<string>>(
    new Set(),
  );

  const {
    data: copies,
    isLoading,
    error,
  } = api.evaluators.getCopies.useQuery(
    {
      projectId: project?.id ?? "",
      evaluatorId,
    },
    {
      enabled: open && !!project?.id && !!evaluatorId,
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
        evaluatorId,
        projectId: project.id,
        copyIds: Array.from(selectedCopyIds),
      });

      void utils.evaluators.getAll.invalidate({ projectId: project.id });

      toaster.create({
        title: "Evaluator pushed",
        description: `"${evaluatorName}" has been pushed to ${result.pushedTo} of ${result.selectedCopies} selected replicated evaluator(s).`,
        type: "success",
        meta: {
          closable: true,
        },
      });

      onClose();
      setSelectedCopyIds(new Set());
    } catch (error) {
      toaster.create({
        title: "Error pushing evaluator",
        description: error instanceof Error ? error.message : "Unknown error",
        type: "error",
      });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content onClick={(e) => e.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>Push to Replicas</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack gap={4} align={"start"}>
            <Text fontSize="sm" color="fg.muted">
              Select which replicas to push the latest config to:
            </Text>
            {isLoading ? (
              <Text>Loading replicas...</Text>
            ) : error ? (
              <Text color="red.fg">
                Error loading replicas: {error.message}
              </Text>
            ) : availableCopies.length === 0 ? (
              <Text color="fg.muted">No replicas found.</Text>
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
                      <Text fontSize="sm" color="fg.muted">
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
