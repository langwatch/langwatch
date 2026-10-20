import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Badge, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { SmallLabel } from "@langwatch/design-system/small-label";
import type {
  CustomModelEntry,
  ModelProviderEditorValue as MaybeStoredModelProvider,
} from "@langwatch/model-provider-contract";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import type {
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../behavior/use-model-provider-form.ts";
import { AddCustomEmbeddingsModelDialog } from "./add-custom-embeddings-model-dialog.tsx";
import { AddCustomModelDialog } from "./add-custom-model-dialog.tsx";
import { RegistryModelsModal } from "./registry-models-modal.tsx";

function CustomModelRow({
  entry,
  onDelete,
  onEdit,
}: {
  entry: CustomModelEntry;
  onDelete: (entry: CustomModelEntry) => void;
  onEdit: (entry: CustomModelEntry) => void;
}) {
  const isChat = entry.mode === "chat";

  return (
    <ListTable.Row>
      <ListTable.Cell>
        <Text fontSize="sm">{entry.modelId}</Text>
      </ListTable.Cell>
      <ListTable.Cell>
        <Text fontSize="sm">{entry.displayName}</Text>
      </ListTable.Cell>
      <ListTable.Cell>
        <Badge size="sm" colorPalette={isChat ? "blue" : "purple"}>
          {isChat ? "Chat" : "Embedding"}
        </Badge>
      </ListTable.Cell>
      <ListTable.ActionCell>
        <HStack gap={0}>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => onEdit(entry)}
            aria-label={`Edit ${entry.modelId}`}
          >
            <Pencil size={14} />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            colorPalette="red"
            onClick={() => onDelete(entry)}
            aria-label={`Delete ${entry.modelId}`}
          >
            <Trash2 size={14} />
          </Button>
        </HStack>
      </ListTable.ActionCell>
    </ListTable.Row>
  );
}

function CustomModelsTable({
  entries,
  onAdd,
  onDelete,
  onEdit,
}: {
  entries: CustomModelEntry[];
  onAdd: () => void;
  onDelete: (entry: CustomModelEntry) => void;
  onEdit: (entry: CustomModelEntry) => void;
}) {
  if (entries.length === 0) {
    return (
      <NoDataInfoBlock
        size="line"
        title="No custom models added"
        action={{ label: "Add a model", onClick: onAdd }}
      />
    );
  }

  return (
    <ListTable density="compact">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Model ID</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Display Name</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Type</ListTable.ColumnHeader>
          <ListTable.ActionHeader />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {entries.map((entry) => (
          <CustomModelRow
            key={`${entry.mode}-${entry.modelId}`}
            entry={entry}
            onDelete={onDelete}
            onEdit={onEdit}
          />
        ))}
      </ListTable.Body>
    </ListTable>
  );
}

/** Chat and embeddings models share one table so a provider's model surface reads at a glance. */
export const CustomModelInputSection = ({
  state,
  actions,
  provider,
  ground,
  showRegistryLink = true,
}: {
  state: UseModelProviderFormState;
  actions: UseModelProviderFormActions;
  provider: MaybeStoredModelProvider;
  /** `card` keeps the card ground the onboarding page gives its dialogs. */
  ground?: "card";
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
      const remove =
        entry.mode === "embedding"
          ? actions.removeCustomEmbeddingsModel
          : actions.removeCustomModel;
      remove(entry.modelId);
    },
    [actions],
  );

  const handleEditModel = useCallback((entry: CustomModelEntry) => {
    setEditingModel(entry);
    const openDialog =
      entry.mode === "embedding" ? setAddEmbeddingsDialogOpen : setAddModelDialogOpen;
    openDialog(true);
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

  const editingChatModel = editingModel?.mode === "chat" ? editingModel : undefined;
  const editingEmbeddingsModel = editingModel?.mode === "embedding" ? editingModel : undefined;

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
          <Menu.Content>
            <Menu.Item value="add-model" onClick={() => setAddModelDialogOpen(true)}>
              Add model
            </Menu.Item>
            <Menu.Item value="add-embeddings" onClick={() => setAddEmbeddingsDialogOpen(true)}>
              Add embeddings model
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
      </HStack>

      <CustomModelsTable
        entries={allCustomModels}
        onAdd={() => setAddModelDialogOpen(true)}
        onDelete={handleDeleteModel}
        onEdit={handleEditModel}
      />

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
        initialValues={editingChatModel}
        ground={ground}
      />

      <AddCustomEmbeddingsModelDialog
        open={addEmbeddingsDialogOpen}
        onClose={handleCloseEmbeddingsDialog}
        onSubmit={handleAddEmbeddingsModel}
        initialValues={editingEmbeddingsModel}
        ground={ground}
      />

      {showRegistryLink && (
        <RegistryModelsModal
          open={registryModalOpen}
          onClose={() => setRegistryModalOpen(false)}
          provider={provider.provider}
          ground={ground}
        />
      )}
    </VStack>
  );
};
