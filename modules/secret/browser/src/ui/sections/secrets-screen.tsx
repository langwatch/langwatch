/**
 * Values are never returned; readers without write access see no controls.
 * Spec: specs/secrets/secrets-manager.feature
 */

import { Box, Button, Card, Input, Spacer, Skeleton, Table, Text, VStack } from "@chakra-ui/react";
import type { WireOf } from "@langwatch/api/web";
import { Dialog } from "@langwatch/design-system/dialog";
import { Menu } from "@langwatch/design-system/menu";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { Secret } from "@langwatch/secret-contract";
import { Edit, Key, MoreVertical, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { secretApi } from "../../behavior/secret-api.ts";
import { readableDate } from "../../model/readable-date.ts";
import { SECRET_MANAGE_PERMISSION, useSecretHost } from "../../model/secret-host.ts";
import { describeSecretRefusal } from "../../model/secret-refusal-copy.ts";

/**
 * Names are stored upper-snake because that is how a code block reads them as
 * environment variables, so the field normalises as it is typed rather than
 * rejecting afterwards.
 */
function normaliseSecretName(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9_]/g, "");
}

type PickedSecret = { id: string; name: string };

/** Runs one change, clears its form, re-reads the list; any failure along the way is reported. */
async function applySecretChange({
  change,
  settle,
  refresh,
  report,
}: {
  change: () => Promise<unknown>;
  settle: () => void;
  refresh: () => Promise<unknown>;
  report: (error: unknown) => void;
}): Promise<void> {
  try {
    await change();
    settle();
    await refresh();
  } catch (error) {
    report(error);
  }
}

function secretFailureNotice(error: unknown, fallbackTitle: string) {
  const copy = describeSecretRefusal(error);
  return {
    error,
    fallbackTitle: copy?.title ?? fallbackTitle,
    ...(copy ? { description: copy.description } : {}),
  };
}

function SecretRow({
  secret,
  canManage,
  onUpdate,
  onDelete,
}: {
  secret: WireOf<Secret>;
  canManage: boolean;
  onUpdate: (picked: PickedSecret) => void;
  onDelete: (picked: PickedSecret) => void;
}) {
  return (
    <Table.Row data-testid="secret-row">
      <Table.Cell>
        <Text fontFamily="mono">{secret.name}</Text>
      </Table.Cell>
      <Table.Cell>
        <Text>{secret.createdBy?.name ?? "-"}</Text>
      </Table.Cell>
      <Table.Cell>
        <Text>{readableDate(secret.updatedAt).toLocaleDateString()}</Text>
      </Table.Cell>
      <Table.Cell textAlign="right">
        {canManage && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Actions for ${secret.name}`}
                data-testid="secret-row-actions"
              >
                <MoreVertical />
              </Button>
            </Menu.Trigger>
            <Menu.Content>
              <Menu.Item
                value="update"
                data-testid="secret-row-update"
                onClick={() => onUpdate({ id: secret.id, name: secret.name })}
              >
                <Box display="flex" alignItems="center" gap={2}>
                  <Edit size={14} />
                  Update Value
                </Box>
              </Menu.Item>
              <Menu.Item
                value="delete"
                color="red"
                data-testid="secret-row-delete"
                onClick={() => onDelete({ id: secret.id, name: secret.name })}
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
  );
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
    host.failed(secretFailureNotice(error, fallbackTitle));
  };

  const handleCreate = async () => {
    if (!projectId || !newSecretName || !newSecretValue) return;
    await applySecretChange({
      change: () =>
        createMutation.mutateAsync({ projectId, name: newSecretName, value: newSecretValue }),
      settle: () => {
        setIsAddDialogOpen(false);
        setNewSecretName("");
        setNewSecretValue("");
      },
      refresh: () => utils.secrets.list.invalidate(),
      report: (error) => reportFailure(error, "Couldn't create the secret"),
    });
  };

  const handleDelete = async () => {
    if (!projectId || !secretToDelete) return;
    await applySecretChange({
      change: () => deleteMutation.mutateAsync({ projectId, secretId: secretToDelete.id }),
      settle: () => setSecretToDelete(null),
      refresh: () => utils.secrets.list.invalidate(),
      report: (error) => reportFailure(error, "Couldn't delete the secret"),
    });
  };

  const handleUpdate = async () => {
    if (!projectId || !secretToUpdate || !updateValue) return;
    await applySecretChange({
      change: () =>
        updateMutation.mutateAsync({ projectId, secretId: secretToUpdate.id, value: updateValue }),
      settle: () => {
        setSecretToUpdate(null);
        setUpdateValue("");
      },
      refresh: () => utils.secrets.list.invalidate(),
      report: (error) => reportFailure(error, "Couldn't update the secret"),
    });
  };

  const showEmpty = !secretsQuery.isLoading && secrets.length === 0;
  const showSecrets = !secretsQuery.isLoading && secrets.length > 0;

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Secrets</PageLayout.Heading>
        <Spacer />
        {host.projectSwitcher()}
        {canManageSecrets && (
          <Tooltip content="Add a new secret for use in code blocks" disabled={false}>
            <PageLayout.HeaderButton
              onClick={() => setIsAddDialogOpen(true)}
              data-testid="secret-add"
            >
              <Plus /> Add Secret
            </PageLayout.HeaderButton>
          </Tooltip>
        )}
      </PageLayout.Header>
      <VStack gap={6} width="full" align="start" paddingTop={4}>
        {secretsQuery.isLoading && <Skeleton width="full" height="120px" />}
        {showEmpty && (
          <NoDataInfoBlock
            title="No secrets configured"
            description="Add secrets to use in code blocks"
            icon={<Key size={24} />}
          />
        )}
        {showSecrets && (
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
                    <SecretRow
                      key={secret.id}
                      secret={secret}
                      canManage={canManageSecrets}
                      onUpdate={(picked) => {
                        setSecretToUpdate(picked);
                        setUpdateValue("");
                      }}
                      onDelete={setSecretToDelete}
                    />
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
                    data-testid="secret-name"
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
                    data-testid="secret-value"
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
                data-testid="secret-save"
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
                data-testid="secret-delete-confirm"
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
                  data-testid="secret-update-value"
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
                data-testid="secret-update-save"
                onClick={() => void handleUpdate()}
              >
                Save
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger />
          </Dialog.Content>
        </Dialog.Root>
      </VStack>
    </>
  );
}
