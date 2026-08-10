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
import {
  BrainCircuit,
  Edit,
  MoreVertical,
  PlugZap,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { modelProviderIcons } from "~/components/modelProviders/iconsMap";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { useAllModelProvidersList } from "~/hooks/useAllModelProvidersList";
import { useAvailableScopes } from "~/hooks/useAvailableScopes";
import { useDrawer } from "~/hooks/useDrawer";
import { useModelProviderConnectionTest } from "~/hooks/useModelProviderConnectionTest";
import { useUrlScopeFilter } from "~/hooks/useUrlScopeFilter";
import { api } from "~/utils/api";
import SettingsLayout from "../../components/SettingsLayout";
import { CodexCodingDefaultsAskHost } from "../../components/settings/CodexCodingDefaultsAsk";
import { ConnectionTestVerdict } from "../../components/settings/ConnectionTestVerdict";
import { DefaultModelsSection } from "../../components/settings/DefaultModelsSection";
import { ProviderScopeChips } from "../../components/settings/ProviderScopeChips";
import { ScopeFilter as ScopeFilterComponent } from "../../components/settings/ScopeFilter";
import { Dialog } from "../../components/ui/dialog";
import { Menu } from "../../components/ui/menu";
import { TriggerAnchor } from "../../components/ui/TriggerAnchor";
import { Tooltip } from "../../components/ui/tooltip";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { buildCustomModelDisplayNames } from "../../server/modelProviders/customModelDisplayNames";
import {
  isProviderProbeable,
  modelProviders as modelProvidersRegistry,
  providerDeprecation,
} from "../../server/modelProviders/registry";
import { filterProvidersByScope } from "../../utils/filterProvidersByScope";

export default function ModelsPage() {
  const { project, organization, team, hasPermission } =
    useOrganizationTeamProject();
  const hasModelProvidersManagePermission = hasPermission("project:manage");
  // A provider belongs to the organization and reaches the scopes attached
  // to it, so the write path takes either handle and a project is only the
  // narrower one. An organization on the agent-governance track has none
  // until it needs one, and organization scope is the default for a new
  // credential, so every action here works with or without a project. See
  // specs/model-providers/providers-without-a-project.feature.
  const projectId = project?.id;
  const organizationId = organization?.id;

  // One reason string per blocked action, `undefined` when the action
  // works. Whatever is rendered inert carries its reason in a tooltip, so
  // no control on this page can be clicked into silence.
  const addProviderDisabledReason = !hasModelProvidersManagePermission
    ? "You need model provider manage permissions to add new providers."
    : undefined;
  const rowActionsDisabledReason = !hasModelProvidersManagePermission
    ? "You need model provider manage permissions to edit or delete providers."
    : undefined;
  // Verdicts live for as long as the page is open and are keyed by row, so
  // testing one provider never overwrites what another just reported.
  const connectionTests = useModelProviderConnectionTest({
    projectId,
    organizationId,
  });
  // Flat, uncollapsed list — see useAllModelProvidersList for why this
  // table can't use the collapsed Record from useModelProvidersSettings.
  const {
    providers: allProvidersList,
    isLoading,
    refetch,
  } = useAllModelProvidersList();

  const { openDrawer, drawerOpen: isDrawerOpen } = useDrawer();
  const isProviderDrawerOpen = isDrawerOpen("editModelProvider");
  const deleteMutation = api.modelProvider.delete.useMutation();
  // Carries the tenant the row was opened from, so the confirm button
  // always has the tenant the deletion runs against.
  const [providerToDelete, setProviderToDelete] = useState<{
    id?: string;
    provider: string;
    name: string;
    projectId: string | undefined;
    organizationId: string | undefined;
  } | null>(null);

  // Build the `available` payload the filter dropdown needs (org / teams /
  // projects / hierarchy). Pulled from the current organization graph so
  // the page doesn't have to wait on the default-models query before the
  // header filter can render.
  const filterAvailable = useAvailableScopes(organization);
  const { hierarchy } = filterAvailable;

  // One scope filter drives both tables on this page (Model Providers
  // and Default Models). URL hydration and setter are shared with the
  // api-keys page via useUrlScopeFilter.
  const [scopeFilter, handleScopeFilterChange] = useUrlScopeFilter({
    filterAvailable,
    teamId: team?.id,
    projectId: project?.id,
  });

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

  // Display names for the Default Models table's chips. Built from the ALL
  // set (not the scope-filtered one) for the same reason as
  // `enabledProviderKeys` above.
  const defaultModelsDisplayNames = useMemo(
    () => buildCustomModelDisplayNames(allProvidersList),
    [allProvidersList],
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
    return Object.keys(modelProvidersRegistry)
      .filter(
        // Deprecated providers accept no new rows — the server refuses to
        // create one either. Stored rows still render in the table below.
        (providerKey) => !providerDeprecation(providerKey),
      )
      .map((providerKey) => ({
        provider: providerKey as keyof typeof modelProvidersRegistry,
        name:
          modelProvidersRegistry[
            providerKey as keyof typeof modelProvidersRegistry
          ]?.name ?? providerKey,
        icon: modelProviderIcons[
          providerKey as keyof typeof modelProviderIcons
        ],
        // Sign-in providers (Codex) are a niche, subscription-billed harness,
        // not a general API-key provider — so they sort to the bottom of the
        // add menu here. On Langy / onboarding the surface-aware grid promotes
        // them to the top instead (see providersForSurface). The registry keeps
        // literal entry types via `satisfies`, so widen to read the optional
        // authFlow — same pattern as ModelProviderForm's isOAuthDeviceProvider.
        authFlow: (
          modelProvidersRegistry[
            providerKey as keyof typeof modelProvidersRegistry
          ] as { authFlow?: "api-key" | "oauth-device" } | undefined
        )?.authFlow,
      }))
      .sort((a, b) => {
        const aDevice = a.authFlow === "oauth-device" ? 1 : 0;
        const bDevice = b.authFlow === "oauth-device" ? 1 : 0;
        return aDevice - bDevice;
      });
  }, []);

  const utils = api.useContext();

  useEffect(() => {
    if (!isProviderDrawerOpen) {
      // Refetch both providers and organization data when drawer closes
      void refetch();
      void utils.organization.getAll.invalidate();
      // And forget every connection verdict. A row's id does not change when
      // its credential does, so a verdict left standing here is a statement
      // about a key that may have just been replaced — including a green one,
      // which is the single thing this feature must never show without having
      // asked. See clearResults for the full argument.
      connectionTests.clearResults();
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
              The shared ScopeFilter primitive carries the caret icon +
              "More Scopes" submenu (see scope-filter.feature). */}
          <ScopeFilterComponent
            value={scopeFilter}
            onChange={handleScopeFilterChange}
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
            disabledReason={addProviderDisabledReason}
            onPick={(providerKey) => {
              openDrawer("editModelProvider", {
                projectId,
                organizationId,
                providerKey,
                modelProviderId: "new",
              });
            }}
          >
            <PageLayout.HeaderButton disabled={!!addProviderDisabledReason}>
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
                  disabledReason={addProviderDisabledReason}
                  onPick={(providerKey) => {
                    openDrawer("editModelProvider", {
                      projectId,
                      organizationId: organization?.id,
                      providerKey,
                      modelProviderId: "new",
                    });
                  }}
                >
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!addProviderDisabledReason}
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
            <Card.Body paddingY={0} paddingX={0} overflowX="auto">
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
                      ? (
                          (provider as any).scopes as Array<{
                            scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
                            scopeId: string;
                          }>
                        ).map((s) => ({
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
                      <Table.Row
                        key={provider.id ?? `system-${provider.provider}`}
                      >
                        <Table.Cell>
                          <HStack gap={3} align="center">
                            <Box width="24px" height="24px">
                              {providerIcon}
                            </Box>
                            <VStack gap={0} align="start">
                              <Text>
                                {(provider as { name?: string }).name ??
                                  providerSpec?.name ??
                                  provider.provider}
                              </Text>
                              <ConnectionTestVerdict
                                state={
                                  provider.id
                                    ? connectionTests.results[provider.id]
                                    : undefined
                                }
                              />
                            </VStack>
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
                          {/* System (env-fed) providers can't be edited
                              through the UI: their config lives in the
                              server's process env. Hide the menu so the
                              row reads as read-only at a glance. */}
                          {isSystem ? null : (
                            <Menu.Root>
                              <Tooltip
                                content={rowActionsDisabledReason ?? ""}
                                disabled={!rowActionsDisabledReason}
                              >
                                <TriggerAnchor>
                                  <Menu.Trigger asChild>
                                    <Button
                                      variant="ghost"
                                      disabled={!!rowActionsDisabledReason}
                                    >
                                      <MoreVertical />
                                    </Button>
                                  </Menu.Trigger>
                                </TriggerAnchor>
                              </Tooltip>
                              {!rowActionsDisabledReason && (
                                <Menu.Content>
                                  <Menu.Item
                                    value="edit"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openDrawer("editModelProvider", {
                                        projectId,
                                        organizationId,
                                        modelProviderId: provider.id,
                                        providerKey: provider.provider,
                                      });
                                    }}
                                  >
                                    <Box
                                      display="flex"
                                      alignItems="center"
                                      gap={2}
                                    >
                                      <Edit size={14} />
                                      Edit Provider
                                    </Box>
                                  </Menu.Item>
                                  {/* Offered only where it can answer. Six of
                                      the registered providers credential in
                                      ways no listing endpoint exercises, and
                                      an action that can only ever report
                                      "we did not look" is worse than no
                                      action: it reads as broken rather than
                                      as inapplicable. The drawer hides it on
                                      the same answer, so the two surfaces
                                      cannot disagree about what is
                                      checkable. */}
                                  {isProviderProbeable({
                                    provider: provider.provider,
                                  }) && (
                                    <Menu.Item
                                      value="test"
                                      disabled={!provider.id}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        if (!provider.id) return;
                                        void connectionTests.test(provider.id);
                                      }}
                                    >
                                      <Box
                                        display="flex"
                                        alignItems="center"
                                        gap={2}
                                      >
                                        <PlugZap size={14} />
                                        Test Connection
                                      </Box>
                                    </Menu.Item>
                                  )}
                                  <Menu.Item
                                    value="delete"
                                    color="red"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setProviderToDelete({
                                        id: provider.id ?? undefined,
                                        provider: provider.provider,
                                        // Match the row label (the instance name,
                                        // e.g. "OpenAI2") instead of the generic
                                        // registry name so the dialog names the
                                        // exact provider the user clicked.
                                        name:
                                          (provider as { name?: string })
                                            .name ??
                                          providerSpec?.name ??
                                          provider.provider,
                                        projectId,
                                        organizationId,
                                      });
                                    }}
                                  >
                                    <Box
                                      display="flex"
                                      alignItems="center"
                                      gap={2}
                                    >
                                      <Trash2 size={14} />
                                      Delete Provider
                                    </Box>
                                  </Menu.Item>
                                </Menu.Content>
                              )}
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
            with getAllForProject above, instead of waterfalling.
            Defaults are a per-project setting, so before the first
            project the section has nothing to read and stays out. */}
        {projectId && (
          <DefaultModelsSection
            filter={scopeFilter}
            onFilterChange={handleScopeFilterChange}
            enabledProviderKeys={enabledProviderKeys}
            noProvidersConfigured={!isLoading && enabledProviders.length === 0}
            hierarchy={hierarchy}
            displayNames={defaultModelsDisplayNames}
          />
        )}

        {/* The codex drawer closes itself the moment its sign-in completes
            (the poll persisted the row already); the coding-defaults ask it
            queues is rendered here, on the page, so the question survives
            the drawer. */}
        <CodexCodingDefaultsAskHost />

        <Dialog.Root
          open={!!providerToDelete}
          onOpenChange={(details) => {
            if (!details.open) {
              setProviderToDelete(null);
            }
          }}
        >
          <Dialog.Content bg="bg">
            <Dialog.Header>
              <Dialog.Title>Delete {providerToDelete?.name}?</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <VStack gap={3} align="start">
                <Text>
                  This permanently deletes the provider and its stored API keys.
                  This cannot be undone.
                </Text>
                <Text fontSize="sm" color="fg.muted">
                  Default model configs that reference this provider will
                  surface as &ldquo;Update needed&rdquo; in the table below.
                </Text>
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
                  if (!providerToDelete) return;
                  await deleteMutation.mutateAsync({
                    id: providerToDelete.id,
                    projectId: providerToDelete.projectId,
                    organizationId: providerToDelete.organizationId,
                    provider: providerToDelete.provider,
                  });
                  setProviderToDelete(null);
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
                Delete
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
 *
 * `disabledReason` is the single switch: set it and the trigger is
 * inert with that reason on hover, and no menu is mounted at all, so
 * adding can never open onto a list of providers that lead nowhere.
 */
function AddModelProviderMenu({
  children,
  addableProviders,
  disabledReason,
  onPick,
}: {
  children: React.ReactNode;
  addableProviders: Array<{
    provider: string;
    name: string;
    icon: React.ReactNode;
  }>;
  disabledReason: string | undefined;
  onPick: (providerKey: string) => void;
}) {
  if (disabledReason) {
    return (
      <Tooltip content={disabledReason}>
        <TriggerAnchor>{children}</TriggerAnchor>
      </Tooltip>
    );
  }

  return (
    <Menu.Root>
      <TriggerAnchor>
        <Menu.Trigger asChild>{children}</Menu.Trigger>
      </TriggerAnchor>
      <Menu.Content>
        {addableProviders.map((provider) => (
          <Menu.Item
            key={provider.provider}
            value={provider.provider}
            onClick={() => onPick(provider.provider)}
          >
            <HStack gap={3}>
              <Box width="20px" height="20px">
                {provider.icon}
              </Box>
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
    <Card.Root
      width="full"
      overflow="hidden"
      data-testid="providers-table-skeleton"
    >
      <Card.Body paddingY={0} paddingX={0} overflowX="auto">
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
                  <Skeleton
                    width="24px"
                    height="24px"
                    borderRadius="md"
                    marginLeft="auto"
                  />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Card.Body>
    </Card.Root>
  );
}
