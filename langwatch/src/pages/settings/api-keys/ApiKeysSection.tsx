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
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import { Tooltip } from "../../../components/ui/tooltip";
import { Clipboard, Key, Pencil, Plus, Trash2 } from "lucide-react";
import { PageLayout } from "../../../components/ui/layouts/PageLayout";
import { useMemo, useState } from "react";
import { toaster } from "../../../components/ui/toaster";
import { usePublicEnv } from "../../../hooks/usePublicEnv";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { useSession } from "~/utils/auth-client";
import { api, type RouterOutputs } from "../../../utils/api";
import { formatTimeAgo } from "../../../utils/formatTimeAgo";
import { ProviderScopeChips } from "../../../components/settings/ProviderScopeChips";
import { ScopeFilter as ScopeFilterComponent } from "~/components/settings/ScopeFilter";
import { useAvailableScopes } from "~/hooks/useAvailableScopes";
import { useUrlScopeFilter } from "~/hooks/useUrlScopeFilter";
import { filterProvidersByScope } from "~/utils/filterProvidersByScope";
import { CreateApiKeyDrawer, type CreateApiKeyInput } from "./CreateApiKeyDrawer";
import { EditApiKeyDrawer } from "./EditApiKeyDrawer";
import { IngestionKeysSection } from "./IngestionKeysSection";
import { RevokeConfirmDialog } from "./RevokeConfirmDialog";
import { TokenCreatedDialog } from "./TokenCreatedDialog";

type ApiKeyRow = RouterOutputs["apiKey"]["list"][number];

function ProjectKeyActions({ apiKey }: { apiKey: string }) {
  return (
    <Button
      size="xs"
      variant="ghost"
      aria-label="Copy secret key"
      onClick={() => {
        void navigator.clipboard.writeText(apiKey);
        toaster.create({
          title: "API key copied to clipboard",
          type: "success",
          duration: 2000,
          meta: { closable: true },
        });
      }}
    >
      <Clipboard size={14} />
    </Button>
  );
}

/**
 * Unified API Keys table. Shows all user-scoped API keys plus the legacy
 * project key in one flat list. Admins see all keys in the org.
 *
 * The scope filter in the header narrows the visible rows using the same
 * inclusive cascade as the model-providers page. Selecting a scope shows
 * all keys whose ANY binding sits on the same branch of the org tree as
 * the active filter — parents up, children down.
 *
 * Filter selection is persisted in the URL via `?scope=TYPE:id` so it
 * survives reloads and can be deep-linked.
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
  const { project, team, organization } = useOrganizationTeamProject();
  const endpoint = publicEnv.data?.BASE_HOST ?? "https://app.langwatch.ai";

  const apiKeys = api.apiKey.list.useQuery({ organizationId });
  const myBindings = api.apiKey.myBindings.useQuery({ organizationId });
  const orgProjects = api.apiKey.orgProjects.useQuery({ organizationId });
  const orgTeams = api.apiKey.orgTeams.useQuery({ organizationId });
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
  const [newKeyInput, setNewKeyInput] = useState<CreateApiKeyInput | null>(null);
  const [apiKeyToRevoke, setApiKeyToRevoke] = useState<string | null>(null);
  const [apiKeyToEdit, setApiKeyToEdit] = useState<ApiKeyRow | null>(null);

  // Derive available scopes (and org-tree hierarchy) for the filter dropdown
  // from the organization graph.
  const filterAvailable = useAvailableScopes(organization);
  const { hierarchy } = filterAvailable;

  // Scope filter — defaults to "all", persisted in URL as ?scope=TYPE:id.
  // URL hydration and setter are shared with the model-providers page.
  const [scopeFilter, handleScopeFilterChange] = useUrlScopeFilter({
    filterAvailable,
    teamId: team?.id,
    projectId: project?.id,
  });

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

  // Client-side filter: map each regular key's roleBindings → scopes so
  // filterProvidersByScope can apply its inclusive cascade directly. The scope
  // filter only governs the regular API keys section.
  const filteredKeys = useMemo(
    () =>
      filterProvidersByScope(
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
          currentTeamId: team?.id,
          currentProjectId: project?.id,
        },
      ),
    [serviceApiKeys, scopeFilter, hierarchy, team?.id, project?.id],
  );

  const handleCreate = (input: CreateApiKeyInput): void => {
    if (input.permissionMode === "restricted" && input.bindings.length === 0) {
      toaster.create({
        title: "No scopes selected",
        description:
          "Select at least one scope for a restricted key.",
        type: "error",
        duration: 5000,
        meta: { closable: true },
      });
      return;
    }
    if (input.keyType === "personal" && input.permissionMode !== "restricted" && input.bindings.length === 0) {
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
        permissions: input.permissions,
        bindings: input.bindings as Parameters<typeof createMutation.mutate>[0]["bindings"],
      },
      {
        onSuccess: (result) => {
          setNewToken(result.token);
          setNewKeyInput(input);
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
    permissions?: string[];
    bindings?: Array<{
      role: string;
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
        permissions: input.permissions,
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

  // Build unified rows: API keys + project service key
  const projectApiKey = project?.apiKey;

  // Decide whether the legacy project service key survives the active scope
  // filter by running it through the same inclusive cascade as user-scoped keys.
  // A fake row with a single PROJECT-scoped binding is synthesised so the same
  // filterProvidersByScope logic can decide.
  const showProjectKey: boolean = useMemo(() => {
    if (!projectApiKey || !project?.id) return false;
    // Synthesize a single-binding row so the project-service-key row reuses the
    // same inclusive cascade predicate (`filterProvidersByScope`) as the table.
    // Intent: keep the cascade rules in ONE place — not a hack to bypass typing.
    const fakeRow = {
      scopes: [{ scopeType: "PROJECT" as const, scopeId: project.id }],
    };
    return filterProvidersByScope([fakeRow], scopeFilter, {
      hierarchy,
      currentTeamId: team?.id,
      currentProjectId: project?.id,
    }).length > 0;
  }, [projectApiKey, project?.id, scopeFilter, hierarchy, team?.id]);

  const getStatus = (key: ApiKeyRow) => {
    if (key.expiresAt && new Date(key.expiresAt) < new Date()) return "Expired";
    return "Active";
  };

  const getPermissionBadge = (apiKeyRow: ApiKeyRow) => {
    if (apiKeyRow.permissionMode === "all") {
      return <Badge size="sm" colorPalette="green">All</Badge>;
    }
    return <Badge size="sm" colorPalette="orange">Restricted</Badge>;
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
    <>
      <VStack gap={8} width="full" align="stretch">
        {/* API keys — personal + service keys (ingestSourceType == null).
            The "Create API key" flow and scope filter belong to this section. */}
        <VStack gap={4} width="full" align="start">
        {ingestionKeys.length > 0 && (
          <VStack gap={1} align="start">
            <Heading size="md">API keys</Heading>
            <Text fontSize="sm" color="fg.muted">
              Keys scoped to a user or service that honor your role bindings and
              can be revoked individually.
            </Text>
          </VStack>
        )}
        <HStack width="full" flexWrap="wrap" gap={2}>
          <Text fontSize="sm" color="fg.muted">
            Do not share your API keys or expose them in the browser or other
            client-side code.
          </Text>
          <Spacer />
          {/* Scope filter — right side of header row, before the Create button.
              Mirrors the layout of the model-providers page. */}
          <ScopeFilterComponent
            value={scopeFilter}
            onChange={handleScopeFilterChange}
            available={filterAvailable}
            currentTeamId={team?.id}
            currentProjectId={project?.id}
          />
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
                      <Badge size="sm" colorPalette="green">Active</Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <Text fontSize="xs" fontFamily="monospace" color="fg.muted">
                        sk-…{projectApiKey.slice(-4)}
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
                      {/* Name the project this legacy key is fixed to, using
                          the same named scope chip as the user-scoped rows. */}
                      <ProviderScopeChips
                        size="xs"
                        scopes={[
                          {
                            scopeType: "PROJECT",
                            scopeId: project?.id ?? "",
                            name: project?.name,
                          },
                        ]}
                      />
                    </Table.Cell>
                    <Table.Cell>
                      <Badge size="sm" colorPalette="green">All</Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <ProjectKeyActions apiKey={projectApiKey} />
                    </Table.Cell>
                  </Table.Row>
                )}

                {/* User-scoped API key rows */}
                {filteredKeys.map((apiKey) => (
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
                        <Text fontSize="sm" color="fg.muted">Never</Text>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      {apiKey.userId ? (
                        <Badge size="sm" variant="outline">
                          {apiKey.userEmail ?? apiKey.userName ?? "—"}
                        </Badge>
                      ) : (
                        <Badge size="sm" colorPalette="purple">Service</Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      {getScopeBadge(apiKey)}
                    </Table.Cell>
                    <Table.Cell>
                      {getPermissionBadge(apiKey)}
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
                        No keys match the current scope. Change the filter above to
                        see other keys.
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
        <IngestionKeysSection
          keys={ingestionKeys}
          isAdmin={isAdmin}
          onRevoke={setApiKeyToRevoke}
        />
      </VStack>

      <CreateApiKeyDrawer
        isOpen={isCreateOpen && !newToken}
        isCreating={createMutation.isLoading}
        myBindings={myBindings}
        orgProjects={orgProjects.data ?? []}
        orgTeams={orgTeams.data ?? []}
        organizationId={organizationId}
        organizationName={organization?.name}
        currentTeamId={team?.id}
        currentProjectId={project?.id}
        onClose={onCreateClose}
        onCreate={handleCreate}
      />

      <EditApiKeyDrawer
        apiKey={apiKeyToEdit}
        isUpdating={updateMutation.isLoading}
        myBindings={myBindings}
        orgProjects={orgProjects.data ?? []}
        orgTeams={orgTeams.data ?? []}
        organizationId={organizationId}
        organizationName={organization?.name}
        currentTeamId={team?.id}
        currentProjectId={project?.id}
        onClose={() => setApiKeyToEdit(null)}
        onSave={handleUpdate}
      />

      <TokenCreatedDialog
        newToken={newToken}
        projectId={projectId}
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
        isRevoking={revokeMutation.isLoading}
        onCancel={() => setApiKeyToRevoke(null)}
        onConfirm={handleRevoke}
      />
    </>
  );
}
