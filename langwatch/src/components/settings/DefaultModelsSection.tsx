/**
 * Default Models settings page section — table view of every
 * ModelDefaultConfig the caller can see, plus a scope filter so an
 * admin can narrow to a single team / project and see the resolved
 * cascade.
 *
 * Two render modes driven by `DefaultModelsScopeFilter`:
 *   - "All you can see" (default): one row per config policy. Each
 *     row shows the scopes the config is attached to + the model
 *     cells for whichever role / feature keys the policy actually
 *     overrides. Inherited cells stay empty so the page reads as a
 *     diff against the cascade.
 *   - Specific scope (this team / this project / "More Scopes ▸"
 *     submenu pick): one resolved row showing the final model the
 *     cascade hands out for each role, with feature overrides shown
 *     indented underneath. Mirrors what a feature actually reads at
 *     runtime — handy for "why is THIS project resolving Claude?".
 *
 * "+ Add config" opens `DefaultModelOverrideDrawer`. Each rule row
 * carries an Edit button that opens the same drawer pre-filled.
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
  Menu,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
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

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import {
  DEFAULT_EMBEDDINGS_MODEL,
  DEFAULT_MODEL,
  DEFAULT_TOPIC_CLUSTERING_MODEL,
} from "~/utils/constants";

import { DefaultModelOverrideDrawer } from "./DefaultModelOverrideDrawer";
import {
  DefaultModelsScopeFilter,
  type ScopeFilter,
} from "./DefaultModelsScopeFilter";
import { ModelChip } from "./ModelChip";
import { toaster } from "~/components/ui/toaster";

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
}

export function DefaultModelsSection({
  filter: controlledFilter,
  onFilterChange,
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ConfigRow | undefined>(undefined);

  const utils = api.useContext();
  const deleteMutation =
    api.modelProvider.deleteDefaultModelsConfig.useMutation();
  const handleDelete = async (c: ConfigRow) => {
    try {
      await deleteMutation.mutateAsync({ id: c.id });
      await utils.modelProvider.getDefaultModelsForProject.invalidate();
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

  const featuresByRole = useMemo(() => {
    const m: Record<ModelRoleKey, Payload["features"]> = {
      DEFAULT: [],
      FAST: [],
      EMBEDDINGS: [],
    };
    for (const f of dataQuery.data?.features ?? []) {
      m[f.role as ModelRoleKey]?.push(f);
    }
    return m;
  }, [dataQuery.data?.features]);

  if (dataQuery.isLoading || !dataQuery.data) {
    return (
      <Card.Root width="full" data-testid="default-models-section">
        <Card.Body>
          <HStack gap={3}>
            <Spinner size="sm" />
            <Text>Loading default models…</Text>
          </HStack>
        </Card.Body>
      </Card.Root>
    );
  }

  const data = dataQuery.data;

  const openAdd = () => {
    setEditing(undefined);
    setDrawerOpen(true);
  };
  const openEdit = (c: ConfigRow) => {
    setEditing(c);
    setDrawerOpen(true);
  };

  return (
    <VStack
      gap={3}
      width="full"
      align="stretch"
      data-testid="default-models-section"
    >
      <HStack gap={3} align="center" justify="space-between">
        <VStack align="start" gap={1}>
          <Heading as="h3" size="md">
            Default Models
          </Heading>
          <Text fontSize="sm" color="fg.muted">
            Define the default models to be used for AI features across the platform.
          </Text>
        </VStack>
        <HStack gap={2}>
          {/* When the section is uncontrolled (mounted outside the
              settings page), render its own filter dropdown for parity.
              In the controlled case the filter lives in the page header,
              so we skip rendering it here to avoid the duplicate. */}
          {controlledFilter === undefined && (
            <DefaultModelsScopeFilter
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
          {filter.kind === "all" ? (
            <AllConfigsView
              configs={data.configs}
              features={data.features}
              onEdit={openEdit}
              onDelete={handleDelete}
              onAdd={openAdd}
            />
          ) : (
            <ResolvedScopeView
              filter={filter}
              configs={data.configs}
              effective={data.effective}
              featuresByRole={featuresByRole}
              currentTeamId={team?.id}
              currentProjectId={project?.id}
            />
          )}
        </Card.Body>
      </Card.Root>

      <DefaultModelOverrideDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        editing={editing}
        available={data.available}
        features={data.features}
        effective={data.effective}
        currentOrganizationId={organization?.id}
        currentTeamId={team?.id}
        currentProjectId={project?.id}
        onSaved={() => {
          // Query is invalidated inside the drawer — nothing extra here.
        }}
      />
    </VStack>
  );
}

// ─── "All you can see" view ────────────────────────────────────────

function AllConfigsView({
  configs,
  features,
  onEdit,
  onDelete,
  onAdd,
}: {
  configs: ConfigRow[];
  features: Payload["features"];
  onEdit: (c: ConfigRow) => void;
  onDelete: (c: ConfigRow) => void;
  onAdd: () => void;
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
              Define a default model to enable AI features across the
              platform — prompt creation, evaluations, traces search,
              workflows, scenarios, and analytics all read from this
              cascade.
            </EmptyState.Description>
            <Button
              size="sm"
              colorPalette="orange"
              onClick={onAdd}
              data-testid="empty-state-add-config"
            >
              <HStack gap={1}>
                <Plus size={14} />
                <Text>Add your first config</Text>
              </HStack>
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
                  configs={configs}
                  anchorScope={mostSpecificScope(c.scopes)}
                  onEdit={() => onEdit(c)}
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
}) {
  // The table is a "final resolved state" view — every cell renders
  // the cascade-resolved role model for the row's scope, whether the
  // policy on this row pins it or inherits it from a wider tier (or
  // the System default). Pinned-vs-inherited is only differentiated
  // inside the edit drawer, so the user never has to parse italics
  // here to know "is gpt-x mine or someone else's?".
  const resolvedRole = anchorScope
    ? resolveAtScope(role, configs, anchorScope.type, anchorScope.id)
    : null;
  const resolvedRoleModel =
    resolvedRole?.model ?? config[role] ?? SYSTEM_FALLBACK_BY_ROLE[role];

  // Feature override rows render only when THIS policy pins a feature
  // key AND its value differs from the role-resolved model — otherwise
  // it would echo the chip directly above and add visual noise.
  const featureOverrides = features
    .filter((f) => f.role === role && config[f.key])
    .filter((f) => config[f.key] !== resolvedRoleModel);

  return (
    <VStack align="start" gap={1}>
      <ChipWithEdit onEdit={onEdit}>
        <ModelChip model={resolvedRoleModel} size="sm" />
      </ChipWithEdit>
      {featureOverrides.map((f) => (
        <ChipWithEdit key={f.key} onEdit={onEdit} paddingLeft={4}>
          <Text fontSize="xs" color="fg.muted">
            {f.displayName}
          </Text>
          <ModelChip model={config[f.key]!} size="sm" />
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
 * System defaults for each role — mirrors `ROLE_CONSTANT` in
 * `resolveModelForFeature.ts` so an "all you can see" cell on a
 * fresh-install org never reads as empty. Sourced from
 * `~/utils/constants` directly so the constants live in exactly one
 * place.
 */
const SYSTEM_FALLBACK_BY_ROLE: Record<ModelRoleKey, string> = {
  DEFAULT: DEFAULT_MODEL,
  FAST: DEFAULT_TOPIC_CLUSTERING_MODEL,
  EMBEDDINGS: DEFAULT_EMBEDDINGS_MODEL,
};

// ─── Resolved-at-scope view ────────────────────────────────────────

function ResolvedScopeView({
  filter,
  configs,
  effective,
  featuresByRole,
  currentTeamId,
  currentProjectId,
}: {
  filter: ScopeFilter;
  configs: ConfigRow[];
  effective: Payload["effective"];
  featuresByRole: Record<ModelRoleKey, Payload["features"]>;
  currentTeamId?: string | null;
  currentProjectId?: string | null;
}) {
  // For "this team" / "this project" / "specific scope" we render the
  // cascade-resolved view. For the project the user is currently in
  // the server already pre-computed `effective`. For other scopes we
  // do a client-side walk over the visible configs — the same CSS-
  // cascade rules the server runs.
  const targetScope = useMemo(() => {
    if (filter.kind === "team-current") {
      return currentTeamId
        ? { type: "TEAM" as const, id: currentTeamId }
        : null;
    }
    if (filter.kind === "project-current") {
      return currentProjectId
        ? { type: "PROJECT" as const, id: currentProjectId }
        : null;
    }
    if (filter.kind === "specific") {
      return { type: filter.scopeType, id: filter.scopeId };
    }
    return null;
  }, [filter, currentTeamId, currentProjectId]);

  if (!targetScope) {
    return (
      <Box padding={6}>
        <Text fontSize="sm" color="fg.muted">
          Pick a scope to see its resolved defaults.
        </Text>
      </Box>
    );
  }

  const isProjectCurrent =
    filter.kind === "project-current" && currentProjectId === targetScope.id;

  return (
    <VStack align="stretch" padding={4} gap={3}>
      {ROLES.map((role) => {
        // Use server-side `effective` when the target is the user's
        // own project; otherwise fall back to the client cascade walk.
        const resolved = isProjectCurrent
          ? effective[role]
          : resolveAtScope(role, configs, targetScope.type, targetScope.id);
        // Only surface a feature row when its resolved model actually
        // overrides the role default at this scope — if the cascade
        // picks the same model for the feature as for the role, the
        // feature is implicitly inheriting and there's nothing to show.
        // Skip noisy "Topic clustering | gpt-x" lines that just echo
        // the FAST default sitting above them.
        const featureOverrides = featuresByRole[role]
          .map((f) => {
            const fr = isProjectCurrent
              ? null
              : resolveAtScope(f.key, configs, targetScope.type, targetScope.id);
            if (!fr) return null;
            if (resolved && fr.model === resolved.model) return null;
            return { feature: f, resolved: fr };
          })
          .filter(Boolean) as Array<{
          feature: Payload["features"][number];
          resolved: NonNullable<Payload["effective"][ModelRoleKey]>;
        }>;
        return (
          <Box key={role} data-testid={`resolved-row-${role.toLowerCase()}`}>
            <HStack gap={3} align="center">
              <Box width="120px" flexShrink={0}>
                <Text fontWeight="medium">{ROLE_LABEL[role]}</Text>
              </Box>
              {resolved ? (
                <HStack gap={2}>
                  <ModelChip model={resolved.model} />
                  <Text fontSize="xs" color="fg.muted">
                    {resolved.source === "system"
                      ? "from System"
                      : `from ${resolved.scope}`}
                  </Text>
                </HStack>
              ) : (
                <Badge colorPalette="orange">not configured</Badge>
              )}
            </HStack>
            {featureOverrides.length > 0 && (
              <VStack
                align="stretch"
                gap={1}
                paddingLeft={6}
                paddingTop={2}
                paddingBottom={1}
              >
                {featureOverrides.map(({ feature, resolved }) => (
                  <HStack
                    key={feature.key}
                    gap={3}
                    align="center"
                    data-testid={`resolved-row-${role.toLowerCase()}-feature-${feature.key}`}
                  >
                    <Box width="160px" flexShrink={0}>
                      <Text fontSize="xs">{feature.displayName}</Text>
                    </Box>
                    <ModelChip model={resolved.model} size="sm" />
                    <Text fontSize="xs" color="fg.muted">
                      from {resolved.scope}
                    </Text>
                  </HStack>
                ))}
              </VStack>
            )}
          </Box>
        );
      })}
    </VStack>
  );
}

/**
 * Client-side CSS-cascade walk for a single key at a given scope. The
 * server is the source of truth (it serves `effective` for the current
 * project) — this fallback only fires when the user picks "this team"
 * or "more scopes ▸ <other team/project>" since the server only
 * computes effective for the project being viewed.
 *
 * Walks PROJECT → TEAM → ORG, within each tier sorting configs by
 * createdAt DESC and taking the first that has the key. Returns null
 * if no config in the visible set carries the key.
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
