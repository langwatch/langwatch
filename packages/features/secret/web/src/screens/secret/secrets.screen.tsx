/**
 * Settings > Secrets. The project's named credentials, by name only.
 *
 * Moved from `platform/app/src/pages/settings/secrets.tsx`. The settings chrome
 * around it is now `apps/ui`'s `withUiSettingsLayout`, so the `SettingsLayout`
 * wrapper the page carried is gone from the screen and stated in the routes
 * section instead.
 *
 * ## Credential hygiene, which is the point of this page
 *
 * A SECRET'S VALUE NEVER COMES BACK. `secrets.list` answers the contract's
 * `Secret`, whose schema is `.strict()` and whose own docblock reads "Safe
 * metadata. The encrypted value is deliberately absent." A value travels in one
 * direction only, in the create and update dialogs, and both inputs are
 * `type="password"` so it is not shoulder-readable while it is typed. There is
 * no reveal on this page and there never was: a stored secret is replaced, not
 * inspected.
 *
 * ## The page-level policy, unchanged
 *
 * NO PAGE-LEVEL GRANT. The platform page was `SettingsLayout` and nothing else,
 * and it read `secrets:manage` INLINE to decide whether the write controls are
 * live. A reader holding only `secrets:view` still sees which secrets exist —
 * which is what someone debugging a code block needs — and sees no Add button,
 * no row menu, and therefore no dialog. Inventing a page guard here would refuse
 * them a page the product admits today.
 */

import {
  Box,
  Button,
  Card,
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
import { Dialog } from "@langwatch/design-system/dialog";
import { Menu } from "@langwatch/design-system/menu";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Edit, Key, MoreVertical, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { secretApi } from "../../behavior/secret-api";
import { useSecretHost } from "../../model/secret-host";
import { describeSecretRefusal } from "../../model/secret-refusal-copy";

/** The grant every write control on this page is behind. */
export const SECRET_MANAGE_PERMISSION = "secrets:manage";

/**
 * Names are stored upper-snake because that is how a code block reads them as
 * environment variables, so the field normalises as it is typed rather than
 * rejecting afterwards.
 */
function normaliseSecretName(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9_]/g, "");
}

export default function SecretsScreen() {
  const host = useSecretHost();
  const { projectId } = host.scope();
  const canManageSecrets = host.hasPermission(SECRET_MANAGE_PERMISSION);

  const secretsQuery = secretApi.secrets.list.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );
  const secrets = secretsQuery.data ?? [];

  const createMutation = secretApi.secrets.create.useMutation();
  const updateMutation = secretApi.secrets.update.useMutation();
  const deleteMutation = secretApi.secrets.delete.useMutation();
  const utils = secretApi.useUtils();

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newSecretName, setNewSecretName] = useState("");
  const [newSecretValue, setNewSecretValue] = useState("");

  const [secretToDelete, setSecretToDelete] = useState<{ id: string; name: string } | null>(null);

  const [secretToUpdate, setSecretToUpdate] = useState<{ id: string; name: string } | null>(null);
  const [updateValue, setUpdateValue] = useState("");

  /**
   * One place that turns a refusal into words, so the four codes this feature
   * raises read as themselves rather than as "something went wrong on our
   * side". See `model/secret-refusal-copy.ts` for why the words are here at all.
   */
  const reportFailure = (error: unknown, fallbackTitle: string) => {
    const copy = describeSecretRefusal(error);
    host.failed({
      error,
      fallbackTitle: copy?.title ?? fallbackTitle,
      ...(copy ? { description: copy.description } : {}),
    });
  };

  const handleCreate = async () => {
    if (!projectId || !newSecretName || !newSecretValue) return;
    try {
      await createMutation.mutateAsync({
        projectId,
        name: newSecretName,
        value: newSecretValue,
      });
      setIsAddDialogOpen(false);
      setNewSecretName("");
      setNewSecretValue("");
      await utils.secrets.list.invalidate();
    } catch (error) {
      reportFailure(error, "Couldn't create the secret");
    }
  };

  const handleDelete = async () => {
    if (!projectId || !secretToDelete) return;
    try {
      await deleteMutation.mutateAsync({ projectId, secretId: secretToDelete.id });
      setSecretToDelete(null);
      await utils.secrets.list.invalidate();
    } catch (error) {
      reportFailure(error, "Couldn't delete the secret");
    }
  };

  const handleUpdate = async () => {
    if (!projectId || !secretToUpdate || !updateValue) return;
    try {
      await updateMutation.mutateAsync({
        projectId,
        secretId: secretToUpdate.id,
        value: updateValue,
      });
      setSecretToUpdate(null);
      setUpdateValue("");
      await utils.secrets.list.invalidate();
    } catch (error) {
      reportFailure(error, "Couldn't update the secret");
    }
  };

  return (
    <VStack gap={6} width="full" align="start">
      <HStack width="full" marginTop={2}>
        <Heading as="h2">Secrets</Heading>
        <Spacer />
        {host.projectSwitcher()}
        {canManageSecrets && (
          <Tooltip content="Add a new secret for use in code blocks" disabled={false}>
            <PageLayout.HeaderButton onClick={() => setIsAddDialogOpen(true)}>
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
              <EmptyState.Description>Add secrets to use in code blocks</EmptyState.Description>
            </VStack>
          </EmptyState.Content>
        </EmptyState.Root>
      ) : (
        <Card.Root width="full" overflow="hidden">
          <Card.Body paddingY={0} paddingX={0} overflowX="auto">
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
                      <Text>{new Date(secret.updatedAt).toLocaleDateString()}</Text>
                    </Table.Cell>
                    <Table.Cell textAlign="right">
                      {canManageSecrets && (
                        <Menu.Root>
                          <Menu.Trigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Actions for ${secret.name}`}
                            >
                              <MoreVertical />
                            </Button>
                          </Menu.Trigger>
                          <Menu.Content>
                            <Menu.Item
                              value="update"
                              onClick={() => {
                                setSecretToUpdate({ id: secret.id, name: secret.name });
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
                                setSecretToDelete({ id: secret.id, name: secret.name });
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
          </Card.Body>
        </Card.Root>
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
        <Dialog.Content bg="bg">
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
                  onChange={(e) => setNewSecretName(normaliseSecretName(e.target.value))}
                />
              </VStack>
              <VStack gap={1} align="start" width="full">
                <Text fontWeight="medium">Value</Text>
                {/* `type="password"` on purpose: the value is a live credential
                    and there is no reveal anywhere on this page. */}
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
          if (!details.open) setSecretToDelete(null);
        }}
      >
        <Dialog.Content bg="bg">
          <Dialog.Header>
            <Dialog.Title>Delete {secretToDelete?.name ?? ""}?</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <Text>Code blocks referencing this secret will no longer have access.</Text>
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
        <Dialog.Content bg="bg">
          <Dialog.Header>
            <Dialog.Title>Update Value for {secretToUpdate?.name ?? ""}</Dialog.Title>
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
  );
}
