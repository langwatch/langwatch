/**
 * Model Providers — every credential the reader can see, and the default models
 * that resolve from them.
 *
 * A provider belongs to the ORGANIZATION and reaches the scopes attached to it,
 * so the write path takes either handle and a project is only the narrower one.
 * An organization on the agent-governance track has no project until it needs
 * one, and organization scope is the default for a new credential, so every
 * action here works with or without a project. See
 * specs/model-providers/providers-without-a-project.feature.
 *
 * NO CREDENTIAL VALUE IS ON THIS PAGE. The list procedure answers rows whose
 * stored keys the service has already masked, the connection test sends a row
 * id and nothing else, and the one place a key is typed is the editor drawer,
 * which this screen only ADDRESSES.
 *
 * Moved from `platform/app/src/pages/settings/model-providers.tsx`. The one
 * thing that did not travel with it has since arrived: the Codex
 * coding-defaults ask, queued by the editor drawer's form and answered here.
 * It has to be a PAGE-level mount, because the drawer that queues it closes the
 * moment the connect completes — a dialog inside the drawer would be unmounted
 * mid-question — and both halves now live in this package, so the store they
 * talk through is one module rather than two.
 */

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
  ProviderScopeChips,
  ScopeFilter,
  scopeFilterAddressWrite,
  scopeFilterFromAddress,
  scopeHierarchyOf,
  type ScopeFilterValue,
} from "@langwatch/authz-web/surfaces/scope-picker";
import { Dialog } from "@langwatch/design-system/dialog";
import { Menu } from "@langwatch/design-system/menu";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { TriggerAnchor } from "@langwatch/design-system/trigger-anchor";
import { buildCustomModelDisplayNames } from "@langwatch/model-provider-contract";
import { BrainCircuit, Edit, MoreVertical, PlugZap, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { modelProviderApi } from "../../behavior/model-provider-api";
import { useAllModelProvidersList } from "../../behavior/use-all-model-providers-list";
import {
  useModelProviderConnectionTest,
  type ConnectionTestState,
} from "../../behavior/use-model-provider-connection-test";
import { useModelProviderHost } from "../../model/model-provider-host";
import { CodexCodingDefaultsAskHost } from "../../ui/sections/codex-coding-defaults-ask";
import {
  addableProviders,
  scopeNamesOf,
  sortProvidersForTable,
} from "../../model/provider-catalogue";
import { filterRowsByScope } from "../../model/provider-scope-filter";
import { DefaultModelsSection } from "../../ui/sections/default-models-section";
import { modelProviderIcons } from "../../ui/elements/model-provider-icons";

/** The grant that decides whether this page can be written to at all. */
export const MODEL_PROVIDER_MANAGE_PERMISSION = "project:manage";

/** The query parameter the page-level scope filter lives in. */
export const MODEL_PROVIDER_SCOPE_QUERY_KEY = "scope";

export default function ModelProvidersScreen() {
  const host = useModelProviderHost();
  const { organizationId, projectId, teamId } = host.scope();
  const hasManagePermission = host.hasPermission(MODEL_PROVIDER_MANAGE_PERMISSION);

  // One reason string per blocked action, `undefined` when the action works.
  // Whatever is rendered inert carries its reason in a tooltip, so no control on
  // this page can be clicked into silence.
  const addProviderDisabledReason = hasManagePermission
    ? undefined
    : "You need model provider manage permissions to add new providers.";
  const rowActionsDisabledReason = hasManagePermission
    ? undefined
    : "You need model provider manage permissions to edit or delete providers.";

  // Verdicts live for as long as the page is open and are keyed by row, so
  // testing one provider never overwrites what another just reported.
  const connectionTests = useModelProviderConnectionTest({ projectId, organizationId });
  // Flat, uncollapsed list — see useAllModelProvidersList for why this table
  // can't use the collapsed Record a per-provider surface reads.
  const { providers: allProvidersList, isLoading, refetch } = useAllModelProvidersList();

  const reading = host.route();
  // The editor drawer is `platform/app`'s and this screen only writes its
  // address, so "is it open" is the address, which is exactly what the platform
  // hook read too (`router.query["drawer.open"] === drawer`).
  const isProviderDrawerOpen = reading.query["drawer.open"] === "editModelProvider";

  const deleteMutation = modelProviderApi.modelProvider.delete.useMutation();
  // Carries the tenant the row was opened from, so the confirm button always has
  // the tenant the deletion runs against.
  const [providerToDelete, setProviderToDelete] = useState<{
    id?: string;
    provider: string;
    name: string;
  } | null>(null);

  // The scopes the reader can see: the filter's options, and the names the
  // per-row chips resolve their scope ids to.
  const available = host.availableScopes();
  const filterAvailable = useMemo(
    () => ({
      organization: available.organization,
      teams: available.teams,
      projects: available.projects,
    }),
    [available],
  );
  const hierarchy = useMemo(() => scopeHierarchyOf(filterAvailable), [filterAvailable]);
  const scopeNameById = useMemo(() => scopeNamesOf(available), [available]);

  // ONE scope filter drives both tables on this page. It is READ from the
  // address rather than mirrored into state: the platform hook kept a
  // `useState` synced to `?scope=` by an effect, and a mirror can only ever
  // disagree with the URL it is mirroring.
  const scopeFilter = useMemo(
    () =>
      scopeFilterFromAddress({
        raw: reading.query[MODEL_PROVIDER_SCOPE_QUERY_KEY],
        available: filterAvailable,
      }),
    [reading.query, filterAvailable],
  );

  const handleScopeFilterChange = (next: ScopeFilterValue) => {
    const write = scopeFilterAddressWrite(next, { teamId, projectId });
    if (write.kind === "keep") return;
    host.setQuery({
      ...reading.query,
      [MODEL_PROVIDER_SCOPE_QUERY_KEY]: write.kind === "clear" ? void 0 : write.value,
    });
  };

  const allEnabledProviders = useMemo(
    () => allProvidersList.filter((provider) => provider.enabled),
    [allProvidersList],
  );

  // Provider-key set the Default Models table uses to flag cells whose
  // `provider/...` model id no longer maps to an enabled provider. Use the ALL
  // set, not the scope-filtered one — a default config attached at TEAM scope is
  // still valid when the table is filtered to PROJECT, because the cascade
  // reaches it from the team tier.
  const enabledProviderKeys = useMemo(
    () => new Set(allEnabledProviders.map((provider) => provider.provider)),
    [allEnabledProviders],
  );

  // Display names for the Default Models table's chips, built from the ALL set
  // for the same reason as `enabledProviderKeys`.
  const defaultModelsDisplayNames = useMemo(
    () => buildCustomModelDisplayNames(allProvidersList),
    [allProvidersList],
  );

  // Client-side filter for the scope dropdown at the top of the page. The list
  // query returns every provider the caller can see; this narrows the visible
  // rows. See specs/model-providers/scope-filter.feature.
  const enabledProviders = useMemo(
    () =>
      sortProvidersForTable(
        filterRowsByScope(allEnabledProviders, scopeFilter, {
          hierarchy,
          currentTeamId: teamId ?? null,
          currentProjectId: projectId ?? null,
        }),
      ),
    [allEnabledProviders, scopeFilter, hierarchy, teamId, projectId],
  );

  const addable = useMemo(
    () =>
      addableProviders().map((entry) => ({
        ...entry,
        icon: modelProviderIcons[entry.provider as keyof typeof modelProviderIcons],
      })),
    [],
  );

  const utils = modelProviderApi.useUtils();

  useEffect(() => {
    if (isProviderDrawerOpen) return;
    // Refetch the providers and the organization graph when the editor closes.
    void refetch();
    void utils.organization.getAll.invalidate();
    // And forget every connection verdict. A row's id does not change when its
    // credential does, so a verdict left standing here is a statement about a
    // key that may have just been replaced — including a green one, which is
    // the single thing this feature must never show without having asked. See
    // clearResults for the full argument.
    connectionTests.clearResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProviderDrawerOpen]);

  const openProviderEditor = (params: { providerKey: string; modelProviderId: string }) =>
    host.openPlatformDrawer({
      drawer: "editModelProvider",
      params: {
        projectId,
        organizationId,
        providerKey: params.providerKey,
        modelProviderId: params.modelProviderId,
      },
    });

  return (
    <VStack gap={6} width="full" align="start">
      {/* The Codex post-connect question, mounted at page level because the
          drawer that queues it closes the moment the connect completes — see
          `CodexCodingDefaultsAskHost`. Nothing renders until a sign-in queues
          one. */}
      <CodexCodingDefaultsAskHost />
      <HStack width="full" marginTop={2}>
        <Heading as="h2">Model Providers</Heading>
        <Spacer />
        {/* Single scope filter for the whole page — narrows the Model Providers
            table and the Default Models table below. See
            specs/model-providers/scope-filter.feature. */}
        <ScopeFilter
          value={scopeFilter}
          onChange={handleScopeFilterChange}
          available={filterAvailable}
          currentTeamId={teamId}
          currentProjectId={projectId}
        />
        {/* There is no project selector here: Model Providers is an org-level
            surface. Scope is set per row in the editor's Scope picker, and each
            row's chips below show where it is reachable. Switching projects from
            this page used to silently rebind the credential to a different
            project, which the scope picker makes explicit instead. */}
        <AddModelProviderMenu
          addableProviders={addable}
          disabledReason={addProviderDisabledReason}
          onPick={(providerKey) => openProviderEditor({ providerKey, modelProviderId: "new" })}
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
                <EmptyState.Description>Add a model provider to get started</EmptyState.Description>
              </VStack>
              {/* The empty-state call to action mirrors the page header — same
                  menu, same grant, same handler. Without one right where the
                  reader is looking, the only way forward is the top-right button,
                  which is easy to miss on a fresh empty screen. */}
              <AddModelProviderMenu
                addableProviders={addable}
                disabledReason={addProviderDisabledReason}
                onPick={(providerKey) =>
                  openProviderEditor({ providerKey, modelProviderId: "new" })
                }
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
                  const namedScopes = provider.scopes?.map((scope) => ({
                    ...scope,
                    name: scopeNameById.get(scope.scopeId),
                  }));
                  const providerIcon =
                    modelProviderIcons[provider.provider as keyof typeof modelProviderIcons];
                  const isSystem = provider.isSystem === true;
                  return (
                    <Table.Row key={provider.id ?? `system-${provider.provider}`}>
                      <Table.Cell>
                        <HStack gap={3} align="center">
                          <Box width="24px" height="24px">
                            {providerIcon}
                          </Box>
                          <VStack gap={0} align="start">
                            <Text>{provider.name}</Text>
                            <ConnectionTestVerdict
                              state={provider.id ? connectionTests.results[provider.id] : void 0}
                            />
                          </VStack>
                        </HStack>
                      </Table.Cell>
                      <Table.Cell>
                        <ProviderScopeChips
                          scopes={namedScopes}
                          // Env-var-fed providers carry `isSystem`; the chip
                          // column reads "System" instead of an empty cell.
                          system={isSystem}
                        />
                      </Table.Cell>
                      <Table.Cell textAlign="right">
                        {/* System (env-fed) providers can't be edited through
                            the UI: their config lives in the server's process
                            env. Hide the menu so the row reads as read-only at
                            a glance. */}
                        {isSystem ? null : (
                          <Menu.Root>
                            <Tooltip
                              content={rowActionsDisabledReason ?? ""}
                              disabled={!rowActionsDisabledReason}
                            >
                              <TriggerAnchor>
                                <Menu.Trigger asChild>
                                  <Button variant="ghost" disabled={!!rowActionsDisabledReason}>
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
                                    openProviderEditor({
                                      providerKey: provider.provider,
                                      modelProviderId: provider.id,
                                    });
                                  }}
                                >
                                  <Box display="flex" alignItems="center" gap={2}>
                                    <Edit size={14} />
                                    Edit Provider
                                  </Box>
                                </Menu.Item>
                                <Menu.Item
                                  value="test"
                                  disabled={!provider.id}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (!provider.id) return;
                                    void connectionTests.test(provider.id);
                                  }}
                                >
                                  <Box display="flex" alignItems="center" gap={2}>
                                    <PlugZap size={14} />
                                    Test Connection
                                  </Box>
                                </Menu.Item>
                                <Menu.Item
                                  value="delete"
                                  color="red"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setProviderToDelete({
                                      id: provider.id ?? void 0,
                                      provider: provider.provider,
                                      // Match the row label (the instance name,
                                      // e.g. "OpenAI2") rather than the generic
                                      // registry name, so the dialog names the
                                      // exact provider the reader clicked.
                                      name: provider.name,
                                    });
                                  }}
                                >
                                  <Box display="flex" alignItems="center" gap={2}>
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

      {/* Default Models renders whenever the project has providers OR orphan
          default-model configs. The section hides itself when BOTH are empty
          (fresh accounts only) — an old account that nuked its providers still
          sees the table so it can spot and fix the now-invalid orphan defaults.
          Mounting it unconditionally lets its query fire in parallel with the
          provider list above instead of waterfalling. Defaults are a per-project
          setting, so before the first project the section has nothing to read
          and stays out. */}
      {projectId && (
        <DefaultModelsSection
          filter={scopeFilter}
          enabledProviderKeys={enabledProviderKeys}
          noProvidersConfigured={!isLoading && enabledProviders.length === 0}
          hierarchy={hierarchy}
          displayNames={defaultModelsDisplayNames}
        />
      )}

      <Dialog.Root
        open={!!providerToDelete}
        onOpenChange={(details) => {
          if (!details.open) setProviderToDelete(null);
        }}
      >
        <Dialog.Content bg="bg">
          <Dialog.Header>
            <Dialog.Title>Delete {providerToDelete?.name}?</Dialog.Title>
          </Dialog.Header>
          <Dialog.Body>
            <VStack gap={3} align="start">
              <Text>
                This permanently deletes the provider and its stored API keys. This cannot be
                undone.
              </Text>
              <Text fontSize="sm" color="fg.muted">
                Default model configs that reference this provider will surface as &ldquo;Update
                needed&rdquo; in the table below.
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
                try {
                  await deleteMutation.mutateAsync({
                    id: providerToDelete.id,
                    projectId,
                    organizationId,
                    provider: providerToDelete.provider,
                  });
                } catch (error) {
                  // The application used to leave this to a global interceptor
                  // that showed a modal; nothing above a package-served screen
                  // holds one, so the refusal is reported here. The raw error
                  // travels — the host resolves the words from its code.
                  host.failed({ error, fallbackTitle: "Couldn't delete this provider" });
                  return;
                }
                setProviderToDelete(null);
                await refetch();
                // Invalidate every cross-page query that gates UI on "are there
                // enabled providers?" so the prompts page and the evaluation
                // wizard pick the deletion up without a window-focus refetch.
                await utils.modelProvider.invalidate();
              }}
            >
              Delete
            </Button>
          </Dialog.Footer>
          <Dialog.CloseTrigger />
        </Dialog.Content>
      </Dialog.Root>
    </VStack>
  );
}

/**
 * What the last connection test said about this row.
 *
 * Three states, rendered three different ways on purpose. A check that could not
 * run reads as neutral rather than green: it is not a pass, and dressing it as
 * one would tell a customer their configuration is fine on the strength of never
 * having asked.
 *
 * The whole verdict lives in a polite live region. The text arrives well after
 * the click that asked for it, and a screen reader announces neither the
 * "Testing…" transition nor the answer replacing it — so without this the
 * control is a button that appears to do nothing at all.
 */
function ConnectionTestVerdict({ state }: { state: ConnectionTestState | undefined }) {
  const verdict = () => {
    if (!state) return null;

    if (state.status === "testing") {
      return (
        <Text fontSize="xs" color="fg.muted">
          Testing…
        </Text>
      );
    }

    if (state.status === "works") {
      return (
        <Text fontSize="xs" color="green.fg">
          Connection works
        </Text>
      );
    }

    return (
      <Text fontSize="xs" color={state.status === "refused" ? "red.fg" : "fg.muted"}>
        {state.message}
      </Text>
    );
  };

  return (
    <Box aria-live="polite" aria-atomic="true">
      {verdict()}
    </Box>
  );
}

/**
 * The shared "Add Model Provider" menu — same provider list, same grant, same
 * handler — wrapped around whatever trigger the caller passes (the header button
 * and the empty state's outline button). One helper for both call sites means
 * the provider list never drifts between the two surfaces.
 *
 * `disabledReason` is the single switch: set it and the trigger is inert with
 * that reason on hover, and no menu is mounted at all, so adding can never open
 * onto a list of providers that lead nowhere.
 */
function AddModelProviderMenu({
  children,
  addableProviders: providers,
  disabledReason,
  onPick,
}: {
  children: ReactNode;
  addableProviders: Array<{ provider: string; name: string; icon: ReactNode }>;
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
        {providers.map((provider) => (
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
 * Skeleton render of the providers table — keeps the page from flashing a bare
 * spinner on first load (or on a refocus refetch that follows an upstream
 * error). Matches the real table's shape (header + three rows of provider chip,
 * scope chip and 3-dot menu) so the layout doesn't jump when the data lands.
 */
function ProvidersTableSkeleton() {
  return (
    <Card.Root width="full" overflow="hidden" data-testid="providers-table-skeleton">
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
            {[0, 1, 2].map((index) => (
              <Table.Row key={index}>
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
