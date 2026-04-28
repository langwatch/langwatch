import {
  Badge,
  Box,
  Button,
  Card,
  HStack,
  Spacer,
  Table,
  Text,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import { Tooltip } from "../../../components/ui/tooltip";
import { Key, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { PageLayout } from "../../../components/ui/layouts/PageLayout";
import { useState } from "react";
import { toaster } from "../../../components/ui/toaster";
import { usePublicEnv } from "../../../hooks/usePublicEnv";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { useSession } from "~/utils/auth-client";
import { api, type RouterOutputs } from "../../../utils/api";
import { formatTimeAgo } from "../../../utils/formatTimeAgo";
import { CreateApiKeyDrawer, type CreateApiKeyInput } from "./CreateApiKeyDrawer";
import { EditApiKeyDrawer } from "./EditApiKeyDrawer";
import { RevokeConfirmDialog } from "./RevokeConfirmDialog";
import { TokenCreatedDialog } from "./TokenCreatedDialog";

type ApiKeyRow = RouterOutputs["apiKey"]["list"][number];

/**
 * Unified API Keys table. Shows all user-scoped API keys plus the legacy
 * project key in one flat list. Admins see all keys in the org.
 */
export function ApiKeysSection({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId?: string;
}) {
  const session = useSession();
  const currentUserId = session.data?.user?.id ?? "";
  const publicEnv = usePublicEnv();
  const { project } = useOrganizationTeamProject();
  const endpoint = publicEnv.data?.BASE_HOST ?? "https://app.langwatch.ai";

  const apiKeys = api.apiKey.list.useQuery({ organizationId });
  const myBindings = api.apiKey.myBindings.useQuery({ organizationId });
  const orgProjects = api.apiKey.orgProjects.useQuery({ organizationId });
  const orgMembers = api.apiKey.orgMembers.useQuery({ organizationId });
  const isAdmin = (orgMembers.data?.length ?? 0) > 0;
  const createMutation = api.apiKey.create.useMutation();
  const updateMutation = api.apiKey.update.useMutation();
  const revokeMutation = api.apiKey.revoke.useMutation();
  const queryClient = api.useContext();

  const {
    open: isCreateOpen,
    onOpen: onCreateOpen,
    onClose: onCreateClose,
  } = useDisclosure();

  const [newToken, setNewToken] = useState<string | null>(null);
  const [apiKeyToRevoke, setApiKeyToRevoke] = useState<string | null>(null);
  const [apiKeyToEdit, setApiKeyToEdit] = useState<ApiKeyRow | null>(null);

  const handleCreate = (input: CreateApiKeyInput) => {
    if (input.keyType === "personal" && input.bindings.length === 0) {
      toaster.create({
        title: "No permissions to grant",
        description:
          "You have no role bindings in this organization, so there is nothing to grant to a key.",
        type: "error",
        duration: 5000,
        meta: { closable: true },
      });
      return;
    }

    createMutation.mutate(
      {
        organizationId,
        name: input.name,
        description: input.description.trim()
          ? input.description.trim()
          : undefined,
        expiresAt: input.expiresAt,
        permissionMode: input.permissionMode,
        keyType: input.keyType,
        assignedToUserId: input.assignedToUserId,
        bindings: input.bindings as Parameters<typeof createMutation.mutate>[0]["bindings"],
      },
      {
        onSuccess: (result) => {
          setNewToken(result.token);
          void queryClient.apiKey.list.invalidate();
        },
        onError: (error) => {
          toaster.create({
            title: "Failed to create API key",
            description: error.message,
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  const handleUpdate = (input: {
    apiKeyId: string;
    name?: string;
    description?: string | null;
    permissionMode?: "all" | "readonly" | "restricted";
    bindings?: Array<{
      role: string;
      customRoleId: string | null | undefined;
      scopeType: string;
      scopeId: string;
    }>;
  }) => {
    updateMutation.mutate(
      {
        organizationId,
        apiKeyId: input.apiKeyId,
        name: input.name,
        description: input.description,
        permissionMode: input.permissionMode,
        bindings: input.bindings as Parameters<typeof updateMutation.mutate>[0]["bindings"],
      },
      {
        onSuccess: () => {
          setApiKeyToEdit(null);
          toaster.create({
            title: "API key updated",
            type: "success",
            duration: 3000,
            meta: { closable: true },
          });
          void queryClient.apiKey.list.invalidate();
        },
        onError: (error) => {
          toaster.create({
            title: "Failed to update API key",
            description: error.message,
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  const handleRevoke = (apiKeyId: string) => {
    revokeMutation.mutate(
      { organizationId, apiKeyId },
      {
        onSuccess: () => {
          setApiKeyToRevoke(null);
          toaster.create({
            title: "API key revoked",
            type: "success",
            duration: 3000,
            meta: { closable: true },
          });
          void queryClient.apiKey.list.invalidate();
        },
        onError: (error) => {
          toaster.create({
            title: "Failed to revoke API key",
            description: error.message,
            type: "error",
            duration: 5000,
            meta: { closable: true },
          });
        },
      },
    );
  };

  const activeKeys = apiKeys.data ?? [];

  // Build unified rows: API keys + project service key
  const projectApiKey = project?.apiKey;

  const getStatus = (key: ApiKeyRow) => {
    if (key.expiresAt && new Date(key.expiresAt) < new Date()) return "Expired";
    return "Active";
  };

  const getPermissionLabel = (mode: string) => {
    switch (mode) {
      case "all":
        return "All";
      case "readonly":
        return "Read only";
      case "restricted":
        return "Restricted";
      default:
        return mode;
    }
  };

  return (
    <>
      <VStack gap={4} width="full" align="start">
        <HStack width="full">
          <Text fontSize="sm" color="fg.muted">
            Do not share your API keys or expose them in the browser or other
            client-side code.
          </Text>
          <Spacer />
          <PageLayout.HeaderButton onClick={onCreateOpen}>
            <Plus size={16} />
            Create new secret key
          </PageLayout.HeaderButton>
        </HStack>

        <Card.Root width="full" overflow="hidden">
          <Card.Body paddingY={0} paddingX={0}>
            <Table.Root variant="line" size="md" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>Name</Table.ColumnHeader>
                  <Table.ColumnHeader>Status</Table.ColumnHeader>
                  <Table.ColumnHeader>Secret Key</Table.ColumnHeader>
                  <Table.ColumnHeader>Created</Table.ColumnHeader>
                  <Table.ColumnHeader>Last Used</Table.ColumnHeader>
                  <Table.ColumnHeader>Created By</Table.ColumnHeader>
                  <Table.ColumnHeader>Permissions</Table.ColumnHeader>
                  <Table.ColumnHeader width="100px"></Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {/* Project service key row */}
                {projectApiKey && (
                  <Table.Row>
                    <Table.Cell>
                      <HStack align="center">
                        <Key size={14} />
                        <Text>Project API Key</Text>
                      </HStack>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge size="sm" colorPalette="green">Active</Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontSize="xs" fontFamily="monospace" color="fg.muted">
                        sk-...{projectApiKey.slice(-4)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontSize="sm" color="fg.muted">—</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontSize="sm" color="fg.muted">—</Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge size="sm" colorPalette="purple">Service</Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontSize="sm">All</Text>
                    </Table.Cell>
                    <Table.Cell>
                      {/* No edit/revoke for service keys — only regenerate via project settings */}
                    </Table.Cell>
                  </Table.Row>
                )}

                {/* User-scoped API key rows */}
                {activeKeys.map((apiKey) => (
                  <Table.Row key={apiKey.id}>
                    <Table.Cell>
                      <HStack align="start">
                        <Box paddingTop={1}>
                          <Key size={14} />
                        </Box>
                        <VStack align="start" gap={0}>
                          <Text>{apiKey.name}</Text>
                          {apiKey.description && (
                            <Text fontSize="xs" color="fg.muted">
                              {apiKey.description}
                            </Text>
                          )}
                        </VStack>
                      </HStack>
                    </Table.Cell>
                    <Table.Cell>
                      {getStatus(apiKey) === "Expired" ? (
                        <Badge size="sm" colorPalette="red">Expired</Badge>
                      ) : (
                        <Badge size="sm" colorPalette="green">Active</Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontSize="xs" fontFamily="monospace" color="fg.muted">
                        sk-...{apiKey.lookupIdSuffix}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {new Date(apiKey.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </Table.Cell>
                    <Table.Cell>
                      {apiKey.lastUsedAt ? (
                        <Tooltip content={new Date(apiKey.lastUsedAt).toISOString()}>
                          <Text
                            cursor="help"
                            tabIndex={0}
                            aria-label={`Last used at ${new Date(apiKey.lastUsedAt).toISOString()}`}
                          >
                            {formatTimeAgo(new Date(apiKey.lastUsedAt).getTime())}
                          </Text>
                        </Tooltip>
                      ) : (
                        <Text fontSize="sm" color="fg.muted">Never</Text>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      {apiKey.userId ? (
                        <Text fontSize="sm">
                          {apiKey.createdByUserName ?? apiKey.userName ?? "—"}
                        </Text>
                      ) : (
                        <Badge size="sm" colorPalette="purple">Service</Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontSize="sm">
                        {getPermissionLabel(apiKey.permissionMode)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {/* Owner or admin can edit/revoke; service keys (no userId) require admin */}
                      {(isAdmin || apiKey.userId === currentUserId) && (
                        <HStack gap={1}>
                          <Button
                            size="xs"
                            variant="ghost"
                            aria-label={`Edit API key ${apiKey.name}`}
                            onClick={() => setApiKeyToEdit(apiKey)}
                          >
                            <Pencil size={14} />
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            colorPalette="red"
                            aria-label={`Revoke API key ${apiKey.name}`}
                            onClick={() => setApiKeyToRevoke(apiKey.id)}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </Button>
                        </HStack>
                      )}
                    </Table.Cell>
                  </Table.Row>
                ))}

                {activeKeys.length === 0 && !projectApiKey && (
                  <Table.Row>
                    <Table.Cell colSpan={8}>
                      <Text color="fg.muted" textAlign="center" paddingY={4}>
                        No API keys. Create one to get started.
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Root>
          </Card.Body>
        </Card.Root>
      </VStack>

      <CreateApiKeyDrawer
        isOpen={isCreateOpen && !newToken}
        isCreating={createMutation.isLoading}
        myBindings={myBindings}
        orgProjects={orgProjects.data ?? []}
        organizationId={organizationId}
        onClose={onCreateClose}
        onCreate={handleCreate}
      />

      <EditApiKeyDrawer
        apiKey={apiKeyToEdit}
        isUpdating={updateMutation.isLoading}
        myBindings={myBindings}
        orgProjects={orgProjects.data ?? []}
        onClose={() => setApiKeyToEdit(null)}
        onSave={handleUpdate}
      />

      <TokenCreatedDialog
        newToken={newToken}
        projectId={projectId}
        endpoint={endpoint}
        onClose={() => {
          setNewToken(null);
          onCreateClose();
        }}
      />

      <RevokeConfirmDialog
        apiKeyId={apiKeyToRevoke}
        isRevoking={revokeMutation.isLoading}
        onCancel={() => setApiKeyToRevoke(null)}
        onConfirm={handleRevoke}
      />
    </>
  );
}
