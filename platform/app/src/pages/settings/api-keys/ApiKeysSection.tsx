import {
  Card,
  HStack,
  Spacer,
  Spinner,
  Table,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { Key, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ScopeFilter as ScopeFilterComponent } from "~/components/settings/ScopeFilter";
import { SectionErrorNotice } from "~/components/settings/SectionErrorNotice";
import { FilterChips } from "~/components/ui/FilterChips";
import { showErrorToast } from "~/features/errors";
import { useAvailableScopes } from "~/hooks/useAvailableScopes";
import { useUrlScopeFilter } from "~/hooks/useUrlScopeFilter";
import { useSession } from "~/utils/auth-client";
import { filterProvidersByScope } from "~/utils/filterProvidersByScope";
import { RegenerateApiKeyDialog } from "../../../components/settings/RegenerateApiKeyDialog";
import { PageLayout } from "../../../components/ui/layouts/PageLayout";
import { toaster } from "../../../components/ui/toaster";
import { Tooltip } from "../../../components/ui/tooltip";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { usePublicEnv } from "../../../hooks/usePublicEnv";
import { api, type RouterOutputs } from "../../../utils/api";
import {
  ApiKeyAccessBadge,
  ApiKeyLastUsedCell,
  ApiKeyNameCell,
  ApiKeyOwnerCell,
  ApiKeyRowActions,
  ApiKeyScopeCell,
} from "./ApiKeyTableCells";
import { apiKeyRowAnchorId } from "./apiKeyAnchor";
import {
  CreateApiKeyDrawer,
  type CreateApiKeyInput,
} from "./CreateApiKeyDrawer";
import { EditApiKeyDrawer } from "./EditApiKeyDrawer";
import { IngestionKeysSection } from "./IngestionKeysSection";
import { ProjectKeyRow } from "./ProjectKeyRow";
import { RevokeConfirmDialog } from "./RevokeConfirmDialog";
import {
  ALL_SCOPE_KINDS,
  buildScopeKindChips,
  filterKeysByScopeKind,
  keyMatchesScopeKind,
  SCOPE_KIND_OVERLAP_NOTE,
  type ScopeKindFilter,
} from "./scopeKindFilter";
import { TokenCreatedDialog } from "./TokenCreatedDialog";

type ApiKeyRow = RouterOutputs["apiKey"]["list"][number];

/** Number of table columns, so an empty or loading row can span all of them. */
const COLUMN_COUNT = 7;

/** The legacy project key sits on exactly one project, whatever else it is. */
const PROJECT_KEY_BINDINGS = [{ scopeType: "PROJECT" }];

function isExpired(apiKey: Pick<ApiKeyRow, "expiresAt">): boolean {
  return Boolean(apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date());
}

function formatCreatedAt(createdAt: Date | string): string {
  return new Date(createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The credentials table: every personal and service API key the viewer can see,
 * one row each, saying what the key is called, how far it reaches, what it may
 * do, who holds it, and when it was last used.
 *
 * Two filters share one toolbar and compose. The chips pick a LEVEL of the
 * organization tree and carry the count of rows behind each; the scope picker
 * beside them narrows to ONE organization, team, or project using the inclusive
 * cascade shared with the model-providers page and persisted as `?scope=TYPE:id`.
 * The chips count what the picker left, so a chip's number is always the number
 * of rows clicking it produces.
 *
 * Specs: specs/api-keys/api-keys-credentials-table.feature,
 * specs/api-keys/scope-filter.feature, specs/api-keys/unified-api-keys.feature.
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
  const { project, team, organization, hasPermission } =
    useOrganizationTeamProject();
  const endpoint = publicEnv.data?.BASE_HOST ?? "https://app.langwatch.ai";

  // Rotating the legacy project base key is a project-level admin action,
  // gated on `project:manage` (same gate as the regenerateApiKey mutation).
  const canManageProject = hasPermission("project:manage");

  const apiKeys = api.apiKey.list.useQuery({ organizationId });
  const myBindings = api.apiKey.myBindings.useQuery({ organizationId });
  const orgProjects = api.apiKey.orgProjects.useQuery({ organizationId });
  const orgTeams = api.apiKey.orgTeams.useQuery({ organizationId });
  const orgMembers = api.apiKey.orgMembers.useQuery({ organizationId });
  const isAdmin = (orgMembers.data?.length ?? 0) > 0;
  const createMutation = api.apiKey.create.useMutation();
  const updateMutation = api.apiKey.update.useMutation();
  const revokeMutation = api.apiKey.revoke.useMutation();
  const regenerateMutation = api.project.regenerateApiKey.useMutation();
  const queryClient = api.useUtils();

  const {
    open: isCreateOpen,
    onOpen: onCreateOpen,
    onClose: onCreateClose,
  } = useDisclosure();

  const [newToken, setNewToken] = useState<string | null>(null);
  const [newKeyInput, setNewKeyInput] = useState<CreateApiKeyInput | null>(
    null,
  );
  const [apiKeyToRevoke, setApiKeyToRevoke] = useState<string | null>(null);
  const [apiKeyToEdit, setApiKeyToEdit] = useState<ApiKeyRow | null>(null);
  const [isRotateConfirmOpen, setIsRotateConfirmOpen] = useState(false);
  const [scopeKind, setScopeKind] = useState<ScopeKindFilter>(ALL_SCOPE_KINDS);

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
  const allApiKeys = useMemo(() => apiKeys.data ?? [], [apiKeys.data]);
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
  const scopedKeys = useMemo(
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

  // Deep links land on `#api-key-<id>`, but the rows only exist once the keys
  // query resolves, long after the browser has given up on the fragment.
  const isLoadingKeys = apiKeys.isLoading;
  useEffect(() => {
    if (isLoadingKeys || typeof window === "undefined") return;
    const anchorId = window.location.hash.slice(1);
    if (!anchorId) return;
    document.getElementById(anchorId)?.scrollIntoView({ block: "center" });
  }, [isLoadingKeys]);

  const handleCreate = (input: CreateApiKeyInput): void => {
    if (input.permissionMode === "restricted" && input.bindings.length === 0) {
      toaster.create({
        title: "No scopes selected",
        description: "Select at least one scope for a restricted key.",
        type: "error",
        duration: 5000,
      });
      return;
    }
    if (
      input.keyType === "personal" &&
      input.permissionMode !== "restricted" &&
      input.bindings.length === 0
    ) {
      toaster.create({
        title: "No permissions to grant",
        description:
          "You have no role bindings in this organization, so there is nothing to grant to a key.",
        type: "error",
        duration: 5000,
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
        bindings: input.bindings as Parameters<
          typeof createMutation.mutate
        >[0]["bindings"],
      },
      {
        onSuccess: (result) => {
          setNewToken(result.token);
          setNewKeyInput(input);
          void queryClient.apiKey.list.invalidate();
        },
        onError: (error) =>
          showErrorToast({ error, fallbackTitle: "Couldn't create API key" }),
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
        bindings: input.bindings as Parameters<
          typeof updateMutation.mutate
        >[0]["bindings"],
      },
      {
        onSuccess: () => {
          setApiKeyToEdit(null);
          toaster.create({
            title: "API key updated",
            type: "success",
            duration: 3000,
          });
          void queryClient.apiKey.list.invalidate();
        },
        onError: (error) =>
          showErrorToast({ error, fallbackTitle: "Couldn't update API key" }),
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
          });
          void queryClient.apiKey.list.invalidate();
        },
        onError: (error) =>
          showErrorToast({ error, fallbackTitle: "Couldn't revoke API key" }),
      },
    );
  };

  // Rotate the legacy project base key. The mutation does a single atomic
  // update + audit log server-side, so on success the previous key is already
  // dead; we surface the fresh key once via the existing TokenCreatedDialog
  // (driven by `newToken`) and refresh the row that sources `project.apiKey`.
  const handleRotateProjectKey = () => {
    if (!project?.id) return;
    regenerateMutation.mutate(
      { projectId: project.id },
      {
        onSuccess: (res) => {
          setIsRotateConfirmOpen(false);
          setNewToken(res.apiKey);
          void queryClient.organization.getAll.invalidate();
          toaster.create({
            title: "Project API key rotated",
            description:
              "The previous key no longer works. Update your integrations.",
            type: "warning",
            duration: 6000,
          });
        },
        onError: (error) => {
          setIsRotateConfirmOpen(false);
          showErrorToast({
            error,
            fallbackTitle: "Couldn't rotate the project API key",
          });
        },
      },
    );
  };

  const projectApiKey = project?.apiKey;

  // Decide whether the legacy project service key survives the active scope
  // filter by running it through the same inclusive cascade as user-scoped keys.
  // A fake row with a single PROJECT-scoped binding is synthesised so the same
  // filterProvidersByScope logic can decide.
  const projectKeyPassesScope: boolean = useMemo(() => {
    if (!projectApiKey || !project?.id) return false;
    // Synthesize a single-binding row so the project-service-key row reuses the
    // same inclusive cascade predicate (`filterProvidersByScope`) as the table.
    // Intent: keep the cascade rules in ONE place — not a hack to bypass typing.
    const fakeRow = {
      scopes: [{ scopeType: "PROJECT" as const, scopeId: project.id }],
    };
    return (
      filterProvidersByScope([fakeRow], scopeFilter, {
        hierarchy,
        currentTeamId: team?.id,
        currentProjectId: project?.id,
      }).length > 0
    );
  }, [projectApiKey, project?.id, scopeFilter, hierarchy, team?.id]);

  // Everything the scope picker left, legacy project key included, so a chip's
  // count is exactly the number of rows clicking that chip renders.
  const countableRows = useMemo(
    () =>
      projectKeyPassesScope
        ? [...scopedKeys, { roleBindings: PROJECT_KEY_BINDINGS }]
        : scopedKeys,
    [scopedKeys, projectKeyPassesScope],
  );
  const scopeKindChips = useMemo(
    () => buildScopeKindChips(countableRows),
    [countableRows],
  );
  const visibleKeys = useMemo(
    () => filterKeysByScopeKind(scopedKeys, scopeKind),
    [scopedKeys, scopeKind],
  );
  const showProjectKeyRow =
    projectKeyPassesScope &&
    keyMatchesScopeKind({ roleBindings: PROJECT_KEY_BINDINGS }, scopeKind);

  const shownCount = visibleKeys.length + (showProjectKeyRow ? 1 : 0);
  const totalCount = countableRows.length;
  // What the table would hold with no filter at all, which is the only number
  // that can tell "you have no keys" apart from "your filters hid them".
  const unfilteredCount = serviceApiKeys.length + (projectApiKey ? 1 : 0);
  const hasRows = shownCount > 0;
  const loadError = apiKeys.error;

  // Clicking the chip you are already on lets go of the filter, so getting back
  // to everything never means hunting for the "All keys" chip.
  const handleScopeKindChange = (next: string) =>
    setScopeKind((current) =>
      current === next ? ALL_SCOPE_KINDS : (next as ScopeKindFilter),
    );

  return (
    <>
      <VStack gap={8} width="full" align="stretch">
        {/* Personal + service keys (ingestSourceType == null). The page
            heading titles this table, so the section carries no heading of
            its own. The "Create API key" flow and the filters belong here. */}
        <VStack gap={4} width="full" align="start">
          <Text fontSize="sm" color="fg.muted">
            Do not share your API keys or expose them in the browser or other
            client-side code.
          </Text>

          <HStack width="full" flexWrap="wrap" gap={3} align="center">
            <FilterChips
              value={scopeKind}
              onChange={handleScopeKindChange}
              items={scopeKindChips}
              groupLabel="Filter keys by scope"
              countNoun={{ singular: "key", plural: "keys" }}
              testId="scope-kind-chips"
            />
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

          <Tooltip content={SCOPE_KIND_OVERLAP_NOTE}>
            <Text
              fontSize="xs"
              color="fg.muted"
              cursor="help"
              tabIndex={0}
              data-testid="api-keys-shown-count"
            >
              {`Showing ${shownCount} of ${totalCount} keys`}
            </Text>
          </Tooltip>

          <SectionErrorNotice
            error={loadError}
            fallbackTitle="Couldn't load API keys"
          />

          <Card.Root width="full" overflow="hidden">
            <Card.Body paddingY={0} paddingX={0} overflowX="auto">
              <Table.Root variant="line" size="md" width="full">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Key</Table.ColumnHeader>
                    <Table.ColumnHeader>Scope</Table.ColumnHeader>
                    <Table.ColumnHeader>Access</Table.ColumnHeader>
                    <Table.ColumnHeader>Owner</Table.ColumnHeader>
                    <Table.ColumnHeader>Last used</Table.ColumnHeader>
                    <Table.ColumnHeader>Created</Table.ColumnHeader>
                    <Table.ColumnHeader width="60px" />
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {showProjectKeyRow && projectApiKey && (
                    <ProjectKeyRow
                      apiKey={projectApiKey}
                      projectId={project?.id ?? ""}
                      projectName={project?.name}
                      canManage={canManageProject}
                      onRotate={() => setIsRotateConfirmOpen(true)}
                    />
                  )}

                  {visibleKeys.map((apiKey) => {
                    const canAct = isAdmin || apiKey.userId === currentUserId;
                    return (
                      <Table.Row
                        key={apiKey.id}
                        id={apiKeyRowAnchorId(apiKey.id)}
                      >
                        <Table.Cell>
                          <ApiKeyNameCell
                            name={apiKey.name}
                            description={apiKey.description}
                            secret={{
                              display: `sk-lw-${apiKey.lookupIdPrefix}…`,
                              copyValue: `sk-lw-${apiKey.lookupIdPrefix}`,
                              copyLabel: `Copy the key identifier for ${apiKey.name}`,
                              copiedTitle: "Key identifier copied",
                            }}
                            isExpired={isExpired(apiKey)}
                            icon={<Key size={14} aria-hidden />}
                          />
                        </Table.Cell>
                        <Table.Cell>
                          <ApiKeyScopeCell
                            scopes={apiKey.roleBindings.map((rb) => ({
                              scopeType: rb.scopeType as
                                | "ORGANIZATION"
                                | "TEAM"
                                | "PROJECT",
                              scopeId: rb.scopeId,
                              name: rb.scopeName ?? undefined,
                            }))}
                          />
                        </Table.Cell>
                        <Table.Cell>
                          <ApiKeyAccessBadge
                            permissionMode={apiKey.permissionMode}
                          />
                        </Table.Cell>
                        <Table.Cell>
                          <ApiKeyOwnerCell
                            ownerName={apiKey.userName}
                            ownerEmail={apiKey.userEmail}
                          />
                        </Table.Cell>
                        <Table.Cell>
                          <ApiKeyLastUsedCell lastUsedAt={apiKey.lastUsedAt} />
                        </Table.Cell>
                        <Table.Cell>
                          <Text fontSize="sm">
                            {formatCreatedAt(apiKey.createdAt)}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          {/* Owner or admin can edit/revoke; service keys (no
                              userId) require admin. A viewer who can do neither
                              gets no trigger rather than an empty menu. */}
                          {canAct && (
                            <ApiKeyRowActions
                              keyName={apiKey.name}
                              onEdit={() => setApiKeyToEdit(apiKey)}
                              onRevoke={() => setApiKeyToRevoke(apiKey.id)}
                            />
                          )}
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}

                  {isLoadingKeys && (
                    <Table.Row>
                      <Table.Cell colSpan={COLUMN_COUNT}>
                        <HStack justify="center" paddingY={4} gap={2}>
                          <Spinner size="sm" />
                          <Text color="fg.muted">Loading API keys</Text>
                        </HStack>
                      </Table.Cell>
                    </Table.Row>
                  )}

                  {!isLoadingKeys && !loadError && !hasRows && (
                    <Table.Row>
                      <Table.Cell colSpan={COLUMN_COUNT}>
                        <Text color="fg.muted" textAlign="center" paddingY={4}>
                          {unfilteredCount === 0
                            ? "No API keys. Create one to get started."
                            : "No keys match the current filter. Pick another scope to see the rest."}
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
        isCreating={createMutation.isPending}
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
        isUpdating={updateMutation.isPending}
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
    </>
  );
}
