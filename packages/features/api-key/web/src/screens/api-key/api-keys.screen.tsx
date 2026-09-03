/**
 * Settings > API Keys. One table of every credential that can talk to the
 * LangWatch API, plus the ingestion keys the CLI mints.
 *
 * Moved from `platform/app/src/pages/settings/api-keys/{index,ApiKeysSection}.tsx`,
 * which were a page shell and the component it rendered; the shell was
 * `SettingsLayout` plus a heading, and the layout is now
 * `apps/ui`'s `withUiSettingsLayout` around this screen, so the two collapse
 * into one.
 *
 * ## Credential hygiene, which is what this family is about
 *
 *  - **Nothing on this page's reads carries a key.** `apiKey.list` answers
 *    `ApiKeyListEntry`, whose `lookupIdPrefix` is five characters of the PUBLIC
 *    lookup id — which is why the table can render `sk-lw-<prefix>…` and can
 *    never render more, however the row is styled.
 *  - **Two surfaces here hold a real credential and both are mints.** Creating a
 *    key and rotating the legacy project key each answer a value once, and both
 *    go straight into `TokenCreatedDialog`, the one-time reveal. Closing it
 *    clears the state and no read can bring the value back.
 *  - **The legacy project key is the one exception, and it predates this move.**
 *    `project.apiKey` has always travelled to the browser inside the
 *    organization graph the shell holds; the row shows `sk-…` plus four
 *    characters and offers a copy action. Nothing here widens that, and the port
 *    says so where the value is declared.
 *
 * ## The page-level policy, unchanged
 *
 * NEITHER THE PLATFORM PAGE NOR THIS SCREEN CARRIES A PAGE-LEVEL GRANT. The page
 * was `SettingsLayout` and nothing else — no `withPermissionGuard`, no flag —
 * and it decides what a reader may DO from two things it reads inline: whether
 * `apiKey.orgMembers` answered anything (an organization admin, and nobody else,
 * gets a non-empty list) and `project:manage` for the legacy key's rotation.
 * A member sees their own keys and no edit controls on anybody else's, which is
 * the product's own answer and not one a move may change.
 */

import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Spacer,
  Table,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import type { ApiKeyListEntry } from "@langwatch/api-key-contract";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Clipboard, Key, Pencil, Plus, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiKeyApi } from "../../behavior/api-key-api";
import { apiKeyRowAnchorId } from "../../model/api-key-anchor";
import { useApiKeyHost, type ApiKeyHostPort } from "../../model/api-key-host";
import {
  filterRowsByScope,
  scopeFilterAddressWrite,
  scopeFilterFromAddress,
  scopeHierarchyOf,
  type ScopeFilterValue,
} from "../../model/api-key-scope-filter";
import { formatTimeAgo } from "../../model/format-time-ago";
import { ProviderScopeChips, ScopeFilter } from "../../ui/elements/scope-picker";
import { IngestionKeysSection } from "../../ui/blocks/ingestion-keys-section";
import { RevokeConfirmDialog } from "../../ui/blocks/revoke-confirm-dialog";
import {
  CreateApiKeyDrawer,
  type CreateApiKeyInput,
} from "../../ui/sections/create-api-key-drawer";
import { EditApiKeyDrawer } from "../../ui/sections/edit-api-key-drawer";
import { RegenerateApiKeyDialog } from "../../ui/sections/regenerate-api-key-dialog";
import { TokenCreatedDialog } from "../../ui/sections/token-created-dialog";

/** The `?scope=` parameter this page's filter is written to. */
export const API_KEY_SCOPE_QUERY_KEY = "scope";

/** The grant the legacy project key's rotation control is behind. */
export const PROJECT_KEY_ROTATE_PERMISSION = "project:manage";

type ApiKeyRow = ApiKeyListEntry;

/**
 * Actions for the legacy "Project API Key" row. The row intentionally has no
 * edit/revoke affordance — the only mutating action is rotation, and only when
 * the viewer can manage the project (`project:manage`). Rotation is the
 * supported, audited replacement for the base key that the unified-keys rework
 * removed.
 */
function ProjectKeyActions({
  apiKey,
  canManage,
  host,
  onRotate,
}: {
  apiKey: string;
  canManage: boolean;
  host: ApiKeyHostPort;
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
  const allApiKeys = apiKeys.data ?? [];
  const ingestionKeys = useMemo(
    () => allApiKeys.filter((k) => k.ingestSourceType != null),
    [allApiKeys],
  );
  const serviceApiKeys = useMemo(
    () => allApiKeys.filter((k) => k.ingestSourceType == null),
    [allApiKeys],
  );

  // Client-side filter: map each regular key's roleBindings → scopes so the
  // shared inclusive cascade applies directly. The scope filter only governs
  // the regular API keys section.
  const filteredKeys = useMemo(
    () =>
      filterRowsByScope(
        serviceApiKeys.map((k) => ({
          ...k,
          scopes: k.roleBindings.map((rb) => ({
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
    if (input.permissionMode === "restricted" && input.bindings.length === 0) {
      host.failed({
        error: void 0,
        fallbackTitle: "No scopes selected",
        description: "Select at least one scope for a restricted key.",
      });
      return;
    }
    if (
      input.keyType === "personal" &&
      input.permissionMode !== "restricted" &&
      input.bindings.length === 0
    ) {
      host.failed({
        error: void 0,
        fallbackTitle: "No permissions to grant",
        description:
          "You have no role bindings in this organization, so there is nothing to grant to a key.",
      });
      return;
    }

    createMutation.mutate(
      {
        organizationId,
        name: input.name,
        description: input.description.trim() ? input.description.trim() : undefined,
        expiresAt: input.expiresAt,
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
    bindings?: Array<{ role: string; scopeType: string; scopeId: string }>;
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
  // predicate can decide. Intent: keep the cascade rules in ONE place — not a
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

  const getStatus = (key: ApiKeyRow) => {
    if (key.expiresAt && new Date(key.expiresAt) < new Date()) return "Expired";
    return "Active";
  };

  const getPermissionBadge = (apiKeyRow: ApiKeyRow) => {
    if (apiKeyRow.permissionMode === "all") {
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
  };

  const getScopeBadge = (apiKeyRow: ApiKeyRow) => {
    return (
      <ProviderScopeChips
        size="xs"
        scopes={apiKeyRow.roleBindings.map((rb) => ({
          scopeType: rb.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
          scopeId: rb.scopeId,
          name: rb.scopeName ?? undefined,
        }))}
      />
    );
  };

  return (
    <VStack gap={4} width="full" maxWidth="1200px" align="stretch">
      <VStack gap={1} align="start">
        <Heading size="lg">API Keys</Heading>
        <Text fontSize="sm" color="fg.muted">
          Manage credentials used to authenticate with the LangWatch API.
        </Text>
      </VStack>

      <VStack gap={8} width="full" align="stretch">
        {/* Personal + service keys (ingestSourceType == null). The page
            heading titles this table, so the section carries no heading of
            its own. The "Create API key" flow and scope filter belong here. */}
        <VStack gap={4} width="full" align="start">
          <HStack width="full" flexWrap="wrap" gap={2}>
            <Text fontSize="sm" color="fg.muted">
              Do not share your API keys or expose them in the browser or other client-side code.
            </Text>
            <Spacer />
            <ScopeFilter
              value={scopeFilter}
              onChange={handleScopeFilterChange}
              available={filterAvailable}
              currentTeamId={scope.teamId}
              currentProjectId={scope.projectId}
            />
            <PageLayout.HeaderButton onClick={onCreateOpen}>
              <Plus size={16} />
              Create new secret key
            </PageLayout.HeaderButton>
          </HStack>

          <Card.Root width="full" overflow="hidden">
            <Card.Body paddingY={0} paddingX={0} overflowX="auto">
              <Table.Root variant="line" size="md" width="full">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Name</Table.ColumnHeader>
                    <Table.ColumnHeader>Status</Table.ColumnHeader>
                    <Table.ColumnHeader>Secret Key</Table.ColumnHeader>
                    <Table.ColumnHeader>Created</Table.ColumnHeader>
                    <Table.ColumnHeader>Last Used</Table.ColumnHeader>
                    <Table.ColumnHeader>Type</Table.ColumnHeader>
                    <Table.ColumnHeader>Scope</Table.ColumnHeader>
                    <Table.ColumnHeader>Permissions</Table.ColumnHeader>
                    <Table.ColumnHeader width="100px"></Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {/* Project service key row — only shown when it survives the active scope filter */}
                  {showProjectKey && projectApiKey && (
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
                          sk-…{projectApiKey.slice(-4)}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Text fontSize="sm" color="fg.muted">
                          —
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Text fontSize="sm" color="fg.muted">
                          —
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
                              scopeId: scope.projectId ?? "",
                              name: scope.projectName,
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
                        <ProjectKeyActions
                          apiKey={projectApiKey}
                          canManage={canManageProject}
                          host={host}
                          onRotate={() => setIsRotateConfirmOpen(true)}
                        />
                      </Table.Cell>
                    </Table.Row>
                  )}

                  {/* User-scoped API key rows */}
                  {filteredKeys.map((apiKey) => (
                    <Table.Row key={apiKey.id} id={apiKeyRowAnchorId(apiKey.id)}>
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
                          <Text fontSize="sm" color="fg.muted">
                            Never
                          </Text>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        {apiKey.userId ? (
                          <Badge size="sm" variant="outline">
                            {apiKey.userEmail ?? apiKey.userName ?? "—"}
                          </Badge>
                        ) : (
                          <Badge size="sm" colorPalette="purple">
                            Service
                          </Badge>
                        )}
                      </Table.Cell>
                      <Table.Cell>{getScopeBadge(apiKey)}</Table.Cell>
                      <Table.Cell>{getPermissionBadge(apiKey)}</Table.Cell>
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

                  {filteredKeys.length === 0 && !showProjectKey && scopeFilter.kind === "all" && (
                    <Table.Row>
                      <Table.Cell colSpan={9}>
                        <Text color="fg.muted" textAlign="center" paddingY={4}>
                          No API keys. Create one to get started.
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  )}
                  {filteredKeys.length === 0 && !showProjectKey && scopeFilter.kind !== "all" && (
                    <Table.Row>
                      <Table.Cell colSpan={9}>
                        <Text color="fg.muted" textAlign="center" paddingY={4}>
                          No keys match the current scope. Change the filter above to see other
                          keys.
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  )}
                </Table.Body>
              </Table.Root>
            </Card.Body>
          </Card.Root>
        </VStack>

        {/* Ingestion keys render below the API keys table. */}
        <IngestionKeysSection keys={ingestionKeys} isAdmin={isAdmin} onRevoke={setApiKeyToRevoke} />
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
        orgProjects={(orgProjects.data ?? []).filter((p) => {
          if (!newKeyInput) return true;
          if (newKeyInput.keyType === "service") return true;
          if (newKeyInput.permissionMode !== "restricted") return true;
          return newKeyInput.bindings.some((b) => b.scopeId === p.id);
        })}
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
  );
}
