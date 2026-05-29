/**
 * Default Models settings page section — table view of every
 * ModelDefaultConfig the caller can see. One row per policy, with
 * scope chips on the left and the role-level models in the matching
 * columns.
 *
 * The page-level scope filter narrows the rows inclusively (parents +
 * children of the picked scope). Same predicate the Model Providers
 * table above uses, so both tables reveal/hide the same branch of the
 * org tree when the filter changes.
 *
 * "+ Add config" opens `DefaultModelOverrideDrawer`. Each row carries
 * an Edit button that opens the same drawer pre-filled.
 *
 * See specs/model-providers/role-based-default-models.feature for the
 * behavioural contract and specs/model-providers/model-default-config-cascade.feature
 * for the resolver / storage contract.
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
// Wrapped Menu uses a Portal under the hood so Menu.Content overlays
// the page instead of rendering inline inside the <td>, which would
// push the row's other cells to a wrapped line on open (caught on
// 2026-05-18 dogfood, Image #118).
import { Menu } from "../ui/menu";
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
import React, { useMemo, useState } from "react";

import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import {
  ScopeFilter as ScopeFilterComponent,
  type ScopeFilter,
} from "./ScopeFilter";
import { ModelChip } from "./ModelChip";
import { toaster } from "~/components/ui/toaster";
import {
  isScopeInFilter,
  resolveScopeFilter,
  type ScopeHierarchy,
} from "~/utils/filterProvidersByScope";

type Payload = RouterOutputs["modelProvider"]["getDefaultModelsForProject"];
type ConfigRow = Payload["configs"][number];
type ModelRoleKey = "DEFAULT" | "FAST" | "EMBEDDINGS";

const ROLES: ModelRoleKey[] = ["DEFAULT", "FAST", "EMBEDDINGS"];

const ROLE_LABEL: Record<ModelRoleKey, string> = {
  DEFAULT: "Default",
  FAST: "Fast",
  EMBEDDINGS: "Embeddings",
};

interface DefaultModelsSectionProps {
  /** Optional controlled filter from the page-level header dropdown.
   *  When omitted the section keeps its own local state (used by tests
   *  and standalone embeddings). */
  filter?: ScopeFilter;
  onFilterChange?: (next: ScopeFilter) => void;
  /** Provider keys currently enabled + reachable from the active scope
   *  set, e.g. `new Set(["anthropic"])`. Used to flag default-model
   *  cells whose `provider/...` prefix isn't in the set as invalid /
   *  needs-update. Pass `null` (or omit) to skip the check — useful for
   *  standalone embeddings where the page can't tell. */
  enabledProviderKeys?: Set<string> | null;
  /** Whether the parent already knows the project has zero enabled
   *  providers. The section hides itself entirely when this is true
   *  AND the user also has zero configs (fresh accounts). Old accounts
   *  that nuked their providers keep seeing the orphan-config table so
   *  they can fix it. */
  noProvidersConfigured?: boolean;
  /** Org graph used to resolve inclusive scope filtering (parents +
   *  children of the picked scope). When omitted, falls back to the
   *  org returned from the tRPC payload — fine for standalone mounts. */
  hierarchy?: ScopeHierarchy;
}

export function DefaultModelsSection({
  filter: controlledFilter,
  onFilterChange,
  enabledProviderKeys,
  noProvidersConfigured = false,
  hierarchy,
}: DefaultModelsSectionProps = {}) {
  const { project, team, organization } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const dataQuery = api.modelProvider.getDefaultModelsForProject.useQuery(
    { projectId },
    { enabled: !!projectId },
  );

  const [localFilter, setLocalFilter] = useState<ScopeFilter>({ kind: "all" });
  const filter = controlledFilter ?? localFilter;
  const setFilter = onFilterChange ?? setLocalFilter;
  const { openDrawer } = useDrawer();

  const utils = api.useContext();
  const deleteMutation =
    api.modelProvider.deleteDefaultModelsConfig.useMutation();
  const handleDelete = async (c: ConfigRow) => {
    try {
      await deleteMutation.mutateAsync({ id: c.id });
      await Promise.all([
        utils.modelProvider.getDefaultModelsForProject.invalidate(),
        utils.modelProvider.getResolvedDefault.invalidate(),
      ]);
      toaster.create({
        title: "Config deleted",
        type: "success",
        duration: 2500,
        meta: { closable: true },
      });
    } catch (err) {
      toaster.create({
        title: "Failed to delete",
        description: err instanceof Error ? err.message : String(err),
        type: "error",
        duration: 6000,
        meta: { closable: true },
      });
    }
  };

  const effectiveHierarchy: ScopeHierarchy = useMemo(() => {
    if (hierarchy) return hierarchy;
    const available = dataQuery.data?.available;
    return {
      organization: available?.organization
        ? { id: available.organization.id }
        : null,
      teams: (available?.teams ?? []).map((t) => ({ id: t.id })),
      projects: (available?.projects ?? []).map((p) => ({
        id: p.id,
        teamId: p.teamId ?? null,
      })),
    };
  }, [hierarchy, dataQuery.data?.available]);

  const visibleConfigs = useMemo(() => {
    const all = dataQuery.data?.configs ?? [];
    const resolved = resolveScopeFilter(filter, {
      currentTeamId: team?.id ?? null,
      currentProjectId: project?.id ?? null,
    });
    if (resolved.kind === "all") return all;
    return all.filter((c) =>
      c.scopes.some((s) =>
        isScopeInFilter(
          { scopeType: s.type, scopeId: s.id },
          resolved,
          effectiveHierarchy,
        ),
      ),
    );
  }, [dataQuery.data?.configs, filter, team?.id, project?.id, effectiveHierarchy]);

  if (dataQuery.isLoading || !dataQuery.data) {
    return (
      <VStack
        gap={3}
        width="full"
        align="stretch"
        data-testid="default-models-section"
      >
        <VStack align="start" gap={1}>
          <Heading as="h3" size="md">
            Default Models
          </Heading>
          <Text fontSize="sm" color="fg.muted">
            AI features across the platform: prompt creation, evaluations, traces search, topic clustering and more
          </Text>
        </VStack>
        <DefaultModelsTableSkeleton />
      </VStack>
    );
  }

  const data = dataQuery.data;

  // Fresh accounts (no providers + no configs) hide the section
  // entirely so the page reads as a single "add a provider to get
  // started" affordance. Old accounts that nuked their providers but
  // still have orphan configs DO see the table (with red 'Update
  // needed' badges) so they can rebuild from there.
  // Hide via display:none rather than return null so the
  // getDefaultModelsForProject tRPC observer stays mounted and
  // continues to react to invalidations the moment a provider is
  // added (no waterfall remount).
  const isHidden = noProvidersConfigured && data.configs.length === 0;

  const openAdd = () => {
    openDrawer("defaultModelOverride", {});
  };
  const openEdit = (c: ConfigRow) => {
    openDrawer("defaultModelOverride", { editingId: c.id });
  };

  return (
    <VStack
      gap={3}
      width="full"
      align="stretch"
      data-testid="default-models-section"
      display={isHidden ? "none" : "flex"}
    >
      <HStack gap={3} align="center" justify="space-between">
        <VStack align="start" gap={1}>
          <Heading as="h3" size="md">
            Default Models
          </Heading>
          <Text fontSize="sm" color="fg.muted">
            AI features across the platform: prompt creation, evaluations, traces search, topic clustering and more
          </Text>
        </VStack>
        <HStack gap={2}>
          {/* When the section is uncontrolled (mounted outside the
              settings page), render its own filter dropdown for parity.
              In the controlled case the filter lives in the page header,
              so we skip rendering it here to avoid the duplicate. */}
          {controlledFilter === undefined && (
            <ScopeFilterComponent
              value={filter}
              onChange={setFilter}
              available={data.available}
              currentTeamId={team?.id}
              currentProjectId={project?.id}
            />
          )}
          <Button
            size="sm"
            variant="outline"
            data-testid="add-config-button"
            onClick={openAdd}
          >
            <HStack gap={1}>
              <Plus size={14} />
              <Text>Add config</Text>
            </HStack>
          </Button>
        </HStack>
      </HStack>

      <Card.Root width="full" overflow="hidden">
        <Card.Body paddingX={0} paddingY={0}>
          <AllConfigsView
            configs={visibleConfigs}
            allConfigs={data.configs}
            features={data.features}
            onEdit={openEdit}
            onDelete={handleDelete}
            onAdd={openAdd}
            enabledProviderKeys={enabledProviderKeys ?? null}
          />
        </Card.Body>
      </Card.Root>

    </VStack>
  );
}

// ─── "All you can see" view ────────────────────────────────────────

function AllConfigsView({
  configs,
  allConfigs,
  features,
  onEdit,
  onDelete,
  onAdd,
  enabledProviderKeys,
}: {
  configs: ConfigRow[];
  /** Full cascade input. `configs` is filter-narrowed for display, but
   *  cells still walk the full set when resolving inherited models so
   *  the visible row reflects what code on that scope would actually
   *  see at runtime. */
  allConfigs: ConfigRow[];
  features: Payload["features"];
  onEdit: (c: ConfigRow) => void;
  onDelete: (c: ConfigRow) => void;
  onAdd: () => void;
  enabledProviderKeys: Set<string> | null;
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
              Define a default model for prompt creation, evaluations, traces search, topic clustering and more.
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
          <Table.ColumnHeader>Default</Table.ColumnHeader>
          <Table.ColumnHeader>Fast</Table.ColumnHeader>
          <Table.ColumnHeader>Embeddings</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="right" />
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {configs.map((c) => (
          <Table.Row key={c.id} data-testid={`config-row-${c.id}`}>
            <Table.Cell>
              <HStack gap={2} flexWrap="wrap">
                {c.scopes.map((s) => (
                  <ScopeChip key={`${s.type}:${s.id}`} type={s.type} name={s.name} />
                ))}
              </HStack>
            </Table.Cell>
            {ROLES.map((role) => (
              <Table.Cell
                key={role}
                data-testid={`config-row-${c.id}-cell-${role.toLowerCase()}`}
              >
                <ConfigCell
                  role={role}
                  config={c.config as Record<string, string>}
                  features={features}
                  configs={allConfigs}
                  anchorScope={mostSpecificScope(c.scopes)}
                  onEdit={() => onEdit(c)}
                  enabledProviderKeys={enabledProviderKeys}
                />
              </Table.Cell>
            ))}
            <Table.Cell textAlign="right">
              {/* Matches the model-providers table: vertical 3-dot menu
                  with Edit + Delete instead of a pencil in the row and a
                  Delete button buried in the drawer footer. */}
              <Menu.Root>
                <Menu.Trigger asChild>
                  <IconButton
                    size="xs"
                    variant="ghost"
                    aria-label="Config actions"
                    data-testid={`config-row-${c.id}-actions`}
                  >
                    <MoreVertical size={14} />
                  </IconButton>
                </Menu.Trigger>
                <Menu.Content>
                  <Menu.Item
                    value="edit"
                    onClick={(event) => {
                      event.stopPropagation();
                      onEdit(c);
                    }}
                    data-testid={`config-row-${c.id}-edit`}
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
                      onDelete(c);
                    }}
                    data-testid={`config-row-${c.id}-delete`}
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
  onEdit,
  enabledProviderKeys,
}: {
  role: ModelRoleKey;
  config: Record<string, string>;
  features: Payload["features"];
  configs: ConfigRow[];
  anchorScope: { type: "ORGANIZATION" | "TEAM" | "PROJECT"; id: string } | null;
  /** Open the row's edit drawer. Wired to the hover-revealed pencil
   *  next to each chip so the user can jump straight from "I want to
   *  change this model" to the drawer without hunting for the 3-dot
   *  menu. Edits the whole policy, not just the cell. */
  onEdit: () => void;
  enabledProviderKeys: Set<string> | null;
}) {
  const isInvalid = (model: string) =>
    !!enabledProviderKeys &&
    !enabledProviderKeys.has(model.split("/")[0] ?? "");
  // The table is a "final resolved state" view: every cell renders
  // the cascade-resolved role model for the row's scope, whether the
  // policy on this row pins it or inherits it from a wider tier.
  // Pinned-vs-inherited is only differentiated inside the edit drawer,
  // so the user never has to parse italics here to know "is gpt-x mine
  // or someone else's?". If nothing in the cascade carries the role,
  // the cell renders a "Not configured" badge prompting the user to
  // update; AI features for this role are disabled at this scope until
  // they do.
  const resolvedRole = anchorScope
    ? resolveAtScope(role, configs, anchorScope.type, anchorScope.id)
    : null;
  const resolvedRoleModel = resolvedRole?.model ?? config[role] ?? null;

  // Feature override rows render only when THIS policy pins a feature
  // key AND its value differs from the role-resolved model. If the role
  // is itself unresolved, any feature override IS the new effective
  // value so we surface it regardless.
  const featureOverrides = features
    .filter((f) => f.role === role && config[f.key])
    .filter((f) => config[f.key] !== resolvedRoleModel);

  return (
    <VStack align="start" gap={1}>
      <ChipWithEdit onEdit={onEdit}>
        {resolvedRoleModel ? (
          <ModelChip
            model={resolvedRoleModel}
            size="sm"
            invalid={isInvalid(resolvedRoleModel)}
          />
        ) : (
          <Badge colorPalette="orange" variant="subtle">
            Not configured
          </Badge>
        )}
      </ChipWithEdit>
      {featureOverrides.map((f) => (
        <ChipWithEdit key={f.key} onEdit={onEdit} paddingLeft={4}>
          <Text fontSize="xs" color="fg.muted">
            {f.displayName}
          </Text>
          <ModelChip
            model={config[f.key]!}
            size="sm"
            invalid={isInvalid(config[f.key]!)}
          />
        </ChipWithEdit>
      ))}
    </VStack>
  );
}

/**
 * Hover-revealed pencil next to a model chip. Click jumps straight to
 * the row's edit drawer — small UX trickery so the user doesn't have
 * to hunt for the 3-dot menu when they're already eyeing the model
 * they want to change. The drawer edits the whole policy, not just
 * the cell, which matches the data model (one config = one JSON blob
 * across roles).
 */
function ChipWithEdit({
  children,
  onEdit,
  paddingLeft,
}: {
  children: React.ReactNode;
  onEdit: () => void;
  paddingLeft?: number;
}) {
  // Reveal a pencil button on cell hover. Chakra v3's `_groupHover`
  // relies on a recipe wiring we don't have here, so the rule is
  // expressed via raw CSS that's also more obvious about the intent:
  // hover anywhere on this HStack → make `.chip-edit` visible.
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

/**
 * Most-specific scope a policy attaches to in our cascade order
 * (PROJECT > TEAM > ORGANIZATION). The cell uses this as the anchor
 * for the cascade walk so a row showing "Team Platform + Project edge"
 * resolves at the project (more specific) — the model the user would
 * actually see in code running on that project.
 */
function mostSpecificScope(
  scopes: ConfigRow["scopes"],
): { type: "ORGANIZATION" | "TEAM" | "PROJECT"; id: string } | null {
  const project = scopes.find((s) => s.type === "PROJECT");
  if (project) return { type: "PROJECT", id: project.id };
  const team = scopes.find((s) => s.type === "TEAM");
  if (team) return { type: "TEAM", id: team.id };
  const org = scopes.find((s) => s.type === "ORGANIZATION");
  if (org) return { type: "ORGANIZATION", id: org.id };
  return null;
}

/**
 * Cascading walk for a single key at a given scope. Walks
 * PROJECT → TEAM → ORG from the anchor scope, within each tier sorting
 * configs by createdAt DESC and taking the first that has the key.
 * Returns null if no config in the visible set carries the key.
 */
function resolveAtScope(
  key: string,
  configs: ConfigRow[],
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT",
  scopeId: string,
): NonNullable<Payload["effective"][ModelRoleKey]> | null {
  const tier =
    scopeType === "PROJECT"
      ? ["PROJECT", "TEAM", "ORGANIZATION"]
      : scopeType === "TEAM"
        ? ["TEAM", "ORGANIZATION"]
        : ["ORGANIZATION"];
  for (const t of tier) {
    const matching = configs
      .filter((c) =>
        c.scopes.some((s) =>
          t === scopeType
            ? s.type === t && s.id === scopeId
            : s.type === t,
        ),
      )
      .filter((c) => (c.config as Record<string, string>)[key])
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    if (matching[0]) {
      return {
        model: (matching[0].config as Record<string, string>)[key]!,
        source: t === scopeType ? "role_default" : "role_default",
        scope: t.toLowerCase(),
      } as NonNullable<Payload["effective"][ModelRoleKey]>;
    }
  }
  return null;
}

function ScopeChip({
  type,
  name,
}: {
  type: "ORGANIZATION" | "TEAM" | "PROJECT";
  name: string;
}) {
  const palette =
    type === "ORGANIZATION" ? "blue" : type === "TEAM" ? "purple" : "gray";
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
    <Card.Root
      width="full"
      overflow="hidden"
      data-testid="default-models-table-skeleton"
    >
      <Card.Body paddingY={0} paddingX={0}>
        <Table.Root variant="line" size="md" width="full">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Scopes</Table.ColumnHeader>
              <Table.ColumnHeader>Default</Table.ColumnHeader>
              <Table.ColumnHeader>Fast</Table.ColumnHeader>
              <Table.ColumnHeader>Embeddings</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="right" />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {[0, 1, 2].map((i) => (
              <Table.Row key={i}>
                <Table.Cell>
                  <Skeleton width="100px" height="20px" borderRadius="full" />
                </Table.Cell>
                <Table.Cell>
                  <Skeleton width="160px" height="16px" />
                </Table.Cell>
                <Table.Cell>
                  <Skeleton width="160px" height="16px" />
                </Table.Cell>
                <Table.Cell>
                  <Skeleton width="160px" height="16px" />
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
