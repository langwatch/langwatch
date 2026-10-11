/**
 * Values are never returned; readers without write access see no controls.
 * Spec: specs/secrets/secrets-manager.feature
 */

import type { WireOf } from "@langwatch/api/web";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Dialog } from "@langwatch/design-system/dialog";
import { EmptyValue } from "@langwatch/design-system/empty-value";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Box,
  Button,
  Field,
  HStack,
  Input,
  Spacer,
  Skeleton,
  SkeletonText,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { Secret } from "@langwatch/secret-contract";
import { toEpochMs } from "@langwatch/time";
import { Edit, Key, MoreVertical, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

import { secretApi } from "../../behavior/secret-api.ts";
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

/** Puts the cursor on the first empty field; true when one was found. */
function focusFirstMissing(fields: { value: string; input: RefObject<HTMLInputElement | null> }[]) {
  const first = fields.find((field) => !field.value);
  first?.input.current?.focus();
  return first !== void 0;
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
    <ListTable.Row data-testid="secret-row">
      <ListTable.Cell>
        <HStack gap={3}>
          <Box color="fg.muted" flexShrink={0}>
            <Key size={16} />
          </Box>
          <Text fontFamily="mono" fontWeight="medium">
            {secret.name}
          </Text>
        </HStack>
      </ListTable.Cell>
      <ListTable.Cell>
        <Text>{secret.createdBy?.name ?? <EmptyValue label="Unknown creator" />}</Text>
      </ListTable.Cell>
      <ListTable.Cell>
        <Text color="fg.muted">
          <FormattedDate value={toEpochMs(secret.updatedAt)} display="date" />
        </Text>
      </ListTable.Cell>
      <ListTable.ActionCell>
        {canManage && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Actions for ${secret.name}`}
                data-testid="secret-row-actions"
              >
                <MoreVertical size={16} />
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
                  Update value
                </Box>
              </Menu.Item>
              <Menu.Item
                value="delete"
                color="fg.error"
                data-testid="secret-row-delete"
                onClick={() => onDelete({ id: secret.id, name: secret.name })}
              >
                <Box display="flex" alignItems="center" gap={2}>
                  <Trash2 size={14} />
                  Delete secret
                </Box>
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
        )}
      </ListTable.ActionCell>
    </ListTable.Row>
  );
}

function SecretsTableHeader() {
  return (
    <ListTable.Header>
      <ListTable.Row>
        <ListTable.ColumnHeader>Name</ListTable.ColumnHeader>
        <ListTable.ColumnHeader>Created by</ListTable.ColumnHeader>
        <ListTable.ColumnHeader>Last updated</ListTable.ColumnHeader>
        <ListTable.ActionHeader />
      </ListTable.Row>
    </ListTable.Header>
  );
}

/** A few faint rows, no table chrome: a loading list that turns out empty barely registers. */
function SecretsTableSkeleton() {
  return (
    <VStack gap={4} width="full" align="start" data-testid="secrets-loading">
      {[0, 1, 2].map((row) => (
        <HStack key={row} gap={3} width="full" opacity={0.5}>
          <Skeleton boxSize={4} borderRadius="sm" />
          <SkeletonText noOfLines={1} width="160px" />
        </HStack>
      ))}
    </VStack>
  );
}

const SKELETON_DELAY_MS = 300;

/** True once `active` has held for the delay, so a fast load never shows a skeleton. */
function useAfterDelay({ active }: { active: boolean }) {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!active) return setElapsed(false);
    const timer = setTimeout(() => setElapsed(true), SKELETON_DELAY_MS);
    return () => clearTimeout(timer);
  }, [active]);
  return active && elapsed;
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

  const [addAttempted, setAddAttempted] = useState(false);
  const [updateAttempted, setUpdateAttempted] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const valueInputRef = useRef<HTMLInputElement>(null);
  const updateInputRef = useRef<HTMLInputElement>(null);

  const closeAddDialog = () => {
    setIsAddDialogOpen(false);
    setNewSecretName("");
    setNewSecretValue("");
    setAddAttempted(false);
  };

  const closeUpdateDialog = () => {
    setSecretToUpdate(null);
    setUpdateValue("");
    setUpdateAttempted(false);
  };

  /**
   * One place that turns a refusal into words, so the four codes this feature
   * raises read as themselves rather than as "something went wrong on our
   * side". See `model/secret-refusal-copy.ts` for why the words are here at all.
   */
  const reportFailure = (error: unknown, fallbackTitle: string) => {
    host.failed(secretFailureNotice(error, fallbackTitle));
  };

  const handleCreate = async () => {
    if (createMutation.isPending) return;
    setAddAttempted(true);
    const missing = focusFirstMissing([
      { value: newSecretName, input: nameInputRef },
      { value: newSecretValue, input: valueInputRef },
    ]);
    if (missing || !projectId) return;
    await applySecretChange({
      change: () =>
        createMutation.mutateAsync({ projectId, name: newSecretName, value: newSecretValue }),
      settle: closeAddDialog,
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
    if (updateMutation.isPending || !secretToUpdate) return;
    setUpdateAttempted(true);
    const missing = focusFirstMissing([{ value: updateValue, input: updateInputRef }]);
    if (missing || !projectId) return;
    await applySecretChange({
      change: () =>
        updateMutation.mutateAsync({ projectId, secretId: secretToUpdate.id, value: updateValue }),
      settle: closeUpdateDialog,
      refresh: () => utils.secrets.list.invalidate(),
      report: (error) => reportFailure(error, "Couldn't update the secret"),
    });
  };

  const showSkeleton = useAfterDelay({ active: secretsQuery.isLoading });
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
              primary
              onClick={() => setIsAddDialogOpen(true)}
              data-testid="secret-add"
            >
              <Plus /> Add secret
            </PageLayout.HeaderButton>
          </Tooltip>
        )}
      </PageLayout.Header>
      <VStack gap={6} width="full" align="start" paddingTop={4}>
        <Text color="fg.muted">Encrypted values your code blocks can read at run time.</Text>
        {showSkeleton && <SecretsTableSkeleton />}
        {showEmpty && (
          <NoDataInfoBlock
            title="No secrets configured"
            description="Add secrets to use in code blocks"
            icon={<Key size={24} />}
          />
        )}
        {showSecrets && (
          <ListTable scroll="x" scrollLabel="Secrets">
            <SecretsTableHeader />
            <ListTable.Body>
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
            </ListTable.Body>
          </ListTable>
        )}

        <Dialog
          open={isAddDialogOpen}
          onClose={closeAddDialog}
          title="Add secret"
          onSubmit={() => void handleCreate()}
          primaryAction={{
            label: "Save",
            type: "submit",
            loading: createMutation.isPending,
            "data-testid": "secret-save",
          }}
        >
          <VStack gap={4} align="start">
            <Field.Root width="full" invalid={addAttempted && !newSecretName}>
              <Field.Label>Name</Field.Label>
              <Input
                ref={nameInputRef}
                placeholder="e.g., OPENAI_API_KEY"
                data-testid="secret-name"
                value={newSecretName}
                onChange={(e) => setNewSecretName(normaliseSecretName(e.target.value))}
              />
              <Field.ErrorText>Enter a name for the secret.</Field.ErrorText>
            </Field.Root>
            <Field.Root width="full" invalid={addAttempted && !newSecretValue}>
              <Field.Label>Value</Field.Label>
              {/* `type="password"` on purpose: the value is a live credential
                    and there is no reveal anywhere on this page. */}
              <Input
                ref={valueInputRef}
                type="password"
                placeholder="Enter secret value"
                data-testid="secret-value"
                value={newSecretValue}
                onChange={(e) => setNewSecretValue(e.target.value)}
              />
              <Field.ErrorText>Enter the secret's value.</Field.ErrorText>
            </Field.Root>
          </VStack>
        </Dialog>

        <ConfirmDialog
          open={!!secretToDelete}
          onClose={() => setSecretToDelete(null)}
          title={`Delete ${secretToDelete?.name ?? ""}?`}
          description="Code blocks referencing this secret will no longer have access."
          confirmLabel="Delete"
          loading={deleteMutation.isPending}
          onConfirm={() => void handleDelete()}
        />

        <Dialog
          open={!!secretToUpdate}
          onClose={closeUpdateDialog}
          title={`Update value for ${secretToUpdate?.name ?? ""}`}
          onSubmit={() => void handleUpdate()}
          primaryAction={{
            label: "Save",
            type: "submit",
            loading: updateMutation.isPending,
            "data-testid": "secret-update-save",
          }}
        >
          <Field.Root invalid={updateAttempted && !updateValue}>
            <Field.Label>New value</Field.Label>
            <Input
              ref={updateInputRef}
              type="password"
              placeholder="Enter new secret value"
              data-testid="secret-update-value"
              value={updateValue}
              onChange={(e) => setUpdateValue(e.target.value)}
            />
            <Field.ErrorText>Enter the new value.</Field.ErrorText>
          </Field.Root>
        </Dialog>
      </VStack>
    </>
  );
}
