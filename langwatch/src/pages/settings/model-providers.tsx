import {
  Box,
  Button,
  Card,
  EmptyState,
  Heading,
  HStack,
  Skeleton,
  Spacer,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { BrainCircuit, Edit, MoreVertical, Plus, Trash2 } from "lucide-react";
import { DefaultModelsSection } from "../../components/settings/DefaultModelsSection";
import {
  DefaultModelsScopeFilter,
  type ScopeFilter as PageScopeFilter,
} from "../../components/settings/DefaultModelsScopeFilter";
import { ProviderScopeChips } from "../../components/settings/ProviderScopeChips";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "~/utils/compat/next-router";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { useDrawer } from "~/hooks/useDrawer";
import { api } from "~/utils/api";
import SettingsLayout from "../../components/SettingsLayout";
import { Dialog } from "../../components/ui/dialog";
import { Menu } from "../../components/ui/menu";
import { Tooltip } from "../../components/ui/tooltip";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { modelProviderIcons } from "../../server/modelProviders/iconsMap";
import { modelProviders as modelProvidersRegistry } from "../../server/modelProviders/registry";
import {
  filterProvidersByScope,
  type ScopeHierarchy,
} from "../../utils/filterProvidersByScope";

export default function ModelsPage() {
  const { project, organization, team, hasPermission } =
    useOrganizationTeamProject();
  const hasModelProvidersManagePermission = hasPermission("project:manage");
  // The settings page renders one row per stored ModelProvider — the
  // Record-by-provider-key shape returned by `useModelProvidersSettings`
  // collapses multi-instance setups (two "OpenAI" rows at different
  // scopes) into a single entry and silently drops the loser. Use the
  // flat list endpoint instead so the table reflects every row.
  //
  // The "All you can see" view fans out across the whole organization
  // so an admin sees providers a sibling project has configured. Members
  // without `organization:view` (project-only members) fall back to the
  // per-project endpoint, which they always have permission to read.
  const canViewOrg = hasPermission("organization:view");
  const orgQuery =
    api.modelProvider.listAllForOrganizationForFrontend.useQuery(
      { organizationId: organization?.id ?? "" },
      {
        enabled: !!organization?.id && canViewOrg,
        retry: false,
        refetchOnWindowFocus: false,
      },
    );
  const projectQuery = api.modelProvider.listAllForProjectForFrontend.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project?.id && !canViewOrg,
      retry: false,
      refetchOnWindowFocus: false,
    },
  );
  const activeQuery = canViewOrg ? orgQuery : projectQuery;
  const allProvidersList = activeQuery.data?.providers ?? [];
  const isLoading = activeQuery.isLoading;
  const refetch = activeQuery.refetch;

  const { openDrawer, drawerOpen: isDrawerOpen } = useDrawer();
  const isProviderDrawerOpen = isDrawerOpen("editModelProvider");
  const updateMutation = api.modelProvider.update.useMutation();
  const deleteMutation = api.modelProvider.delete.useMutation();
  const [providerToDisable, setProviderToDisable] = useState<{
    id?: string;
    provider: string;
    name: string;
  } | null>(null);

  // Surface how many gateway bindings would be left orphaned by

  // One scope filter drives both tables on this page (Model Providers
  // and Default Models). Shape matches the DefaultModelsScopeFilter
  // primitive used in the header.
  const [scopeFilter, setScopeFilter] = useState<PageScopeFilter>({
    kind: "all",
  });
  const router = useRouter();

  // Build the `available` payload the filter dropdown needs (org / teams /
  // projects). Pulled from the current organization graph so the page
  // doesn't have to wait on the default-models query before the header
  // filter can render.
  const filterAvailable = useMemo(() => {
    const teams = organization?.teams ?? [];
    return {
      organization: organization
        ? { id: organization.id, name: organization.name }
        : null,
      teams: teams.map((t) => ({ id: t.id, name: t.name })),
      projects: teams.flatMap((t) =>
        (t.projects ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          teamId: t.id,
        })),
      ),
    };
  }, [organization]);

  // Hydrate scope filter from `?scope=TYPE:id` deep-links (e.g. the
  // "Configure" link on the VK create / edit drawer's Eligible Model
  // Providers section). URL contract is the colon-joined token shape
  // shared with VirtualKeyScope serialisation:
  //   ?scope=ORGANIZATION:<id>   ?scope=TEAM:<id>   ?scope=PROJECT:<id>
  // Re-runs when filterAvailable populates so the chip can pick up the
  // human-readable name from the org graph instead of an opaque id.
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
      setScopeFilter({ kind: "specific", scopeType, scopeId, name } as PageScopeFilter);
    } else {
      setScopeFilter({ kind: "specific", scopeType, scopeId } as PageScopeFilter);
    }
  }, [router.query.scope, filterAvailable]);

  const allEnabledProviders = useMemo(() => {
    return allProvidersList.filter((provider) => provider.enabled);
  }, [allProvidersList]);

  // Provider-key set the Default Models table uses to flag cells whose
  // `provider/...` model id no longer maps to an enabled provider. Use
  // the ALL set, not the scope-filtered one — a default config attached
  // at TEAM scope is still valid even when the table is filtered to
  // PROJECT, because the cascade reaches it from the team tier.
  const enabledProviderKeys = useMemo(
    () => new Set(allEnabledProviders.map((p) => p.provider)),
    [allEnabledProviders],
  );

  // Hierarchy describing the org tree the page is rendering. Drives
  // inclusive scope filtering (parents up, children down) for both the
  // Model Providers and Default Models tables.
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

  // Client-side filter for the scope dropdown at the top of the page.
  // The list query returns every provider the caller can see; this just
  // narrows the visible rows. See specs/model-providers/scope-filter.feature.
  const enabledProviders = useMemo(
    () =>
      filterProvidersByScope(allEnabledProviders, scopeFilter, {
        hierarchy,
        currentTeamId: team?.id,
        currentProjectId: project?.id,
      }),
    [allEnabledProviders, scopeFilter, hierarchy, team?.id, project?.id],
  );

  // Every registry provider is always addable — iter 109 allows multiple
  // rows per provider type so users can configure "OpenAI" at org scope
  // plus another "OpenAI" at project scope (say, a production override).
  // The prior behavior of hiding already-configured providers prevented
  // the very multi-instance flow the scope picker exists to support.
  const addableProviders = useMemo(() => {
    return Object.keys(modelProvidersRegistry).map((providerKey) => ({
      provider: providerKey as keyof typeof modelProvidersRegistry,
      name:
        modelProvidersRegistry[
          providerKey as keyof typeof modelProvidersRegistry
        ]?.name ?? providerKey,
      icon: modelProviderIcons[
        providerKey as keyof typeof modelProviderIcons
      ],
    }));
  }, []);

  const utils = api.useContext();

  useEffect(() => {
    if (!isProviderDrawerOpen) {
      // Refetch both providers and organization data when drawer closes
      void refetch();
      void utils.organization.getAll.invalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProviderDrawerOpen]);

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <HStack width="full" marginTop={2}>
          <Heading as="h2">Model Providers</Heading>
          <Spacer />
          {/* Single scope filter for the whole page — narrows both the
              Model Providers table and the Default Models table below.
              The DefaultModelsScopeFilter primitive carries the caret
              icon + "More Scopes" submenu (see scope-filter.feature). */}
          <DefaultModelsScopeFilter
            value={scopeFilter}
            onChange={setScopeFilter}
            available={filterAvailable}
            currentTeamId={team?.id}
            currentProjectId={project?.id}
          />
          {/*
            iter 109 #63: ProjectSelector is gone — Model Providers is now
            an org-level surface. Scope is set per-row via the drawer's
            Scope picker (Organization / Team / Project), and each row's
            scope chips below show where it's accessible. Switching
            projects from this page used to silently rebind the
            credential to a different project, which the new scope
            picker makes explicit instead.
          */}
          <AddModelProviderMenu
            addableProviders={addableProviders}
            disabled={!hasModelProvidersManagePermission}
            disabledReason="You need model provider manage permissions to add new providers."
            onPick={(providerKey) => {
              if (!project?.id) return;
              openDrawer("editModelProvider", {
                projectId: project.id,
                organizationId: organization?.id,
                providerKey,
                modelProviderId: "new",
              });
            }}
          >
            <PageLayout.HeaderButton
              disabled={!hasModelProvidersManagePermission}
            >
              <Plus /> Add Model Provider
            </PageLayout.HeaderButton>
          </AddModelProviderMenu>
        </HStack>

        {isLoading ? (
          <ProvidersTableSkeleton />
        ) : enabledProviders.length === 0 ? (
          <EmptyState.Root width="full">
            <EmptyState.Content>
              <EmptyState.Indicator>
                <BrainCircuit size={24} />
              </EmptyState.Indicator>
              <VStack textAlign="center" gap={3}>
                <VStack textAlign="center" gap={1}>
                  <EmptyState.Title>No model providers</EmptyState.Title>
                  <EmptyState.Description>
                    Add a model provider to get started
                  </EmptyState.Description>
                </VStack>
                {/* Empty-state CTA mirrors the page header — same Menu
                    content, same RBAC gate, same click handler. Without
                    a CTA right where the user is looking, the only path
                    forward was the top-right button which is easy to
                    miss on a fresh empty screen. */}
                <AddModelProviderMenu
                  addableProviders={addableProviders}
                  disabled={!hasModelProvidersManagePermission}
                  disabledReason="You need model provider manage permissions to add new providers."
                  onPick={(providerKey) => {
                    if (!project?.id) return;
                    openDrawer("editModelProvider", {
                      projectId: project.id,
                      organizationId: organization?.id,
                      providerKey,
                      modelProviderId: "new",
                    });
                  }}
                >
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!hasModelProvidersManagePermission}
                    data-testid="empty-state-add-model-provider"
                  >
                    <HStack gap={1}>
                      <Plus size={14} />
                      <Text>Add Model Provider</Text>
                    </HStack>
                  </Button>
                </AddModelProviderMenu>
              </VStack>
            </EmptyState.Content>
          </EmptyState.Root>
        ) : (
          <Card.Root width="full" overflow="hidden">
            <Card.Body paddingY={0} paddingX={0}>
          <Table.Root variant="line" size="md" width="full">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Provider</Table.ColumnHeader>
                <Table.ColumnHeader>Scope</Table.ColumnHeader>
                <Table.ColumnHeader />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {enabledProviders.map((provider) => {
                // Build a scope-id → display-name map so each chip can
                // render the real org / team / project name instead of
                // the bare type label. Without this lookup, providers
                // bound to multiple teams render as identical "Team",
                // "Team" pills (see ProviderScopeChips comment).
                const scopeNameById = new Map<string, string>();
                if (organization) {
                  scopeNameById.set(organization.id, organization.name);
                  for (const t of organization.teams ?? []) {
                    scopeNameById.set(t.id, t.name);
                    for (const p of t.projects ?? []) {
                      scopeNameById.set(p.id, p.name);
                    }
                  }
                }
                const namedScopes = (provider as any).scopes
                  ? ((provider as any).scopes as Array<{
                      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
                      scopeId: string;
                    }>).map((s) => ({
                      ...s,
                      name: scopeNameById.get(s.scopeId),
                    }))
                  : undefined;
                const providerIcon =
                  modelProviderIcons[
                    provider.provider as keyof typeof modelProviderIcons
                  ];
                const providerSpec =
                  modelProvidersRegistry[
                    provider.provider as keyof typeof modelProvidersRegistry
                  ];

                const isSystem = !!(provider as any).isSystem;
                return (
                  <Table.Row key={provider.id ?? `system-${provider.provider}`}>
                    <Table.Cell>
                      <HStack gap={3} align="center">
                        <Box width="24px" height="24px">
                          {providerIcon}
                        </Box>
                        <Text>
                          {(provider as any).name ??
                            providerSpec?.name ??
                            provider.provider}
                        </Text>
                      </HStack>
                    </Table.Cell>
                    <Table.Cell>
                      <ProviderScopeChips
                        scopes={namedScopes}
                        fallbackScopeType={(provider as any).scopeType}
                        // Env-var-fed providers carry `isSystem` from
                        // the service; the chip column reads "System"
                        // instead of an empty cell.
                        system={isSystem}
                      />
                    </Table.Cell>
                    <Table.Cell textAlign="right">
                      {isSystem ? (
                        // System (env-fed) providers can't be edited
                        // through the UI — their config lives in the
                        // server's process env. Hide the menu so the
                        // row reads as read-only at a glance.
                        null
                      ) : (
                        <Menu.Root>
                          <Tooltip
                            content="You need model provider manage permissions to edit or delete providers."
                            disabled={hasModelProvidersManagePermission}
                          >
                            <Menu.Trigger asChild>
                              <Button
                                variant="ghost"
                                disabled={!hasModelProvidersManagePermission}
                              >
                                <MoreVertical />
                              </Button>
                            </Menu.Trigger>
                          </Tooltip>
                          <Menu.Content>
                            <Menu.Item
                              value="edit"
                              onClick={(event) => {
                                event.stopPropagation();
                                openDrawer("editModelProvider", {
                                  projectId: project?.id,
                                  organizationId: organization?.id,
                                  modelProviderId: provider.id,
                                  providerKey: provider.provider,
                                });
                              }}
                            >
                              <Box display="flex" alignItems="center" gap={2}>
                                <Edit size={14} />
                                Edit Provider
                              </Box>
                            </Menu.Item>
                            <Menu.Item
                              value="disable"
                              color="red"
                              onClick={(event) => {
                                event.stopPropagation();
                                setProviderToDisable({
                                  id: provider.id ?? undefined,
                                  provider: provider.provider,
                                  name:
                                    providerSpec?.name ?? provider.provider,
                                });
                              }}
                            >
                              <Box display="flex" alignItems="center" gap={2}>
                                <Trash2 size={14} />
                                Disable Provider
                              </Box>
                            </Menu.Item>
                          </Menu.Content>
                        </Menu.Root>
                      )}
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
            </Card.Body>
          </Card.Root>
        )}

        {/* Default Models renders whenever the project has providers
            OR has orphan default-model configs. The section hides
            itself (via display:none) when BOTH are empty (fresh
            accounts only) — old accounts that nuked their providers
            still see the table so they can spot + fix the now-invalid
            orphan defaults. Mounting unconditionally lets the
            getDefaultModelsForProject tRPC query fire in parallel
            with getAllForProject above, instead of waterfalling. */}
        <DefaultModelsSection
          filter={scopeFilter}
          onFilterChange={setScopeFilter}
          enabledProviderKeys={enabledProviderKeys}
          noProvidersConfigured={!isLoading && enabledProviders.length === 0}
          hierarchy={hierarchy}
        />

        <Dialog.Root
          open={!!providerToDisable}
          onOpenChange={(details) => {
            if (!details.open) {
              setProviderToDisable(null);
            }
          }}
        >
          <Dialog.Content bg="bg">
            <Dialog.Header>
              <Dialog.Title>Disable {providerToDisable?.name}?</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <VStack gap={3} align="start">
                <Text>This provider will no longer be available for use.</Text>
                <Text fontSize="sm" color="fg.muted">
                  Default model configs that reference this provider will
                  surface as &ldquo;Update needed&rdquo; in the table below.
                </Text>
                {/* Binding-count warning was tied to GatewayProviderCredential,
                    folded into ModelProvider in iter 110. The disable action
                    sets ModelProvider.enabled=false which is itself the
                    source of truth — no separate binding to count. */}
              </VStack>
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline">Cancel</Button>
              </Dialog.ActionTrigger>
              <Button
                colorPalette="red"
                loading={deleteMutation.isPending}
                onClick={async () => {
                  if (!providerToDisable) return;
                  if (!project?.id) return;
                  await deleteMutation.mutateAsync({
                    id: providerToDisable.id,
                    projectId: project.id,
                    provider: providerToDisable.provider,
                  });
                  setProviderToDisable(null);
                  await refetch();
                  // Invalidate every cross-page query that gates UI on
                  // "are there enabled providers?" so the prompts page
                  // and evaluation wizard pick up the deletion without
                  // a window-focus refetch.
                  await Promise.all([
                    utils.modelProvider.getAllForProject.invalidate(),
                    utils.modelProvider.getAllForProjectForFrontend.invalidate(),
                    utils.modelProvider.listAllForProjectForFrontend.invalidate(),
                    utils.modelProvider.listAllForOrganizationForFrontend.invalidate(),
                    utils.modelProvider.getResolvedDefault.invalidate(),
                    utils.modelProvider.getDefaultModelsForProject.invalidate(),
                  ]);
                }}
              >
                Disable
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger />
          </Dialog.Content>
        </Dialog.Root>
      </VStack>
    </SettingsLayout>
  );
}

/**
 * Shared "Add Model Provider" menu — same provider list, same RBAC
 * gate, same click handler — wrapped around whatever trigger the
 * caller passes (header button in the page top-right + outline button
 * in the empty state). Keeping both callsites on a single helper means
 * the provider list never drifts between the two surfaces.
 */
function AddModelProviderMenu({
  children,
  addableProviders,
  disabled,
  disabledReason,
  onPick,
}: {
  children: React.ReactNode;
  addableProviders: Array<{
    provider: string;
    name: string;
    icon: React.ReactNode;
  }>;
  disabled: boolean;
  disabledReason: string;
  onPick: (providerKey: string) => void;
}) {
  return (
    <Menu.Root>
      <Tooltip content={disabledReason} disabled={!disabled}>
        <Menu.Trigger asChild>{children}</Menu.Trigger>
      </Tooltip>
      <Menu.Content>
        {addableProviders.map((provider) => (
          <Menu.Item
            key={provider.provider}
            value={provider.provider}
            onClick={() => onPick(provider.provider)}
          >
            <HStack gap={3}>
              <Box width="20px" height="20px">{provider.icon}</Box>
              <Text>{provider.name}</Text>
            </HStack>
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
}

/**
 * Skeleton render of the providers table — keeps the page from
 * flashing a bare spinner on first load (or on a refocus refetch that
 * follows an upstream error). Matches the real table shape (header + 3
 * rows of provider chip + scope chip + 3-dot menu) so the layout
 * doesn't jump when the data lands.
 */
function ProvidersTableSkeleton() {
  return (
    <Card.Root width="full" overflow="hidden" data-testid="providers-table-skeleton">
      <Card.Body paddingY={0} paddingX={0}>
        <Table.Root variant="line" size="md" width="full">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Provider</Table.ColumnHeader>
              <Table.ColumnHeader>Scope</Table.ColumnHeader>
              <Table.ColumnHeader />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {[0, 1, 2].map((i) => (
              <Table.Row key={i}>
                <Table.Cell>
                  <HStack gap={3} align="center">
                    <Skeleton width="24px" height="24px" borderRadius="sm" />
                    <Skeleton width="120px" height="16px" />
                  </HStack>
                </Table.Cell>
                <Table.Cell>
                  <Skeleton width="80px" height="20px" borderRadius="full" />
                </Table.Cell>
                <Table.Cell textAlign="right">
                  <Skeleton width="24px" height="24px" borderRadius="md" marginLeft="auto" />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Card.Body>
    </Card.Root>
  );
}

