import {
  Box,
  Button,
  EmptyState,
  Heading,
  HStack,
  Input,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Edit, Key, MoreVertical, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { api } from "~/utils/api";
import { ProjectSelector } from "../../components/DashboardLayout";
import SettingsLayout from "../../components/SettingsLayout";
import { Dialog } from "../../components/ui/dialog";
import { Menu } from "../../components/ui/menu";
import { Tooltip } from "../../components/ui/tooltip";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

export default function SecretsPage() {
  const { project, organizations, hasPermission } =
    useOrganizationTeamProject();
  const canManageSecrets = hasPermission("secrets:manage");

  const secretsQuery = api.secrets.list.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const secrets = secretsQuery.data ?? [];

  const createMutation = api.secrets.create.useMutation();
  const updateMutation = api.secrets.update.useMutation();
  const deleteMutation = api.secrets.delete.useMutation();
  const utils = api.useContext();

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newSecretName, setNewSecretName] = useState("");
  const [newSecretValue, setNewSecretValue] = useState("");

  const [secretToDelete, setSecretToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [secretToUpdate, setSecretToUpdate] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [updateValue, setUpdateValue] = useState("");

  const handleCreate = async () => {
    if (!project?.id || !newSecretName || !newSecretValue) return;
    await createMutation.mutateAsync({
      projectId: project.id,
      name: newSecretName,
      value: newSecretValue,
    });
    setIsAddDialogOpen(false);
    setNewSecretName("");
    setNewSecretValue("");
    await utils.secrets.list.invalidate();
  };

  const handleDelete = async () => {
    if (!project?.id || !secretToDelete) return;
    await deleteMutation.mutateAsync({
      projectId: project.id,
      secretId: secretToDelete.id,
    });
    setSecretToDelete(null);
    await utils.secrets.list.invalidate();
  };

  const handleUpdate = async () => {
    if (!project?.id || !secretToUpdate || !updateValue) return;
    await updateMutation.mutateAsync({
      projectId: project.id,
      secretId: secretToUpdate.id,
      value: updateValue,
    });
    setSecretToUpdate(null);
    setUpdateValue("");
    await utils.secrets.list.invalidate();
  };

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <HStack width="full" marginTop={2}>
          <Heading as="h2">Secrets</Heading>
          <Spacer />
          {organizations && project && (
            <ProjectSelector organizations={organizations} project={project} />
          )}
          {canManageSecrets && (
            <Tooltip
              content="Add a new secret for use in code blocks"
              disabled={false}
            >
              <PageLayout.HeaderButton
                onClick={() => setIsAddDialogOpen(true)}
              >
                <Plus /> Add Secret
              </PageLayout.HeaderButton>
            </Tooltip>
          )}
        </HStack>

        {secretsQuery.isLoading ? (
          <Spinner />
        ) : secrets.length === 0 ? (
          <EmptyState.Root width="full">
            <EmptyState.Content>
              <EmptyState.Indicator>
                <Key size={24} />
              </EmptyState.Indicator>
              <VStack textAlign="center">
                <EmptyState.Title>No secrets configured</EmptyState.Title>
                <EmptyState.Description>
                  Add secrets to use in code blocks
                </EmptyState.Description>
              </VStack>
            </EmptyState.Content>
          </EmptyState.Root>
        ) : (
          <Table.Root width="full">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Name</Table.ColumnHeader>
                <Table.ColumnHeader>Created By</Table.ColumnHeader>
                <Table.ColumnHeader>Last Updated</Table.ColumnHeader>
                <Table.ColumnHeader />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {secrets.map((secret) => (
                <Table.Row key={secret.id}>
                  <Table.Cell>
                    <Text fontFamily="mono">{secret.name}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text>{secret.createdBy?.name ?? "-"}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text>
                      {new Date(secret.updatedAt).toLocaleDateString()}
                    </Text>
                  </Table.Cell>
                  <Table.Cell textAlign="right">
                    {canManageSecrets && (
                      <Menu.Root>
                        <Menu.Trigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreVertical />
                          </Button>
                        </Menu.Trigger>
                        <Menu.Content>
                          <Menu.Item
                            value="update"
                            onClick={() => {
                              setSecretToUpdate({
                                id: secret.id,
                                name: secret.name,
                              });
                              setUpdateValue("");
                            }}
                          >
                            <Box display="flex" alignItems="center" gap={2}>
                              <Edit size={14} />
                              Update Value
                            </Box>
                          </Menu.Item>
                          <Menu.Item
                            value="delete"
                            color="red"
                            onClick={() => {
                              setSecretToDelete({
                                id: secret.id,
                                name: secret.name,
                              });
                            }}
                          >
                            <Box display="flex" alignItems="center" gap={2}>
                              <Trash2 size={14} />
                              Delete Secret
                            </Box>
                          </Menu.Item>
                        </Menu.Content>
                      </Menu.Root>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}

        {/* Add Secret Dialog */}
        <Dialog.Root
          open={isAddDialogOpen}
          onOpenChange={(details) => {
            if (!details.open) {
              setIsAddDialogOpen(false);
              setNewSecretName("");
              setNewSecretValue("");
            }
          }}
        >
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Add Secret</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <VStack gap={4} align="start">
                <VStack gap={1} align="start" width="full">
                  <Text fontWeight="medium">Name</Text>
                  <Input
                    placeholder="e.g., OPENAI_API_KEY"
                    value={newSecretName}
                    onChange={(e) =>
                      setNewSecretName(
                        e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "")
                      )
                    }
                  />
                </VStack>
                <VStack gap={1} align="start" width="full">
                  <Text fontWeight="medium">Value</Text>
                  <Input
                    type="password"
                    placeholder="Enter secret value"
                    value={newSecretValue}
                    onChange={(e) => setNewSecretValue(e.target.value)}
                  />
                </VStack>
              </VStack>
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline">Cancel</Button>
              </Dialog.ActionTrigger>
              <Button
                colorPalette="blue"
                loading={createMutation.isPending}
                disabled={!newSecretName || !newSecretValue}
                onClick={() => void handleCreate()}
              >
                Save
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger />
          </Dialog.Content>
        </Dialog.Root>

        {/* Delete Confirmation Dialog */}
        <Dialog.Root
          open={!!secretToDelete}
          onOpenChange={(details) => {
            if (!details.open) {
              setSecretToDelete(null);
            }
          }}
        >
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Delete {secretToDelete?.name}?</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Text>
                Code blocks referencing this secret will no longer have access.
              </Text>
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline">Cancel</Button>
              </Dialog.ActionTrigger>
              <Button
                colorPalette="red"
                loading={deleteMutation.isPending}
                onClick={() => void handleDelete()}
              >
                Delete
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger />
          </Dialog.Content>
        </Dialog.Root>

        {/* Update Value Dialog */}
        <Dialog.Root
          open={!!secretToUpdate}
          onOpenChange={(details) => {
            if (!details.open) {
              setSecretToUpdate(null);
              setUpdateValue("");
            }
          }}
        >
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>
                Update Value for {secretToUpdate?.name}
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <VStack gap={1} align="start" width="full">
                <Text fontWeight="medium">New Value</Text>
                <Input
                  type="password"
                  placeholder="Enter new secret value"
                  value={updateValue}
                  onChange={(e) => setUpdateValue(e.target.value)}
                />
              </VStack>
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline">Cancel</Button>
              </Dialog.ActionTrigger>
              <Button
                colorPalette="blue"
                loading={updateMutation.isPending}
                disabled={!updateValue}
                onClick={() => void handleUpdate()}
              >
                Save
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger />
          </Dialog.Content>
        </Dialog.Root>
      </VStack>
    </SettingsLayout>
  );
}
