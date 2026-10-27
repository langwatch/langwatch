/**
 * Settings > API Keys. One table of every credential that can talk to the LangWatch API, plus
 * the ingestion keys the CLI mints.
 */

import type { ApiKeyListEntry, ApiKeyTrpcGrant } from "@langwatch/api-key-contract";
import type { WireOf } from "@langwatch/api/web";
import { EmptyValue } from "@langwatch/design-system/empty-value";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { MoreVerticalIcon } from "@langwatch/design-system/icons";
import { IdText } from "@langwatch/design-system/id-text";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Badge,
  Box,
  Button,
  HStack,
  Spacer,
  Text,
  useDisclosure,
  VStack,
} from "@langwatch/design-system/primitives";
import { ProviderScopeChips } from "@langwatch/design-system/provider-scope-chips";
import { ScopeFilter } from "@langwatch/design-system/scope-filter";
import { nowInstant, toDate, toEpochMs } from "@langwatch/time";
import { Key, Plus } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { apiKeyApi } from "../../behavior/api-key-api.ts";
import { type LegacyProjectKey, useLegacyKeys } from "../../behavior/use-legacy-keys.ts";
import { apiKeyRowAnchorId } from "../../model/api-key-anchor.ts";
import type { CreateApiKeyInput } from "../../model/api-key-form.ts";
import { API_KEY_SCOPE_QUERY_KEY, useApiKeyHost } from "../../model/api-key-host.ts";
import {
  filterRowsByScope,
  scopeFilterAddressWrite,
  scopeFilterFromAddress,
  scopeHierarchyOf,
  type ScopeFilterValue,
} from "../../model/api-key-scope-filter.ts";
import {
  LEGACY_KEY_REVOKED_NOTICE,
  legacyKeyReplacementInput,
} from "../../model/legacy-key-replacement.ts";
import { IngestionKeysSection } from "../blocks/ingestion-keys-section.tsx";
import { LegacyProjectKeyBanner } from "../blocks/legacy-project-key-banner.tsx";
import { RevokeConfirmDialog } from "../blocks/revoke-confirm-dialog.tsx";
import { RevokeLegacyKeyDialog } from "../blocks/revoke-legacy-key-dialog.tsx";
import { CreateApiKeyDrawer } from "./create-api-key-drawer.tsx";
import { EditApiKeyDrawer } from "./edit-api-key-drawer.tsx";
import { TokenCreatedDialog } from "./token-created-dialog.tsx";

/** A key as the browser holds one: the wire carries its instants as ISO strings. */
type ApiKeyRow = WireOf<ApiKeyListEntry>;

/** Whether the reads that decide a swapped key's type and role have all answered. */
function readerAccess(
  reads: readonly { data: unknown; isError: boolean }[],
): "loading" | "failed" | "ready" {
  if (reads.some((read) => read.isError)) return "failed";
  return reads.every((read) => read.data !== undefined) ? "ready" : "loading";
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

/** Pixel widths for the seven columns; long names and owners truncate, nothing else gives way. */
const KEY_COLUMN_WIDTHS = [320, 120, 228, 176, 104, 110, 56] as const;
const KEY_COLUMNS = KEY_COLUMN_WIDTHS.length;
const KEY_TABLE_MIN_WIDTH = `${KEY_COLUMN_WIDTHS.reduce((sum, width) => sum + width, 0)}px`;

const API_KEYS_DOCS_HREF = "https://docs.langwatch.ai/platform/api-keys";

function NoMatchingKeysRow({ onClearFilters }: { onClearFilters: () => void }) {
  return (
    <ListTable.EmptyRow
      columns={KEY_COLUMNS}
      state="no-results"
      title="No keys match the current scope"
      description="Change the filter above to see other keys."
      onClearFilters={onClearFilters}
      next={[{ kind: "docs", label: "How API keys are scoped", href: API_KEYS_DOCS_HREF }]}
    />
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
    <ListTable.Row id={apiKeyRowAnchorId(apiKey.id)}>
      <ListTable.Cell>
        <HStack align="start">
          <Box paddingTop={1} color="fg.muted" flexShrink={0}>
            <Key size={14} />
          </Box>
          <VStack align="start" gap={0} minWidth={0}>
            <HStack gap={2} maxWidth="full" minWidth={0}>
              <Text textStyle="label" flex={1} minWidth={0} truncate title={apiKey.name}>
                {apiKey.name}
              </Text>
              {isExpired(apiKey) ? (
                <Badge size="sm" colorPalette="red" flexShrink={0}>
                  Expired
                </Badge>
              ) : (
                <Badge size="sm" colorPalette="green" flexShrink={0}>
                  Active
                </Badge>
              )}
            </HStack>
            {apiKey.description && (
              <Text
                textStyle="caption"
                color="fg.muted"
                maxWidth="full"
                lineClamp={2}
                title={apiKey.description}
              >
                {apiKey.description}
              </Text>
            )}
          </VStack>
        </HStack>
      </ListTable.Cell>
      <ListTable.Cell>
        <VStack align="start" gap={0}>
          <IdText
            value={`sk-lw-${apiKey.lookupIdPrefix}…`}
            label="secret key prefix"
            copyable={false}
          />
          <Text textStyle="caption" color="fg.muted">
            Created <FormattedDate value={apiKey.createdAt} display="date" />
          </Text>
        </VStack>
      </ListTable.Cell>
      <ListTable.Cell>
        <VStack align="start" gap={0} minWidth={0}>
          {apiKey.userId ? (
            <Text
              textStyle="bodySm"
              maxWidth="full"
              truncate
              title={apiKey.userEmail ?? apiKey.userName ?? undefined}
            >
              {apiKey.userEmail ?? apiKey.userName ?? <EmptyValue label="No owner" />}
            </Text>
          ) : (
            <EmptyValue label="No owner" />
          )}
          <Text textStyle="caption" color="fg.muted">
            {apiKey.userId ? "Personal key" : "Service key"}
          </Text>
        </VStack>
      </ListTable.Cell>
      <ListTable.Cell>{scopeBadge}</ListTable.Cell>
      <ListTable.Cell>
        <PermissionBadge permissionMode={apiKey.permissionMode} />
      </ListTable.Cell>
      <ListTable.Cell nowrap>
        {apiKey.lastUsedAt ? (
          <FormattedDate value={apiKey.lastUsedAt} display="relative" />
        ) : (
          <EmptyValue label="Never used" />
        )}
      </ListTable.Cell>
      <ListTable.ActionCell>
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
                <MoreVerticalIcon size={14} />
              </Button>
            </Menu.Trigger>
            <Menu.Content>
              <Menu.Item value="edit" data-testid="api-key-edit" onClick={() => onEdit(apiKey)}>
                Edit
              </Menu.Item>
              <Menu.Item
                value="revoke"
                color="fg.error"
                data-testid="api-key-revoke"
                onClick={() => onRevoke(apiKey.id)}
              >
                Revoke
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>
        )}
      </ListTable.ActionCell>
    </ListTable.Row>
  );
}

/** The project's legacy key as a row: it can only be revoked, never read or rotated (ADR-002). */
function LegacyKeyTableRow({
  legacyKey,
  onRevoke,
}: {
  legacyKey: LegacyProjectKey;
  onRevoke: () => void;
}) {
  return (
    <ListTable.Row data-testid="legacy-key-row" data-project-id={legacyKey.projectId}>
      <ListTable.Cell>
        <HStack align="start">
          <Box paddingTop={1} color="fg.muted" flexShrink={0}>
            <Key size={14} />
          </Box>
          <VStack align="start" gap={0} minWidth={0}>
            <HStack gap={2} maxWidth="full" minWidth={0}>
              <Text textStyle="label" flex={1} minWidth={0} truncate>
                Project key
              </Text>
              <Badge size="sm" colorPalette="orange" flexShrink={0}>
                Legacy
              </Badge>
            </HStack>
            <Text textStyle="caption" color="fg.muted" maxWidth="full" lineClamp={2}>
              Revoke it to get an API key in its place.
            </Text>
          </VStack>
        </HStack>
      </ListTable.Cell>
      <ListTable.Cell>
        <IdText value="sk-lw-…" label="secret key prefix" copyable={false} />
      </ListTable.Cell>
      <ListTable.Cell>
        <VStack align="start" gap={0}>
          <EmptyValue label="No owner" />
          <Text textStyle="caption" color="fg.muted">
            Project key
          </Text>
        </VStack>
      </ListTable.Cell>
      <ListTable.Cell>
        <ProviderScopeChips
          size="xs"
          scopes={[
            {
              scopeType: "PROJECT",
              scopeId: legacyKey.projectId,
              name: legacyKey.projectName,
            },
          ]}
        />
      </ListTable.Cell>
      <ListTable.Cell>
        <PermissionBadge permissionMode="all" />
      </ListTable.Cell>
      <ListTable.Cell nowrap>
        {legacyKey.lastUsedAt ? (
          <FormattedDate value={legacyKey.lastUsedAt} display="relative" />
        ) : (
          <EmptyValue label="Never used" />
        )}
      </ListTable.Cell>
      <ListTable.ActionCell>
        <Menu.Root>
          <Menu.Trigger asChild>
            <Button
              size="xs"
              variant="ghost"
              aria-label={`Actions for the legacy project key of ${legacyKey.projectName}`}
              data-testid="legacy-key-actions"
            >
              <MoreVerticalIcon size={14} />
            </Button>
          </Menu.Trigger>
          <Menu.Content>
            <Menu.Item
              value="revoke"
              color="fg.error"
              data-testid="legacy-key-revoke"
              onClick={onRevoke}
            >
              Revoke
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
      </ListTable.ActionCell>
    </ListTable.Row>
  );
}

export default function ApiKeysScreen() {
  const host = useApiKeyHost();
  const scope = host.scope();
  const organizationId = scope.organizationId ?? "";
  const currentUserId = host.currentUser()?.id ?? "";
  const endpoint = host.apiEndpoint();
  const reading = host.route();

  const apiKeys = apiKeyApi.apiKey.list.useQuery({ organizationId });
  const myBindings = apiKeyApi.apiKey.myBindings.useQuery({ organizationId });
  const orgProjects = apiKeyApi.apiKey.orgProjects.useQuery({ organizationId });
  const orgTeams = apiKeyApi.apiKey.orgTeams.useQuery({ organizationId });
  const orgMembers = apiKeyApi.apiKey.orgMembers.useQuery({ organizationId });
  // An empty member list is how the page knows the reader is not an
  // organization admin: the procedure answers `[]` for everybody else.
  const isAdmin = (orgMembers.data?.length ?? 0) > 0;
  // Organisation-wide, like the page: one project's revoke leaves every other
  // project's nudge standing.
  const legacyKeys = useLegacyKeys({ organizationId });
  const revokeLegacyMutation = apiKeyApi.project.revokeProjectApiKey.useMutation();
  const createMutation = apiKeyApi.apiKey.create.useMutation();
  const updateMutation = apiKeyApi.apiKey.update.useMutation();
  const revokeMutation = apiKeyApi.apiKey.revoke.useMutation();
  const queryClient = apiKeyApi.useUtils();

  const { open: isCreateOpen, onOpen: onCreateOpen, onClose: onCreateClose } = useDisclosure();

  const [newToken, setNewToken] = useState<string | null>(null);
  const [newKeyInput, setNewKeyInput] = useState<CreateApiKeyInput | null>(null);
  const [apiKeyToRevoke, setApiKeyToRevoke] = useState<string | null>(null);
  const [apiKeyToEdit, setApiKeyToEdit] = useState<ApiKeyRow | null>(null);
  const [legacyKeyToRevoke, setLegacyKeyToRevoke] = useState<LegacyProjectKey | null>(null);
  const [legacyReplacement, setLegacyReplacement] = useState<CreateApiKeyInput | null>(null);

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

  const handleCreate = (input: CreateApiKeyInput, onCreated?: () => void): void => {
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
          onCreated?.();
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

  // Confirming revokes the legacy key, then opens the create drawer filled with
  // its replacement. A reader whose key could not send traces is refused before
  // the revoke, so they are never left with neither key.
  const handleRevokeLegacyKey = () => {
    const projectId = legacyKeyToRevoke?.projectId;
    if (!projectId) return;
    const replacement = legacyKeyReplacementInput({
      projectId,
      isOrganizationAdmin: isAdmin,
      reader: { myBindings: myBindings.data, organizationId, orgProjects: orgProjects.data ?? [] },
    });
    if (!replacement) {
      setLegacyKeyToRevoke(null);
      host.failed({
        error: undefined,
        fallbackTitle: "Couldn't revoke the legacy project key",
        description: "Your role can't create a key that sends traces. Ask an organization admin.",
      });
      return;
    }
    revokeLegacyMutation.mutate(
      { projectId },
      {
        onSuccess: () => {
          setLegacyKeyToRevoke(null);
          host.succeeded({ title: "Legacy project key revoked" });
          void queryClient.project.legacyKeys.invalidate();
          setLegacyReplacement(replacement);
        },
        onError: (error) =>
          host.failed({ error, fallbackTitle: "Couldn't revoke the legacy project key" }),
      },
    );
  };

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
        <PageLayout.Heading>API keys</PageLayout.Heading>
        <Spacer />
        <ScopeFilter
          value={scopeFilter}
          onChange={handleScopeFilterChange}
          available={filterAvailable}
          currentTeamId={scope.teamId}
          currentProjectId={scope.projectId}
        />
        <PageLayout.HeaderButton primary onClick={onCreateOpen} data-testid="api-key-create">
          <Plus size={16} />
          Create new secret key
        </PageLayout.HeaderButton>
      </PageLayout.Header>
      <VStack gap={6} width="full" align="stretch" paddingTop={4}>
        <Text color="fg.muted">
          Keys that let your code and tools talk to LangWatch. Do not share your API keys or expose
          them in the browser or other client-side code.
        </Text>

        {legacyKeys.keys.length > 0 && (
          <LegacyProjectKeyBanner
            projectNames={legacyKeys.keys.map((legacyKey) => legacyKey.projectName)}
            onRevoke={
              legacyKeys.keys.length === 1
                ? () => setLegacyKeyToRevoke(legacyKeys.keys[0] ?? null)
                : undefined
            }
          />
        )}

        <VStack gap={8} width="full" align="stretch">
          {/* Personal + service keys (ingestSourceType == null); the page heading titles them. */}
          {!isLoadingKeys && serviceApiKeys.length === 0 && legacyKeys.keys.length === 0 ? (
            <NoDataInfoBlock
              title="No API keys"
              description="Create one to get started."
              icon={<Key size={24} />}
              testId="api-keys-empty"
            />
          ) : (
            <ListTable
              scroll="x"
              scrollLabel="API keys"
              tableLayout="fixed"
              minWidth={KEY_TABLE_MIN_WIDTH}
            >
              <ListTable.ColumnGroup>
                {KEY_COLUMN_WIDTHS.map((width) => (
                  <ListTable.Column key={width} width={`${width}px`} />
                ))}
              </ListTable.ColumnGroup>
              <ListTable.Header>
                <ListTable.Row>
                  <ListTable.ColumnHeader>Name</ListTable.ColumnHeader>
                  <ListTable.ColumnHeader>Secret key</ListTable.ColumnHeader>
                  <ListTable.ColumnHeader>Owner</ListTable.ColumnHeader>
                  <ListTable.ColumnHeader>Scope</ListTable.ColumnHeader>
                  <ListTable.ColumnHeader>Permissions</ListTable.ColumnHeader>
                  <ListTable.ColumnHeader>Last used</ListTable.ColumnHeader>
                  <ListTable.ActionHeader />
                </ListTable.Row>
              </ListTable.Header>
              <ListTable.Body>
                {isLoadingKeys && <ListTable.LoadingRows rows={3} columns={KEY_COLUMNS} />}
                {legacyKeys.keys.map((legacyKey) => (
                  <LegacyKeyTableRow
                    key={legacyKey.projectId}
                    legacyKey={legacyKey}
                    onRevoke={() => setLegacyKeyToRevoke(legacyKey)}
                  />
                ))}
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

                {!isLoadingKeys && filteredKeys.length === 0 && legacyKeys.keys.length === 0 && (
                  <NoMatchingKeysRow
                    onClearFilters={() => handleScopeFilterChange({ kind: "all" })}
                  />
                )}
              </ListTable.Body>
            </ListTable>
          )}

          {/* Ingestion keys render below the API keys table. */}
          <IngestionKeysSection
            keys={ingestionKeys}
            isAdmin={isAdmin}
            onRevoke={setApiKeyToRevoke}
          />
        </VStack>

        <CreateApiKeyDrawer
          isOpen={(isCreateOpen || legacyReplacement !== null) && !newToken}
          isCreating={createMutation.isPending}
          myBindings={myBindings}
          orgProjects={orgProjects.data ?? []}
          orgTeams={orgTeams.data ?? []}
          organizationId={organizationId}
          organizationName={scope.organizationName}
          currentTeamId={scope.teamId}
          currentProjectId={scope.projectId}
          prefill={legacyReplacement ?? undefined}
          notice={legacyReplacement ? LEGACY_KEY_REVOKED_NOTICE : undefined}
          onClose={() => {
            setLegacyReplacement(null);
            onCreateClose();
          }}
          onCreate={(input) => handleCreate(input, () => setLegacyReplacement(null))}
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
          keyName={newKeyInput?.name}
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

        <RevokeLegacyKeyDialog
          open={legacyKeyToRevoke !== null}
          projectName={legacyKeyToRevoke?.projectName}
          isRevoking={revokeLegacyMutation.isPending}
          access={readerAccess([myBindings, orgMembers, orgProjects])}
          onClose={() => setLegacyKeyToRevoke(null)}
          onConfirm={handleRevokeLegacyKey}
        />
      </VStack>
    </>
  );
}
