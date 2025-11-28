import {
  Button,
  Field,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState, useEffect } from "react";
import { Dialog } from "../../components/ui/dialog";
import { Checkbox } from "../../components/ui/checkbox";
import { toaster } from "../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";

export const PushToCopiesDialog = ({
  open,
  onClose,
  promptId,
  promptName,
}: {
  open: boolean;
  onClose: () => void;
  promptId: string;
  promptName: string;
}) => {
  const { project } = useOrganizationTeamProject();
  const pushToCopies = api.prompts.pushToCopies.useMutation();
  const utils = api.useContext();
  const [selectedCopyIds, setSelectedCopyIds] = useState<Set<string>>(new Set());

  const { data: copies, isLoading } = api.prompts.getCopies.useQuery(
    {
      projectId: project?.id ?? "",
      idOrHandle: promptId,
    },
    {
      enabled: open && !!project?.id && !!promptId,
    },
  );

  const [availableCopies, setAvailableCopies] = useState<
    Array<{
      id: string;
      handle: string;
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
        idOrHandle: promptId,
        projectId: project.id,
        copyIds: Array.from(selectedCopyIds),
      });

      await utils.prompts.getAllPromptsForProject.invalidate();

      toaster.create({
        title: "Prompt pushed",
        description: `Latest version of "${promptName}" has been pushed to ${result.pushedTo} of ${result.selectedCopies} selected copied prompt(s).`,
        type: "success",
        meta: {
          closable: true,
        },
      });

      onClose();
      setSelectedCopyIds(new Set());
    } catch (error) {
      toaster.create({
        title: "Error pushing prompt",
        description:
          error instanceof Error ? error.message : "Unknown error",
        type: "error",
      });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Backdrop />
      <Dialog.Content onClick={(e) => e.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>Push to Copies</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <VStack gap={4} align={"start"}>
            <Text fontSize="sm" color="gray.600">
              Select which copies to push the latest version to:
            </Text>
            {isLoading ? (
              <Text>Loading copies...</Text>
            ) : availableCopies.length === 0 ? (
              <Text color="gray.500">No copies found.</Text>
            ) : (
              <VStack gap={2} align={"start"} width="full">
                {availableCopies.map((copy) => (
                  <Checkbox
                    key={copy.id}
                    checked={selectedCopyIds.has(copy.id)}
                    onChange={() => handleToggleCopy(copy.id)}
                  >
                    <VStack align={"start"} gap={0}>
                      <Text fontWeight="medium">
                        {copy.handle}
                      </Text>
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
            Push to {selectedCopyIds.size} copy{selectedCopyIds.size !== 1 ? "ies" : ""}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
};

