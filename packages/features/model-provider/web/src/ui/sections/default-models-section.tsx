/**
 * Default Models — the table of every policy the caller can see, one row per
 * policy, with scope chips on the left and the role-level models in the
 * matching columns.
 *
 * The page-level scope filter narrows the rows inclusively (parents + children
 * of the picked scope). Same predicate the Model Providers table above uses, so
 * both tables reveal and hide the same branch of the org tree when the filter
 * changes.
 *
 * "+ Add config" and each row's Edit open `defaultModelOverride`, a registered
 * drawer that is still `platform/app`'s. The screen names it and the host writes
 * the address — see `ModelProviderHostPort.openPlatformDrawer` for the gap that
 * leaves.
 *
 * Moved from `platform/app/src/components/settings/DefaultModelsSection.tsx`,
 * whose only consumers were the model-providers page and its own two tests. The
 * uncontrolled mode went with the move: the section is mounted in exactly one
 * place and always by a page that owns the filter, so the local-state branch and
 * the duplicate filter dropdown it rendered were dead in production and alive
 * only in a test.
 *
 * Contract: specs/model-providers/role-based-default-models.feature and
 * specs/model-providers/model-default-config-cascade.feature.
 */

import {
  Badge,
  Box,
  Button,
  Card,
  EmptyState,
  Heading,
  HStack,
  IconButton,
  Skeleton,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import type {
  ModelDefaultConfigSnapshot,
  ModelDefaultFeature,
  ModelProviderScopeType,
} from "@langwatch/model-provider-contract";
import {
  Building2,
  Edit,
  Folder,
  MoreVertical,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { modelProviderApi } from "../../behavior/model-provider-api";
import type { ScopeFilterValue, ScopeHierarchy } from "../../model/provider-scope-filter";
import {
  compareConfigsByScopeThenName,
  mostSpecificScope,
  resolveAtScope,
  MODEL_ROLES,
  MODEL_ROLE_LABEL,
  type AnchorScope,
  type ModelRoleKey,
} from "../../model/default-model-cascade";
import { useModelProviderHost } from "../../model/model-provider-host";
import { filterRowsByScope } from "../../model/provider-scope-filter";
import { ModelChip } from "../elements/model-chip";

type ConfigRow = ModelDefaultConfigSnapshot;

interface DefaultModelsSectionProps {
  /** The page header's filter, which narrows this table and the one above it. */
  filter: ScopeFilterValue;
  /** Provider keys currently enabled and reachable from the active scope set.
   *  Used to flag cells whose `provider/...` prefix isn't in the set as needing
   *  an update. `null` skips the check. */
  enabledProviderKeys: Set<string> | null;
  /** Whether the page already knows the project has zero enabled providers. The
   *  section hides itself entirely when this is true AND there are also zero
   *  configs (fresh accounts). Old accounts that nuked their providers keep
   *  seeing the orphan-config table so they can fix it. */
  noProvidersConfigured: boolean;
  /** Org graph the inclusive scope filter and the cascade walk resolve against. */
  hierarchy: ScopeHierarchy;
  /** Configured custom-model display names, keyed by `<provider>/<modelId>`. */
  displayNames: Record<string, string>;
}

export function DefaultModelsSection({
  filter,
  enabledProviderKeys,
  noProvidersConfigured,
  hierarchy,
  displayNames,
}: DefaultModelsSectionProps) {
  const host = useModelProviderHost();
  const { projectId, teamId } = host.scope();

  const dataQuery = modelProviderApi.modelProvider.getDefaultModelsForProject.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );

  const utils = modelProviderApi.useUtils();
  const deleteMutation = modelProviderApi.modelProvider.deleteDefaultModelsConfig.useMutation();
  const handleDelete = async (config: ConfigRow) => {
    try {
      await deleteMutation.mutateAsync({ id: config.id });
      // Refresh every default-model cache so the surfaces that gate on
      // "is a default configured?" — the prompts page, the evaluation wizard —
      // pick the removal up without a window-focus refetch.
      await utils.modelProvider.invalidate();
      host.succeeded({ title: "Config deleted" });
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't remove the default model" });
    }
  };

  const visibleConfigs = useMemo(() => {
    const all = dataQuery.data?.configs ?? [];
    // The row's scopes spell the pair `{ type, id }` rather than
    // `{ scopeType, scopeId }`, so they are renamed on the way into the shared
    // predicate rather than the predicate being taught a second spelling.
    const filtered = filterRowsByScope(
      all.map((config) => ({
        config,
        scopes: config.scopes.map((scope) => ({
          scopeType: scope.type,
          scopeId: scope.id,
        })),
      })),
      filter,
      { hierarchy, currentTeamId: teamId ?? null, currentProjectId: projectId ?? null },
    ).map((entry) => entry.config);
    // Rows read broadest scope first (organization, then team, then project),
    // and by scope name within a tier, so the same order the Model Providers
    // table above and the virtual-key picker use.
    return [...filtered].sort(compareConfigsByScopeThenName);
  }, [dataQuery.data?.configs, filter, teamId, projectId, hierarchy]);

  if (dataQuery.isLoading || !dataQuery.data) {
    return (
      <VStack gap={3} width="full" align="stretch" data-testid="default-models-section">
        <DefaultModelsHeading />
        <DefaultModelsTableSkeleton />
      </VStack>
    );
  }

  const data = dataQuery.data;

  // Fresh accounts (no providers + no configs) hide the section entirely so the
  // page reads as a single "add a provider to get started" affordance. Old
  // accounts that nuked their providers but still have orphan configs DO see the
  // table (with red "Update needed" badges) so they can rebuild from there.
  // Hidden via display:none rather than an early return so the
  // getDefaultModelsForProject observer stays mounted and reacts to an
  // invalidation the moment a provider is added, with no waterfall remount.
  const isHidden = noProvidersConfigured && data.configs.length === 0;

  const openAdd = () => host.openPlatformDrawer({ drawer: "defaultModelOverride" });
  const openEdit = (config: ConfigRow) =>
    host.openPlatformDrawer({
      drawer: "defaultModelOverride",
      params: { editingId: config.id },
    });

  return (
    <VStack
      gap={3}
      width="full"
      align="stretch"
      data-testid="default-models-section"
      display={isHidden ? "none" : "flex"}
    >
      <HStack gap={3} align="center" justify="space-between">
        <DefaultModelsHeading />
        <Button size="sm" variant="outline" data-testid="add-config-button" onClick={openAdd}>
          <HStack gap={1}>
            <Plus size={14} />
            <Text>Add config</Text>
          </HStack>
        </Button>
      </HStack>

      <Card.Root width="full" overflow="hidden">
        <Card.Body paddingX={0} paddingY={0} overflowX="auto">
          <AllConfigsView
            configs={visibleConfigs}
            allConfigs={data.configs}
            features={data.features}
            hierarchy={hierarchy}
            onEdit={openEdit}
            onDelete={handleDelete}
            onAdd={openAdd}
            enabledProviderKeys={enabledProviderKeys}
            displayNames={displayNames}
          />
        </Card.Body>
      </Card.Root>
    </VStack>
  );
}

function DefaultModelsHeading() {
  return (
    <VStack align="start" gap={1}>
      <Heading as="h3" size="md">
        Default Models
      </Heading>
      <Text fontSize="sm" color="fg.muted">
        AI features across the platform: prompt creation, evaluations, traces search, topic
        clustering and more
      </Text>
    </VStack>
  );
}

function AllConfigsView({
  configs,
  allConfigs,
  features,
  hierarchy,
  onEdit,
  onDelete,
  onAdd,
  enabledProviderKeys,
  displayNames,
}: {
  configs: ConfigRow[];
  /** Full cascade input. `configs` is filter-narrowed for display, but cells
   *  still walk the full set when resolving inherited models so the visible row
   *  reflects what code on that scope would actually see at runtime. */
  allConfigs: readonly ConfigRow[];
  features: readonly ModelDefaultFeature[];
  hierarchy: ScopeHierarchy;
  onEdit: (config: ConfigRow) => void;
  onDelete: (config: ConfigRow) => void;
  onAdd: () => void;
  enabledProviderKeys: Set<string> | null;
  displayNames: Record<string, string>;
}) {
  if (configs.length === 0) {
    return (
      <EmptyState.Root width="full" paddingY={10}>
        <EmptyState.Content>
          <EmptyState.Indicator>
            <SlidersHorizontal size={24} />
          </EmptyState.Indicator>
          <VStack textAlign="center" gap={2}>
            <EmptyState.Title>No default models configured</EmptyState.Title>
            <EmptyState.Description>
              Define a default model for prompt creation, evaluations, traces search, topic
              clustering and more.
            </EmptyState.Description>
            <Button
              size="sm"
              variant="outline"
              onClick={onAdd}
              data-testid="empty-state-add-config"
            >
              Select default models
            </Button>
          </VStack>
        </EmptyState.Content>
      </EmptyState.Root>
    );
  }
  return (
    <Table.Root variant="line" size="md" width="full">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Scopes</Table.ColumnHeader>
          {MODEL_ROLES.map((role) => (
            <Table.ColumnHeader key={role}>{MODEL_ROLE_LABEL[role]}</Table.ColumnHeader>
          ))}
          <Table.ColumnHeader textAlign="right" />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {configs.map((config) => (
          <Table.Row key={config.id} data-testid={`config-row-${config.id}`}>
            <Table.Cell>
              <HStack gap={2} flexWrap="wrap">
                {config.scopes.map((scope) => (
                  <ScopeChip
                    key={`${scope.type}:${scope.id}`}
                    type={scope.type}
                    name={scope.name}
                  />
                ))}
              </HStack>
            </Table.Cell>
            {MODEL_ROLES.map((role) => (
              <Table.Cell
                key={role}
                data-testid={`config-row-${config.id}-cell-${role.toLowerCase()}`}
              >
                <ConfigCell
                  role={role}
                  config={config.config}
                  features={features}
                  configs={allConfigs}
                  anchorScope={mostSpecificScope(config.scopes)}
                  hierarchy={hierarchy}
                  onEdit={() => onEdit(config)}
                  enabledProviderKeys={enabledProviderKeys}
                  displayNames={displayNames}
                />
              </Table.Cell>
            ))}
            <Table.Cell textAlign="right">
              {/* Matches the model-providers table: a vertical 3-dot menu with
                  Edit + Delete rather than a pencil in the row and a Delete
                  button buried in the drawer footer. */}
              <Menu.Root>
                <Menu.Trigger asChild>
                  <IconButton
                    size="xs"
                    variant="ghost"
                    aria-label="Config actions"
                    data-testid={`config-row-${config.id}-actions`}
                  >
                    <MoreVertical size={14} />
                  </IconButton>
                </Menu.Trigger>
                <Menu.Content>
                  <Menu.Item
                    value="edit"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEdit(config);
                    }}
                    data-testid={`config-row-${config.id}-edit`}
                  >
                    <Box display="flex" alignItems="center" gap={2}>
                      <Edit size={14} />
                      Edit config
                    </Box>
                  </Menu.Item>
                  <Menu.Item
                    value="delete"
                    color="red"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(config);
                    }}
                    data-testid={`config-row-${config.id}-delete`}
                  >
                    <Box display="flex" alignItems="center" gap={2}>
                      <Trash2 size={14} />
                      Delete config
                    </Box>
                  </Menu.Item>
                </Menu.Content>
              </Menu.Root>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}

function ConfigCell({
  role,
  config,
  features,
  configs,
  anchorScope,
  hierarchy,
  onEdit,
  enabledProviderKeys,
  displayNames,
}: {
  role: ModelRoleKey;
  config: Record<string, string>;
  features: readonly ModelDefaultFeature[];
  configs: readonly ConfigRow[];
  anchorScope: AnchorScope | null;
  hierarchy: ScopeHierarchy;
  /** Opens the row's edit drawer. Wired to the hover-revealed pencil next to
   *  each chip so the reader can go from "I want to change this model" to the
   *  drawer without hunting for the 3-dot menu. Edits the whole policy, not
   *  just the cell. */
  onEdit: () => void;
  enabledProviderKeys: Set<string> | null;
  displayNames: Record<string, string>;
}) {
  const isInvalid = (model: string) =>
    !!enabledProviderKeys && !enabledProviderKeys.has(model.split("/")[0] ?? "");
  // The table is a "final resolved state" view: every cell renders the
  // cascade-resolved role model for the row's scope, whether the policy on this
  // row pins it or inherits it from a wider tier. If nothing in the cascade
  // carries the role, the cell renders a "Not configured" badge — AI features
  // for this role are disabled at this scope until the reader fixes it.
  const resolvedRole = anchorScope
    ? resolveAtScope({ key: role, configs, anchor: anchorScope, hierarchy })
    : null;
  const resolvedRoleModel = resolvedRole?.model ?? config[role] ?? null;

  // Feature override rows render only when THIS policy pins a feature key AND
  // its value differs from the role-resolved model. If the role is itself
  // unresolved, any feature override IS the new effective value, so it surfaces
  // regardless.
  const featureOverrides = features
    .filter((feature) => feature.role === role && config[feature.key])
    .filter((feature) => config[feature.key] !== resolvedRoleModel);

  return (
    <VStack align="start" gap={1}>
      <ChipWithEdit onEdit={onEdit}>
        {resolvedRoleModel ? (
          <ModelChip
            model={resolvedRoleModel}
            size="sm"
            invalid={isInvalid(resolvedRoleModel)}
            displayNames={displayNames}
          />
        ) : (
          <Badge colorPalette="orange" variant="subtle">
            Not configured
          </Badge>
        )}
      </ChipWithEdit>
      {featureOverrides.map((feature) => (
        <ChipWithEdit key={feature.key} onEdit={onEdit} paddingLeft={4}>
          <Text fontSize="xs" color="fg.muted">
            {feature.displayName}
          </Text>
          <ModelChip
            model={config[feature.key]!}
            size="sm"
            invalid={isInvalid(config[feature.key]!)}
            displayNames={displayNames}
          />
        </ChipWithEdit>
      ))}
    </VStack>
  );
}

/**
 * Hover-revealed pencil next to a model chip. Click jumps straight to the row's
 * edit drawer so the reader does not have to hunt for the 3-dot menu when they
 * are already eyeing the model they want to change. The drawer edits the whole
 * policy, not just the cell, which matches the data model — one config is one
 * JSON blob across roles.
 */
function ChipWithEdit({
  children,
  onEdit,
  paddingLeft,
}: {
  children: ReactNode;
  onEdit: () => void;
  paddingLeft?: number;
}) {
  // Reveal a pencil button on cell hover. Chakra v3's `_groupHover` relies on a
  // recipe wiring this does not have, so the rule is expressed as raw CSS that
  // is also more obvious about the intent: hover anywhere on this HStack →
  // make `.chip-edit` visible.
  return (
    <HStack
      gap={2}
      paddingLeft={paddingLeft}
      align="center"
      css={{
        "& .chip-edit": { opacity: 0, transition: "opacity 120ms" },
        "&:hover .chip-edit, &:focus-within .chip-edit": { opacity: 1 },
      }}
    >
      {children}
      <IconButton
        className="chip-edit"
        size="xs"
        variant="ghost"
        aria-label="Edit policy"
        onClick={onEdit}
      >
        <Pencil size={12} />
      </IconButton>
    </HStack>
  );
}

function ScopeChip({ type, name }: { type: ModelProviderScopeType; name: string }) {
  const palette = type === "ORGANIZATION" ? "blue" : type === "TEAM" ? "purple" : "gray";
  const Icon = type === "ORGANIZATION" ? Building2 : type === "TEAM" ? Users : Folder;
  return (
    <Badge colorPalette={palette} variant="subtle">
      <HStack gap={1}>
        <Icon size={12} aria-hidden />
        <Text>{name}</Text>
      </HStack>
    </Badge>
  );
}

function DefaultModelsTableSkeleton() {
  return (
    <Card.Root width="full" overflow="hidden" data-testid="default-models-table-skeleton">
      <Card.Body paddingY={0} paddingX={0} overflowX="auto">
        <Table.Root variant="line" size="md" width="full">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Scopes</Table.ColumnHeader>
              {MODEL_ROLES.map((role) => (
                <Table.ColumnHeader key={role}>{MODEL_ROLE_LABEL[role]}</Table.ColumnHeader>
              ))}
              <Table.ColumnHeader textAlign="right" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {[0, 1, 2].map((index) => (
              <Table.Row key={index}>
                <Table.Cell>
                  <Skeleton width="100px" height="20px" borderRadius="full" />
                </Table.Cell>
                {MODEL_ROLES.map((role) => (
                  <Table.Cell key={role}>
                    <Skeleton width="160px" height="16px" />
                  </Table.Cell>
                ))}
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
