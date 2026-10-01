/**
 * Settings > API Keys. One table of every credential that can talk to the LangWatch API, plus
 * the ingestion keys the CLI mints.
 */

import type { ApiKeyListEntry, ApiKeyTrpcGrant } from "@langwatch/api-key-contract";
import type { WireOf } from "@langwatch/api/web";
import { formatTimeAgo } from "@langwatch/browser-host/format-time-ago";
import { Menu } from "@langwatch/design-system/menu";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Badge,
  Box,
  Button,
  Card,
  HStack,
  Spacer,
  Table,
  Text,
  useDisclosure,
  VStack,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { nowInstant, toDate, toEpochMs } from "@langwatch/time";
import { Clipboard, Key, MoreVertical, Plus, RotateCw } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { apiKeyApi } from "../../behavior/api-key-api.ts";
import { apiKeyRowAnchorId } from "../../model/api-key-anchor.ts";
import {
  API_KEY_SCOPE_QUERY_KEY,
  PROJECT_KEY_ROTATE_PERMISSION,
  useApiKeyHost,
  type ApiKeyHostApi,
} from "../../model/api-key-host.ts";
import {
  filterRowsByScope,
  scopeFilterAddressWrite,
  scopeFilterFromAddress,
  scopeHierarchyOf,
  type ScopeFilterValue,
} from "../../model/api-key-scope-filter.ts";
import { readableDate } from "../../model/display-formatters.ts";
import { IngestionKeysSection } from "../blocks/ingestion-keys-section.tsx";
import { RevokeConfirmDialog } from "../blocks/revoke-confirm-dialog.tsx";
import { ProviderScopeChips, ScopeFilter } from "../elements/scope-picker.tsx";
import { CreateApiKeyDrawer, type CreateApiKeyInput } from "./create-api-key-drawer.tsx";
import { EditApiKeyDrawer } from "./edit-api-key-drawer.tsx";
import { RegenerateApiKeyDialog } from "./regenerate-api-key-dialog.tsx";
import { TokenCreatedDialog } from "./token-created-dialog.tsx";

/** A key as the browser holds one: the wire carries its instants as ISO strings. */
type ApiKeyRow = WireOf<ApiKeyListEntry>;

/**
 * Actions for the legacy "Project API Key" row. The row intentionally has no edit/revoke
 * affordance - the only mutating action is rotation, and only when the viewer can manage the
 * project (`project:manage`).
 */
function ProjectKeyActions({
  apiKey,
  canManage,
  host,
  onRotate,
}: {
  apiKey: string;
  canManage: boolean;
  host: ApiKeyHostApi;
  onRotate: () => void;
}) {
  return (
    <HStack gap={1}>
      <Button
        size="xs"
        variant="ghost"
        aria-label="Copy secret key"
        onClick={() => {
          void host.copyToClipboard({
            text: apiKey,
            succeeded: { title: "API key copied to clipboard" },
          });
        }}
      >
        <Clipboard size={14} />
      </Button>
      {canManage && (
        <Tooltip content="Rotate this key">
          <Button size="xs" variant="ghost" aria-label="Rotate Project API Key" onClick={onRotate}>
            <RotateCw size={14} aria-hidden="true" />
          </Button>
        </Tooltip>
      )}
    </HStack>
  );
}

/** Why a create request cannot be sent, or null when it can. */
function createInputProblem(
  input: CreateApiKeyInput,
): { fallbackTitle: string; description: string } | null {
  if (input.bindings.length > 0) return null;
  if (input.permissionMode === "restricted") {
    return {
      fallbackTitle: "No scopes selected",
      description: "Select at least one scope for a restricted key.",
    };
  }
  if (input.keyType !== "personal") return null;
  return {
    fallbackTitle: "No permissions to grant",
    description:
      "You have no role bindings in this organization, so there is nothing to grant to a key.",
  };
}

/** Whether a just-created key can reach this project, for the setup snippet's picker. */
function isProjectReachable({
  project,
  keyInput,
}: {
  project: { id: string };
  keyInput: CreateApiKeyInput | null;
}): boolean {
  if (!keyInput || keyInput.keyType === "service") return true;
  if (keyInput.permissionMode !== "restricted") return true;
  return keyInput.bindings.some((binding) => binding.scopeId === project.id);
}

function isExpired(key: ApiKeyRow): boolean {
  return !!key.expiresAt && toEpochMs(key.expiresAt) < nowInstant().epochMilliseconds;
}

function PermissionBadge({ permissionMode }: { permissionMode: ApiKeyRow["permissionMode"] }) {
  if (permissionMode === "all") {
    return (
      <Badge size="sm" colorPalette="green">
        All
      </Badge>
    );
  }
  return (
    <Badge size="sm" colorPalette="orange">
      Restricted
    </Badge>
  );
}

function NoKeysRow({ filtered }: { filtered: boolean }) {
  return (
    <Table.Row>
      <Table.Cell colSpan={9}>
        <Text color="fg.muted" textAlign="center" paddingY={4}>
          {filtered
            ? "No keys match the current scope. Change the filter above to see other keys."
            : "No API keys. Create one to get started."}
        </Text>
      </Table.Cell>
    </Table.Row>
  );
}

/** The legacy project key: fixed to its project, with every permission. */
function ProjectKeyRow({
  apiKey,
  projectId,
  projectName,
  canManage,
  host,
  onRotate,
}: {
  apiKey: string;
  projectId: string;
  projectName: string | undefined;
  canManage: boolean;
  host: ApiKeyHostApi;
  onRotate: () => void;
}) {
  return (
    <Table.Row>
      <Table.Cell>
        <HStack align="center">
          <Key size={14} />
          <Text>Project API Key</Text>
        </HStack>
      </Table.Cell>
      <Table.Cell>
        <Badge size="sm" colorPalette="green">
          Active
        </Badge>
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="xs" fontFamily="monospace" color="fg.muted">
          sk-…{apiKey.slice(-4)}
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="sm" color="fg.muted">
          -
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="sm" color="fg.muted">
          -
        </Text>
      </Table.Cell>
      <Table.Cell>
        <Badge size="sm" colorPalette="purple">
          Service
        </Badge>
      </Table.Cell>
      <Table.Cell>
        {/* Name the project this legacy key is fixed to, using
          the same named scope chip as the user-scoped rows. */}
        <ProviderScopeChips
          size="xs"
          scopes={[
            {
              scopeType: "PROJECT",
              scopeId: projectId,
              name: projectName,
            },
          ]}
        />
      </Table.Cell>
      <Table.Cell>
        <Badge size="sm" colorPalette="green">
          All
        </Badge>
      </Table.Cell>
      <Table.Cell>
        <ProjectKeyActions apiKey={apiKey} canManage={canManage} host={host} onRotate={onRotate} />
      </Table.Cell>
    </Table.Row>
  );
}

function ApiKeyTableRow({
  apiKey,
  scopeBadge,
  canModify,
  onEdit,
  onRevoke,
}: {
  apiKey: ApiKeyRow;
  scopeBadge: ReactNode;
  /** Owner or admin; a service key (no user) needs admin. */
  canModify: boolean;
  onEdit: (apiKey: ApiKeyRow) => void;
  onRevoke: (apiKeyId: string) => void;
}) {
  return (
    <Table.Row id={apiKeyRowAnchorId(apiKey.id)}>
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
        {isExpired(apiKey) ? (
          <Badge size="sm" colorPalette="red">
            Expired
          </Badge>
        ) : (
          <Badge size="sm" colorPalette="green">
            Active
          </Badge>
        )}
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="xs" fontFamily="monospace" color="fg.muted">
          sk-lw-{apiKey.lookupIdPrefix}…
        </Text>
      </Table.Cell>
      <Table.Cell>
        {readableDate(apiKey.createdAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </Table.Cell>
      <Table.Cell>
        {apiKey.lastUsedAt ? (
          <Tooltip content={readableDate(apiKey.lastUsedAt).toISOString()}>
            <Text
              cursor="help"
              tabIndex={0}
              aria-label={`Last used at ${readableDate(apiKey.lastUsedAt).toISOString()}`}
            >
              {formatTimeAgo(toEpochMs(apiKey.lastUsedAt)) ?? ""}
            </Text>
          </Tooltip>
        ) : (
          <Text fontSize="sm" color="fg.muted">
            Never
          </Text>
        )}
      </Table.Cell>
      <Table.Cell>
        {apiKey.userId ? (
          <Badge size="sm" variant="outline">
            {apiKey.userEmail ?? apiKey.userName ?? " - "}
          </Badge>
        ) : (
          <Badge size="sm" colorPalette="purple">
            Service
          </Badge>
        )}
      </Table.Cell>
      <Table.Cell>{scopeBadge}</Table.Cell>
      <Table.Cell>
        <PermissionBadge permissionMode={apiKey.permissionMode} />
      </Table.Cell>
      <Table.Cell>
        {/* Owner/admin can edit/revoke; service keys (no userId) need admin */}
        {canModify && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button
                size="xs"
                variant="ghost"
                aria-label={`Actions for API key ${apiKey.name}`}
                data-testid="api-key-actions"
              >
                <MoreVertical size={14} />
              </Button>
            </Menu.Trigger>
            <Menu.Content>
              <Menu.Item value="edit" data-testid="api-key-edit" onClick={() => onEdit(apiKey)}>
                Edit
              </Menu.Item>
              <Menu.Item
                value="revoke"
                color="red.500"
                data-testid="api-key-revoke"
                onClick={() => onRevoke(apiKey.id)}
              >
                Revoke
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
        )}
      </Table.Cell>
    </Table.Row>
  );
}

export default function ApiKeysScreen() {
  const host = useApiKeyHost();
  const scope = host.scope();
  const organizationId = scope.organizationId ?? "";
  const currentUserId = host.currentUser()?.id ?? "";
  const endpoint = host.apiEndpoint();
  const reading = host.route();

  // Rotating the legacy project base key is a project-level admin action,
  // gated on `project:manage` (same gate as the regenerateApiKey mutation).
  const canManageProject = host.hasPermission(PROJECT_KEY_ROTATE_PERMISSION);

  const apiKeys = apiKeyApi.apiKey.list.useQuery({ organizationId });
  const myBindings = apiKeyApi.apiKey.myBindings.useQuery({ organizationId });
  const orgProjects = apiKeyApi.apiKey.orgProjects.useQuery({ organizationId });
  const orgTeams = apiKeyApi.apiKey.orgTeams.useQuery({ organizationId });
  const orgMembers = apiKeyApi.apiKey.orgMembers.useQuery({ organizationId });
  // An empty member list is how the page knows the reader is not an
  // organization admin: the procedure answers `[]` for everybody else.
  const isAdmin = (orgMembers.data?.length ?? 0) > 0;
  const createMutation = apiKeyApi.apiKey.create.useMutation();
  const updateMutation = apiKeyApi.apiKey.update.useMutation();
  const revokeMutation = apiKeyApi.apiKey.revoke.useMutation();
  const regenerateMutation = apiKeyApi.project.regenerateApiKey.useMutation();
  const queryClient = apiKeyApi.useUtils();

  const { open: isCreateOpen, onOpen: onCreateOpen, onClose: onCreateClose } = useDisclosure();

  const [newToken, setNewToken] = useState<string | null>(null);
  const [newKeyInput, setNewKeyInput] = useState<CreateApiKeyInput | null>(null);
  const [apiKeyToRevoke, setApiKeyToRevoke] = useState<string | null>(null);
  const [apiKeyToEdit, setApiKeyToEdit] = useState<ApiKeyRow | null>(null);
  const [isRotateConfirmOpen, setIsRotateConfirmOpen] = useState(false);

  // The scopes the reader can see: the filter's options, and the names the
  // per-row chips resolve their ids to.
  const filterAvailable = host.availableScopes();
  const hierarchy = useMemo(() => scopeHierarchyOf(filterAvailable), [filterAvailable]);

  // READ from the address rather than mirrored into state: the platform hook
  // kept a `useState` synced to `?scope=` by an effect, and a mirror can only
  // ever disagree with the URL it is mirroring. The data-governance and
  // model-provider families made the same correction.
  const scopeFilter = useMemo(
    () =>
      scopeFilterFromAddress({
        raw: reading.query[API_KEY_SCOPE_QUERY_KEY],
        available: filterAvailable,
      }),
    [reading.query, filterAvailable],
  );

  const handleScopeFilterChange = (next: ScopeFilterValue) => {
    const write = scopeFilterAddressWrite(next, {
      teamId: scope.teamId,
      projectId: scope.projectId,
    });
    if (write.kind === "keep") return;
    host.setQuery({
      ...reading.query,
      [API_KEY_SCOPE_QUERY_KEY]: write.kind === "clear" ? void 0 : write.value,
    });
  };

  // Split ingestion keys (ingest-only, CLI-minted, project-scoped write
  // credentials carrying a non-null ingestSourceType) from regular personal /
  // service API keys. They render in two separate labeled sections. `!= null`
  // catches both null and undefined so keys without the field stay in the
  // regular list.
  const allApiKeys = useMemo(() => apiKeys.data ?? [], [apiKeys.data]);
  const ingestionKeys = useMemo(
    () => allApiKeys.filter((k) => k.ingestSourceType != null),
    [allApiKeys],
  );
  const serviceApiKeys = useMemo(
    () => allApiKeys.filter((k) => k.ingestSourceType == null),
    [allApiKeys],
  );

  // Client-side filter: map each regular key's grants → scopes so the
  // shared inclusive cascade applies directly. The scope filter only governs
  // the regular API keys section.
  const filteredKeys = useMemo(
    () =>
      filterRowsByScope(
        serviceApiKeys.map((k) => ({
          ...k,
          scopes: k.grants.map((rb) => ({
            scopeType: rb.scopeType,
            scopeId: rb.scopeId,
          })),
        })),
        scopeFilter,
        {
          hierarchy,
          currentTeamId: scope.teamId,
          currentProjectId: scope.projectId,
        },
      ),
    [serviceApiKeys, scopeFilter, hierarchy, scope.teamId, scope.projectId],
  );

  // Deep links land on `#api-key-<id>`, but the rows only exist once the keys
  // query resolves, long after the browser has given up on the fragment.
  const isLoadingKeys = apiKeys.isLoading;
  const anchorId = reading.fragment;
  useEffect(() => {
    if (isLoadingKeys || !anchorId || typeof document === "undefined") return;
    document.getElementById(anchorId)?.scrollIntoView({ block: "center" });
  }, [isLoadingKeys, anchorId]);

  const handleCreate = (input: CreateApiKeyInput): void => {
    const problem = createInputProblem(input);
    if (problem) {
      host.failed({ error: void 0, ...problem });
      return;
    }

    createMutation.mutate(
      {
        organizationId,
        name: input.name,
        description: input.description.trim() || undefined,
        expiresAt: input.expiresAt && toDate(input.expiresAt),
        permissionMode: input.permissionMode,
        keyType: input.keyType,
        assignedToUserId: input.assignedToUserId,
        permissions: input.permissions,
        bindings: input.bindings,
      },
      {
        onSuccess: (result) => {
          setNewToken(result.token);
          setNewKeyInput(input);
          void queryClient.apiKey.list.invalidate();
        },
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't create API key" }),
      },
    );
  };

  const handleUpdate = (input: {
    apiKeyId: string;
    name?: string;
    description?: string | null;
    permissionMode?: "all" | "readonly" | "restricted";
    permissions?: string[];
    bindings?: ApiKeyTrpcGrant[];
  }) => {
    updateMutation.mutate(
      {
        organizationId,
        apiKeyId: input.apiKeyId,
        name: input.name,
        description: input.description,
        permissionMode: input.permissionMode,
        permissions: input.permissions,
        bindings: input.bindings,
      },
      {
        onSuccess: () => {
          setApiKeyToEdit(null);
          host.succeeded({ title: "API key updated" });
          void queryClient.apiKey.list.invalidate();
        },
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't update API key" }),
      },
    );
  };

  const handleRevoke = (apiKeyId: string) => {
    revokeMutation.mutate(
      { organizationId, apiKeyId },
      {
        onSuccess: () => {
          setApiKeyToRevoke(null);
          host.succeeded({ title: "API key revoked" });
          void queryClient.apiKey.list.invalidate();
        },
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't revoke API key" }),
      },
    );
  };

  // Rotate the legacy project base key. The mutation does a single atomic
  // update + audit log server-side, so on success the previous key is already
  // dead; we surface the fresh key once via the existing TokenCreatedDialog
  // (driven by `newToken`) and refresh the row that sources `project.apiKey`.
  const handleRotateProjectKey = () => {
    if (!scope.projectId) return;
    regenerateMutation.mutate(
      { projectId: scope.projectId },
      {
        onSuccess: (res) => {
          setIsRotateConfirmOpen(false);
          setNewToken(res.apiKey);
          void queryClient.organization.getAll.invalidate();
          host.succeeded({
            title: "Project API key rotated",
            description: "The previous key no longer works. Update your integrations.",
          });
        },
        onError: (error) => {
          setIsRotateConfirmOpen(false);
          host.failed({ error, fallbackTitle: "Couldn't rotate the project API key" });
        },
      },
    );
  };

  const projectApiKey = scope.projectApiKey;

  // Decide whether the legacy project service key survives the active scope
  // filter by running it through the same inclusive cascade as user-scoped keys.
  // A fake row with a single PROJECT-scoped binding is synthesised so the same
  // predicate can decide. Intent: keep the cascade rules in ONE place - not a
  // hack to bypass typing.
  const showProjectKey: boolean = useMemo(() => {
    if (!projectApiKey || !scope.projectId) return false;
    const fakeRow = {
      scopes: [{ scopeType: "PROJECT" as const, scopeId: scope.projectId }],
    };
    return (
      filterRowsByScope([fakeRow], scopeFilter, {
        hierarchy,
        currentTeamId: scope.teamId,
        currentProjectId: scope.projectId,
      }).length > 0
    );
  }, [projectApiKey, scope.projectId, scope.teamId, scopeFilter, hierarchy]);

  const getScopeBadge = (apiKeyRow: ApiKeyRow) => {
    return (
      <ProviderScopeChips
        size="xs"
        scopes={apiKeyRow.grants.map((rb) => ({
          scopeType: rb.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
          scopeId: rb.scopeId,
          name: rb.scopeName ?? undefined,
        }))}
      />
    );
  };

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>API Keys</PageLayout.Heading>
        <Spacer />
        <ScopeFilter
          value={scopeFilter}
          onChange={handleScopeFilterChange}
          available={filterAvailable}
          currentTeamId={scope.teamId}
          currentProjectId={scope.projectId}
        />
        <PageLayout.HeaderButton onClick={onCreateOpen} data-testid="api-key-create">
          <Plus size={16} />
          Create new secret key
        </PageLayout.HeaderButton>
      </PageLayout.Header>
      <VStack gap={4} width="full" align="stretch" paddingTop={4}>
        <Text fontSize="sm" color="fg.muted">
          Manage credentials used to authenticate with the LangWatch API.
        </Text>

        <VStack gap={8} width="full" align="stretch">
          {/* Personal + service keys (ingestSourceType == null). The page
            heading titles this table, so the section carries no heading of
            its own. The "Create API key" flow and scope filter sit in the header. */}
          <VStack gap={4} width="full" align="start">
            <HStack width="full" flexWrap="wrap" gap={2}>
              <Text fontSize="sm" color="fg.muted">
                Do not share your API keys or expose them in the browser or other client-side code.
              </Text>
            </HStack>

            <Card.Root width="full" overflow="hidden">
              <Card.Body paddingY={0} paddingX={0} overflowX="auto">
                <Table.Root variant="line" size="md" width="full">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>Name</Table.ColumnHeader>
                      <Table.ColumnHeader>Status</Table.ColumnHeader>
                      <Table.ColumnHeader whiteSpace="nowrap">Secret key</Table.ColumnHeader>
                      <Table.ColumnHeader>Created</Table.ColumnHeader>
                      <Table.ColumnHeader whiteSpace="nowrap">Last used</Table.ColumnHeader>
                      <Table.ColumnHeader>Type</Table.ColumnHeader>
                      <Table.ColumnHeader>Scope</Table.ColumnHeader>
                      <Table.ColumnHeader>Permissions</Table.ColumnHeader>
                      <Table.ColumnHeader width="100px"></Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {/* Project service key row - shown only if it survives the scope filter */}
                    {showProjectKey && projectApiKey && (
                      <ProjectKeyRow
                        apiKey={projectApiKey}
                        projectId={scope.projectId ?? ""}
                        projectName={scope.projectName}
                        canManage={canManageProject}
                        host={host}
                        onRotate={() => setIsRotateConfirmOpen(true)}
                      />
                    )}

                    {/* User-scoped API key rows */}
                    {filteredKeys.map((apiKey) => (
                      <ApiKeyTableRow
                        key={apiKey.id}
                        apiKey={apiKey}
                        scopeBadge={getScopeBadge(apiKey)}
                        canModify={isAdmin || apiKey.userId === currentUserId}
                        onEdit={setApiKeyToEdit}
                        onRevoke={setApiKeyToRevoke}
                      />
                    ))}

                    {filteredKeys.length === 0 && !showProjectKey && (
                      <NoKeysRow filtered={scopeFilter.kind !== "all"} />
                    )}
                  </Table.Body>
                </Table.Root>
              </Card.Body>
            </Card.Root>
          </VStack>

          {/* Ingestion keys render below the API keys table. */}
          <IngestionKeysSection
            keys={ingestionKeys}
            isAdmin={isAdmin}
            onRevoke={setApiKeyToRevoke}
          />
        </VStack>

        <CreateApiKeyDrawer
          isOpen={isCreateOpen && !newToken}
          isCreating={createMutation.isPending}
          myBindings={myBindings}
          orgProjects={orgProjects.data ?? []}
          orgTeams={orgTeams.data ?? []}
          organizationId={organizationId}
          organizationName={scope.organizationName}
          currentTeamId={scope.teamId}
          currentProjectId={scope.projectId}
          onClose={onCreateClose}
          onCreate={handleCreate}
        />

        <EditApiKeyDrawer
          apiKey={apiKeyToEdit}
          isUpdating={updateMutation.isPending}
          myBindings={myBindings}
          orgProjects={orgProjects.data ?? []}
          orgTeams={orgTeams.data ?? []}
          organizationId={organizationId}
          organizationName={scope.organizationName}
          currentTeamId={scope.teamId}
          currentProjectId={scope.projectId}
          onClose={() => setApiKeyToEdit(null)}
          onSave={handleUpdate}
        />

        <TokenCreatedDialog
          newToken={newToken}
          projectId={scope.projectId}
          endpoint={endpoint}
          orgProjects={(orgProjects.data ?? []).filter((project) =>
            isProjectReachable({ project, keyInput: newKeyInput }),
          )}
          onClose={() => {
            setNewToken(null);
            setNewKeyInput(null);
            onCreateClose();
          }}
        />

        <RevokeConfirmDialog
          apiKeyId={apiKeyToRevoke}
          isRevoking={revokeMutation.isPending}
          onCancel={() => setApiKeyToRevoke(null)}
          onConfirm={handleRevoke}
        />

        <RegenerateApiKeyDialog
          open={isRotateConfirmOpen}
          isLoading={regenerateMutation.isPending}
          onClose={() => setIsRotateConfirmOpen(false)}
          onConfirm={handleRotateProjectKey}
        />
      </VStack>
    </>
  );
}
