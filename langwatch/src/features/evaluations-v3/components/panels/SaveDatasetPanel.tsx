/**
 * Save Dataset Panel
 *
 * Side panel for saving an inline dataset to the database.
 */

import {
  Box,
  Button,
  Field,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { LuX, LuSave } from "react-icons/lu";
import { Drawer, DrawerFooter } from "../../../../components/ui/drawer";
import { useEvaluationV3Store } from "../../store/useEvaluationV3Store";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../../../utils/api";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { toaster } from "../../../../components/ui/toaster";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export function SaveDatasetPanel({ isOpen, onClose }: Props) {
  const { project } = useOrganizationTeamProject();
  const { dataset, switchToSavedDataset } = useEvaluationV3Store(
    useShallow((s) => ({
      dataset: s.dataset,
      switchToSavedDataset: s.switchToSavedDataset,
    }))
  );

  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const upsertDataset = api.dataset.upsert.useMutation();

  const handleSave = async () => {
    if (!project || !name.trim()) return;
    if (dataset.type !== "inline") return;

    setIsSaving(true);
    try {
      // Convert columns to the expected format
      const columnTypes = dataset.columns.map((col) => ({
        name: col.name,
        type: col.type as "string" | "number" | "boolean" | "json",
      }));

      // Create dataset with records
      const result = await upsertDataset.mutateAsync({
        projectId: project.id,
        name: name.trim(),
        columnTypes,
        datasetRecords: dataset.rows.map((row) => ({
          id: row.id,
          ...row.values,
        })),
      });

      // Switch to the saved dataset
      switchToSavedDataset(result.id, name.trim(), dataset.columns);

      toaster.create({
        title: "Dataset saved",
        description: `"${name.trim()}" has been saved successfully`,
        type: "success",
        duration: 3000,
      });

      onClose();
    } catch (error) {
      toaster.create({
        title: "Error saving dataset",
        description: error instanceof Error ? error.message : "Unknown error",
        type: "error",
        duration: 5000,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      placement="end"
      size="md"
    >
      <Drawer.Backdrop />
      <Drawer.Content>
        <Drawer.Header borderBottomWidth="1px">
          <Drawer.Title>Save Dataset</Drawer.Title>
          <Drawer.CloseTrigger asChild>
            <Button variant="ghost" size="sm" position="absolute" right={4} top={4}>
              <LuX />
            </Button>
          </Drawer.CloseTrigger>
        </Drawer.Header>
        <Drawer.Body>
          <VStack gap={6} align="stretch">
            <Text color="gray.600" fontSize="sm">
              Save your current dataset to use it in other evaluations.
            </Text>

            <Field.Root required>
              <Field.Label>Dataset Name</Field.Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter a name for this dataset"
              />
            </Field.Root>

            <Box
              padding={4}
              background="gray.50"
              borderRadius="md"
            >
              <VStack align="start" gap={2}>
                <Text fontWeight="medium" fontSize="sm">
                  Dataset Summary
                </Text>
                <Text fontSize="sm" color="gray.600">
                  {dataset.columns.length} columns • {dataset.type === "inline" ? dataset.rows.length : 0} rows
                </Text>
                <Text fontSize="xs" color="gray.500">
                  Columns: {dataset.columns.map((c) => c.name).join(", ")}
                </Text>
              </VStack>
            </Box>
          </VStack>
        </Drawer.Body>
        <DrawerFooter borderTopWidth="1px" gap={3}>
          <Box flex={1} />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorPalette="blue"
            onClick={() => void handleSave()}
            loading={isSaving}
            disabled={!name.trim()}
          >
            <LuSave size={14} />
            Save Dataset
          </Button>
        </DrawerFooter>
      </Drawer.Content>
    </Drawer.Root>
  );
}

