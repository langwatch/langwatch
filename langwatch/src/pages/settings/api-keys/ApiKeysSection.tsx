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
import { Clipboard, Key, Pencil, Plus, Trash2 } from "lucide-react";
import { PageLayout } from "../../../components/ui/layouts/PageLayout";
import { useEffect, useMemo, useState } from "react";
import { toaster } from "../../../components/ui/toaster";
import { usePublicEnv } from "../../../hooks/usePublicEnv";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { useSession } from "~/utils/auth-client";
import { api, type RouterOutputs } from "../../../utils/api";
import { formatTimeAgo } from "../../../utils/formatTimeAgo";
import { ProviderScopeChips } from "../../../components/settings/ProviderScopeChips";
import {
  ScopeFilter as ScopeFilterComponent,
  type ScopeFilter as PageScopeFilter,
} from "~/components/settings/ScopeFilter";
import { useAvailableScopes } from "~/hooks/useAvailableScopes";
import {
  filterProvidersByScope,
  type ScopeHierarchy,
} from "~/utils/filterProvidersByScope";
import { useRouter } from "~/utils/compat/next-router";
import { CreateApiKeyDrawer, type CreateApiKeyInput } from "./CreateApiKeyDrawer";
import { EditApiKeyDrawer } from "./EditApiKeyDrawer";
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
  const router = useRouter();

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

  // Scope filter — defaults to "all", persisted in URL as ?scope=TYPE:id
  const [scopeFilter, setScopeFilter] = useState<PageScopeFilter>({
    kind: "all",
  });

  // Derive available scopes for the filter dropdown from the organization graph.
  const filterAvailable = useAvailableScopes(organization);

  // Hydrate scope filter from ?scope=TYPE:id URL param (mirrors model-providers).
  useEffect(() => {
    const raw = router.query.scope;
    if (typeof raw !== "string") return;
    const sepIdx = raw.indexOf(":");
    if (sepIdx <= 0 || sepIdx === raw.length - 1) return;
    const scopeType = raw.slice(0, sepIdx);
    const scopeId = raw.slice(sepIdx + 1);
    if (
      scopeType !== "ORGANIZATION" &&
      scopeType !== "TEAM" &&
      scopeType !== "PROJECT"
    )
      return;
    let name: string | undefined;
    if (scopeType === "ORGANIZATION") {
      name =
        filterAvailable.organization?.id === scopeId
          ? filterAvailable.organization.name
          : undefined;
    } else if (scopeType === "TEAM") {
      name = filterAvailable.teams.find((t) => t.id === scopeId)?.name;
    } else {
      name = filterAvailable.projects.find((p) => p.id === scopeId)?.name;
    }
    if (name !== undefined) {
      setScopeFilter({
        kind: "specific",
        scopeType,
        scopeId,
        name,
      } as PageScopeFilter);
    } else {
      setScopeFilter({
        kind: "specific",
        scopeType,
        scopeId,
      } as PageScopeFilter);
    }
  }, [router.query.scope, filterAvailable]);

  // Persist scope filter changes to URL.
  const handleScopeFilterChange = (next: PageScopeFilter) => {
    setScopeFilter(next);
    if (next.kind === "all") {
      const { scope: _scope, ...rest } = router.query as Record<string, string>;
      void router.replace({ query: rest });
    } else if (next.kind === "team-current" && team?.id) {
      void router.replace({ query: { ...router.query, scope: `TEAM:${team.id}` } });
    } else if (next.kind === "project-current" && project?.id) {
      void router.replace({
        query: { ...router.query, scope: `PROJECT:${project.id}` },
      });
    } else if (next.kind === "specific") {
      void router.replace({
        query: { ...router.query, scope: `${next.scopeType}:${next.scopeId}` },
      });
    }
  };

  // Org-tree hierarchy for filterProvidersByScope cascade logic.
  const hierarchy: ScopeHierarchy = useMemo(
    () => ({
      organization: organization ? { id: organization.id } : null,
      teams: filterAvailable.teams.map((t) => ({ id: t.id })),
      projects: filterAvailable.projects.map((p) => ({
        id: p.id,
        teamId: p.teamId,
      })),
    }),
    [organization, filterAvailable],
  );

  // Client-side filter: map each key's roleBindings → scopes so
  // filterProvidersByScope can apply its inclusive cascade directly.
  const allApiKeys = apiKeys.data ?? [];
  const filteredKeys = useMemo(
    () =>
      filterProvidersByScope(
        allApiKeys.map((k) => ({
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
    [allApiKeys, scopeFilter, hierarchy, team?.id, project?.id],
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
      <VStack gap={4} width="full" align="start">
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
                      <Badge size="sm" colorPalette="teal">Project</Badge>
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

                {filteredKeys.length === 0 && !projectApiKey && scopeFilter.kind === "all" && (
                  <Table.Row>
                    <Table.Cell colSpan={9}>
                      <Text color="fg.muted" textAlign="center" paddingY={4}>
                        No API keys. Create one to get started.
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                )}
                {filteredKeys.length === 0 && scopeFilter.kind !== "all" && (
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
