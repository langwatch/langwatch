import {
  Badge,
  Box,
  Button,
  HStack,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { CustomModelEntry } from "../../server/modelProviders/customModel.schema";
import type {
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../hooks/useModelProviderForm";
import type { MaybeStoredModelProvider } from "../../server/modelProviders/registry";
import { SmallLabel } from "../SmallLabel";
import { Menu } from "../ui/menu";
import { AddCustomModelDialog } from "./AddCustomModelDialog";
import { AddCustomEmbeddingsModelDialog } from "./AddCustomEmbeddingsModelDialog";
import { RegistryModelsModal } from "./RegistryModelsModal";

/**
 * Renders the Custom Models section in the model provider configuration drawer.
 * Displays a table of user-defined custom models (chat and embeddings combined),
 * with controls to add new models via dialogs and view registry models.
 *
 * @param state - Form state containing custom model entries
 * @param actions - Form actions for managing custom models
 * @param provider - The model provider configuration
 */
export const CustomModelInputSection = ({
  state,
  actions,
  provider,
  dialogBackground,
  showRegistryLink = true,
}: {
  state: UseModelProviderFormState;
  actions: UseModelProviderFormActions;
  provider: MaybeStoredModelProvider;
  /** Override DialogContent background (e.g. "bg.surface" for solid on onboarding). */
  dialogBackground?: string;
  /** Whether to show the "See all models" link and registry modal. Defaults to true. */
  showRegistryLink?: boolean;
}) => {
  const [addModelDialogOpen, setAddModelDialogOpen] = useState(false);
  const [addEmbeddingsDialogOpen, setAddEmbeddingsDialogOpen] = useState(false);
  const [registryModalOpen, setRegistryModalOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<CustomModelEntry | undefined>();

  const allCustomModels: CustomModelEntry[] = useMemo(
    () => [...state.customModels, ...state.customEmbeddingsModels],
    [state.customModels, state.customEmbeddingsModels],
  );

  const handleDeleteModel = useCallback(
    (entry: CustomModelEntry) => {
      if (entry.mode === "embedding") {
        actions.removeCustomEmbeddingsModel(entry.modelId);
      } else {
        actions.removeCustomModel(entry.modelId);
      }
    },
    [actions],
  );

  const handleEditModel = useCallback((entry: CustomModelEntry) => {
    setEditingModel(entry);
    if (entry.mode === "embedding") {
      setAddEmbeddingsDialogOpen(true);
    } else {
      setAddModelDialogOpen(true);
    }
  }, []);

  const handleAddModel = useCallback(
    (entry: CustomModelEntry) => {
      if (editingModel) {
        actions.removeCustomModel(editingModel.modelId);
        setEditingModel(undefined);
      }
      actions.addCustomModel(entry);
    },
    [actions, editingModel],
  );

  const handleAddEmbeddingsModel = useCallback(
    (entry: CustomModelEntry) => {
      if (editingModel) {
        actions.removeCustomEmbeddingsModel(editingModel.modelId);
        setEditingModel(undefined);
      }
      actions.addCustomEmbeddingsModel(entry);
    },
    [actions, editingModel],
  );

  const handleCloseModelDialog = useCallback(() => {
    setAddModelDialogOpen(false);
    setEditingModel(undefined);
  }, []);

  const handleCloseEmbeddingsDialog = useCallback(() => {
    setAddEmbeddingsDialogOpen(false);
    setEditingModel(undefined);
  }, []);

  return (
    <VStack width="full" gap={3} paddingTop={4} align="stretch">
      <HStack justify="space-between" align="center">
        <SmallLabel>Custom Models</SmallLabel>
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button size="xs" variant="outline">
              <Plus size={14} />
              Add
            </Button>
          </Menu.Trigger>
          <Menu.Content zIndex="popover">
            <Menu.Item
              value="add-model"
              onClick={() => setAddModelDialogOpen(true)}
            >
              Add model
            </Menu.Item>
            <Menu.Item
              value="add-embeddings"
              onClick={() => setAddEmbeddingsDialogOpen(true)}
            >
              Add embeddings model
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
      </HStack>

      {allCustomModels.length === 0 ? (
        <Box
          borderWidth="1px"
          borderRadius="md"
          padding={4}
          textAlign="center"
        >
          <Text fontSize="sm" color="fg.muted">
            No custom models added
          </Text>
        </Box>
      ) : (
        <Table.Root size="sm" variant="outline">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Model ID</Table.ColumnHeader>
              <Table.ColumnHeader>Display Name</Table.ColumnHeader>
              <Table.ColumnHeader>Type</Table.ColumnHeader>
              <Table.ColumnHeader width="80px" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {allCustomModels.map((entry) => (
              <Table.Row key={`${entry.mode}-${entry.modelId}`}>
                <Table.Cell>
                  <Text fontSize="sm">{entry.modelId}</Text>
                </Table.Cell>
                <Table.Cell>
                  <Text fontSize="sm">{entry.displayName}</Text>
                </Table.Cell>
                <Table.Cell>
                  <Badge
                    size="sm"
                    colorPalette={entry.mode === "chat" ? "blue" : "purple"}
                  >
                    {entry.mode === "chat" ? "Chat" : "Embedding"}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  <HStack gap={0}>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => handleEditModel(entry)}
                      aria-label={`Edit ${entry.modelId}`}
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      colorPalette="red"
                      onClick={() => handleDeleteModel(entry)}
                      aria-label={`Delete ${entry.modelId}`}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </HStack>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {showRegistryLink && (
        <HStack justify="end">
          <Button
            variant="plain"
            size="xs"
            color="fg.muted"
            textDecoration="underline"
            onClick={() => setRegistryModalOpen(true)}
          >
            See all models
          </Button>
        </HStack>
      )}

      <AddCustomModelDialog
        open={addModelDialogOpen}
        onClose={handleCloseModelDialog}
        onSubmit={handleAddModel}
        initialValues={editingModel?.mode === "chat" ? editingModel : undefined}
        dialogBackground={dialogBackground}
      />

      <AddCustomEmbeddingsModelDialog
        open={addEmbeddingsDialogOpen}
        onClose={handleCloseEmbeddingsDialog}
        onSubmit={handleAddEmbeddingsModel}
        initialValues={editingModel?.mode === "embedding" ? editingModel : undefined}
        dialogBackground={dialogBackground}
      />

      {showRegistryLink && (
        <RegistryModelsModal
          open={registryModalOpen}
          onClose={() => setRegistryModalOpen(false)}
          provider={provider.provider}
          dialogBackground={dialogBackground}
        />
      )}
    </VStack>
  );
};
