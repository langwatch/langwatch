/**
 * Drawer for authoring or editing a single ModelDefaultConfig policy.
 *
 * Layout:
 *   Scope chip picker         (full row)
 *   Default ........ [model selector] ▼
 *     prompt.create_default ........ [model selector]
 *     evaluator.create_default ..... [model selector]
 *   Fast ............ [model selector] ▼
 *     traces.ai_search ............. [model selector]
 *     studio.autocomplete .......... [model selector]
 *     ... (every feature registered in the role)
 *   Embeddings ..... [model selector]    (no expand)
 *
 * Inherit semantics on the wire = absence. The drawer's UI uses an
 * explicit "Inherit" choice in the model selector that, on save, omits
 * the key from the JSON. On reopen, role/feature rows that aren't in
 * the saved JSON read as "Inherit" again. The selector renders the
 * resolved-inherited model as a placeholder at reduced opacity so the
 * user sees what would apply if they don't override.
 *
 * Feature rows under an expanded role default to "Inherit" — picking
 * a model there pins that feature to the chosen value, leaving the
 * role-level pick alone.
 */

import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Tooltip } from "~/components/ui/tooltip";
import { useCallback, useEffect, useMemo, useState } from "react";

import { modelSelectorOptions } from "~/components/ModelSelector";
import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { api, type RouterOutputs } from "~/utils/api";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { INHERIT_SENTINEL, ProviderModelSelector } from "./ProviderModelSelector";
import {
  ScopeChipPicker,
  type ScopeChipPickerEntry,
} from "./ScopeChipPicker";

type Payload = RouterOutputs["modelProvider"]["getDefaultModelsForProject"];
type ConfigRow = Payload["configs"][number];
type FeatureProjection = Payload["features"][number];
type ScopeType = "ORGANIZATION" | "TEAM" | "PROJECT";
type ModelRoleKey = "DEFAULT" | "FAST" | "EMBEDDINGS";

const ROLES: ModelRoleKey[] = ["DEFAULT", "FAST", "EMBEDDINGS"];

const ROLE_LABEL: Record<ModelRoleKey, string> = {
  DEFAULT: "Default",
  FAST: "Fast",
  EMBEDDINGS: "Embeddings",
};

const ROLE_BLURB: Record<ModelRoleKey, string> = {
  DEFAULT:
    "Picked when a prompt or evaluator is created, and any high-stakes call without a specific override.",
  FAST: "Background and assistive surfaces like search, autocomplete, commit messages, topic clustering.",
  EMBEDDINGS: "Semantic vectors used by topic clustering and similar features.",
};

interface Props {
  open: boolean;
  onClose: () => void;
  /** Undefined = create; defined = edit an existing config. */
  editing?: ConfigRow;
  available: Payload["available"];
  features: FeatureProjection[];
  /** Effective resolution for the project currently viewed — used as
   *  the "if you don't override" placeholder for each row. */
  effective: Payload["effective"];
  /** Quick-pick context: the scope ids the caller is currently sitting on
   *  so the drawer can offer "Organization / This team / This project" chips
   *  same as the model-provider drawer. */
  currentOrganizationId?: string | null;
  currentTeamId?: string | null;
  currentProjectId?: string | null;
  onSaved: () => void;
}

export function DefaultModelOverrideDrawer({
  open,
  onClose,
  editing,
  available,
  features,
  effective,
  currentOrganizationId,
  currentTeamId,
  currentProjectId,
  onSaved,
}: Props) {
  const utils = api.useContext();
  const saveMutation = api.modelProvider.saveDefaultModelsConfig.useMutation();
  const { project } = useOrganizationTeamProject();

  // Ask the server what the cascade would resolve for each role +
  // feature key if the picked scopes had nothing set. The drawer uses
  // the answer to render the inherit-placeholder + the "Inherit (from
  // X) [model]" dropdown entry. Refetches whenever the chip selection
  // changes — picking new scopes shifts the cascade answer.

  // ── Local state ───────────────────────────────────────────────────
  // `config` mirrors the JSON we'll send on save. Keys present here =
  // overrides. Keys absent = inherit. Local-only "EXPANDED" tracking
  // for which roles have their feature lists open in the form.

  const [scopes, setScopes] = useState<ScopeChipPickerEntry[]>([]);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<ModelRoleKey, boolean>>({
    DEFAULT: false,
    FAST: false,
    EMBEDDINGS: false,
  });
  const [busy, setBusy] = useState(false);

  // Hydrate state when the drawer is reopened with a different target.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setScopes(
        editing.scopes.map((s) => ({
          scopeType: s.type as ScopeType,
          scopeId: s.id,
        })),
      );
      setConfig({ ...(editing.config as Record<string, string>) });
    } else {
      setScopes([]);
      setConfig({});
    }
    setExpanded({ DEFAULT: false, FAST: false, EMBEDDINGS: false });
  }, [open, editing]);

  const inheritedQuery =
    api.modelProvider.getInheritedValuesForScopes.useQuery(
      {
        projectId: project?.id ?? "",
        scopes: scopes.map((s) => ({
          scopeType: s.scopeType,
          scopeId: s.scopeId,
        })),
        excludeConfigId: editing?.id,
      },
      {
        // Need at least one picked scope to anchor the cascade walk
        // and the editing target should be settled.
        enabled: !!project?.id && scopes.length > 0 && open,
      },
    );
  const inherited = inheritedQuery.data?.inherited ?? {};

  const featuresByRole = useMemo(() => {
    const m: Record<ModelRoleKey, FeatureProjection[]> = {
      DEFAULT: [],
      FAST: [],
      EMBEDDINGS: [],
    };
    for (const f of features) m[f.role as ModelRoleKey]?.push(f);
    return m;
  }, [features]);

  // Narrow the model picker to only providers enabled in the cascade
  // visible to this project. Chat-mode models for DEFAULT/FAST roles;
  // embedding-mode for EMBEDDINGS. Custom models registered on the
  // provider (e.g. extra OpenAI deployment names) are folded in so
  // self-serve admins see what they've added.
  const projectProviders = api.modelProvider.getAllForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && open, refetchOnMount: false },
  );

  const modelOptionsByRole = useMemo(() => {
    const providers = projectProviders.data ?? {};
    const enabledEntries = Object.entries(providers).filter(
      ([, p]) => p?.enabled === true,
    );
    const enabledKeys = new Set(enabledEntries.map(([k]) => k));
    // First-paint fallback: no providers loaded yet → list everything so
    // the dropdown isn't visually broken while the query is in flight.
    const filterByMode = (mode: "chat" | "embedding") => {
      if (enabledEntries.length === 0) {
        return modelSelectorOptions
          .filter((o) => o.mode === mode)
          .map((o) => o.value);
      }
      // Registry chat/embedding models from any enabled provider. This
      // mirrors the ModelProviderDefaultSection logic — the registry is
      // the broad pool; provider toggles narrow it.
      const registryModels = modelSelectorOptions
        .filter((o) => {
          if (o.mode !== mode) return false;
          const providerKey = o.value.split("/")[0] ?? "";
          return enabledKeys.has(providerKey);
        })
        .map((o) => o.value);
      // User-defined custom entries on each enabled provider. Custom
      // models live in `customModels` / `customEmbeddingsModels`; bare
      // string lists in `models` / `embeddingsModels` are registry
      // enablement subsets and already covered above.
      const customModels: string[] = [];
      for (const [providerKey, providerData] of enabledEntries) {
        if (!providerData) continue;
        const customList =
          mode === "embedding"
            ? providerData.customEmbeddingsModels ?? []
            : providerData.customModels ?? [];
        for (const m of customList) {
          if (m?.modelId) customModels.push(`${providerKey}/${m.modelId}`);
        }
      }
      // Custom entries first so user-added models are easy to spot.
      return Array.from(new Set([...customModels, ...registryModels]));
    };
    return {
      DEFAULT: filterByMode("chat"),
      FAST: filterByMode("chat"),
      EMBEDDINGS: filterByMode("embedding"),
    } satisfies Record<ModelRoleKey, string[]>;
  }, [projectProviders.data]);

  const setOverride = useCallback((key: string, model: string | null) => {
    setConfig((prev) => {
      const next = { ...prev };
      // Inherit sentinel + null + empty string all map to "clear the
      // key from in-progress JSON" — the cascade walks up at save time
      // since absent keys mean inherit (no sentinel in storage).
      if (model === null || model === "" || model === INHERIT_SENTINEL) {
        delete next[key];
      } else {
        next[key] = model;
      }
      return next;
    });
  }, []);

  const canSave = scopes.length > 0 && !busy;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      await saveMutation.mutateAsync({
        id: editing?.id,
        config,
        scopes: scopes.map((s) => ({
          scopeType: s.scopeType,
          scopeId: s.scopeId,
        })),
      });
      await utils.modelProvider.getDefaultModelsForProject.invalidate();
      toaster.create({
        title: editing ? "Config updated" : "Config added",
        type: "success",
        duration: 2500,
        meta: { closable: true },
      });
      onSaved();
      onClose();
    } catch (err) {
      toaster.create({
        title: "Failed to save",
        description: err instanceof Error ? err.message : String(err),
        type: "error",
        duration: 6000,
        meta: { closable: true },
      });
    } finally {
      setBusy(false);
    }
  }, [canSave, saveMutation, editing, config, scopes, utils, onSaved, onClose]);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(d) => {
        if (!d.open) onClose();
      }}
      size="md"
    >
      <Drawer.Content
        data-testid="default-model-override-drawer"
        portalled={false}
      >
        <Drawer.Header>
          <Drawer.Title>
            {editing ? "Edit config" : "Add config"}
          </Drawer.Title>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={5}>
            <ScopeSection
              scopes={scopes}
              onChange={setScopes}
              available={available}
              currentOrganizationId={currentOrganizationId}
              currentTeamId={currentTeamId}
              currentProjectId={currentProjectId}
            />

            <VStack align="stretch" gap={2}>
              {ROLES.map((role) => (
                <RoleRow
                  key={role}
                  role={role}
                  config={config}
                  features={featuresByRole[role]}
                  effective={effective[role]}
                  inheritedForRole={inherited[role] ?? null}
                  inheritedForFeature={inherited}
                  expanded={expanded[role]}
                  onToggleExpand={() =>
                    setExpanded((prev) => ({ ...prev, [role]: !prev[role] }))
                  }
                  modelOptions={modelOptionsByRole[role]}
                  onSetOverride={setOverride}
                />
              ))}
            </VStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          {/* Delete moved to the row's 3-dot menu in the table — matches
              the model-providers row pattern. The drawer is purely
              edit/save. */}
          <HStack width="full" justify="flex-end" gap={2}>
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorPalette="orange"
              size="sm"
              onClick={handleSave}
              disabled={!canSave}
              loading={busy}
              data-testid="config-save"
            >
              {editing ? "Save changes" : "Add config"}
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

type InheritedEntry =
  RouterOutputs["modelProvider"]["getInheritedValuesForScopes"]["inherited"][string];

function RoleRow({
  role,
  config,
  features,
  effective,
  inheritedForRole,
  inheritedForFeature,
  expanded,
  onToggleExpand,
  modelOptions,
  onSetOverride,
}: {
  role: ModelRoleKey;
  config: Record<string, string>;
  features: FeatureProjection[];
  effective: Payload["effective"][ModelRoleKey];
  /** Server's cascade answer for this role at the picked scopes. Null
   *  when no picked scope OR no cascade hit AND no inferable provider. */
  inheritedForRole: InheritedEntry;
  /** Server's per-key cascade answers; used by feature rows below. */
  inheritedForFeature: Record<string, InheritedEntry>;
  expanded: boolean;
  onToggleExpand: () => void;
  modelOptions: string[];
  onSetOverride: (key: string, model: string | null) => void;
}) {
  const current = config[role] ?? "";
  // Prefer the picked-scope cascade answer; fall back to the
  // project's effective resolution when the picker is empty (so the
  // user still sees a sensible placeholder while the chip set is
  // being built).
  const inheritedModel = inheritedForRole?.model ?? effective?.model;
  const inheritOption = buildInheritOption(inheritedForRole, effective);
  const canExpand = features.length > 0;
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;

  // EMBEDDINGS-specific: when no provider enabled at the picked scope
  // ships an embedding API, the selector has nothing to offer. Dim
  // the row and tell the user what would unlock it instead of
  // pretending the field is functional.
  const unsupportedAtScope = role === "EMBEDDINGS" && modelOptions.length === 0;

  return (
    <Box
      data-testid={`role-row-${role.toLowerCase()}`}
      width="full"
      data-unsupported-at-scope={unsupportedAtScope || undefined}
    >
      <HStack
        gap={2}
        align="center"
        paddingY={1}
        opacity={unsupportedAtScope ? 0.55 : 1}
      >
        {/* Row reads: [label] ··············· [model selector] ▶
            Label hugs the left, big flex spacer eats the middle, the
            model selector + expand chevron live tight to the right. */}
        <Tooltip content={ROLE_BLURB[role]}>
          <Box
            flexShrink={0}
            cursor="help"
            data-testid={`role-row-${role.toLowerCase()}-label`}
          >
            <Text fontWeight="medium" fontSize="sm">
              {ROLE_LABEL[role]}
            </Text>
          </Box>
        </Tooltip>
        <Box flex={1} />
        <Box width="240px" flexShrink={0}>
          <ProviderModelSelector
            model={current}
            options={modelOptions}
            onChange={(m) => onSetOverride(role, m)}
            inheritOption={inheritOption}
            disabled={unsupportedAtScope}
          />
        </Box>
        {canExpand ? (
          <Box
            as="button"
            onClick={onToggleExpand}
            cursor="pointer"
            color="fg.muted"
            flexShrink={0}
            padding={1}
            data-testid={`role-row-${role.toLowerCase()}-expand`}
          >
            <ChevronIcon size={16} />
          </Box>
        ) : (
          <Box width="24px" flexShrink={0} />
        )}
      </HStack>
      {unsupportedAtScope && (
        <Text
          fontSize="xs"
          color="fg.muted"
          paddingLeft={1}
          paddingBottom={1}
          data-testid="role-row-embeddings-unsupported-hint"
        >
          No provider configured at this scope ships an embedding API.
          Add an embedding-capable provider (OpenAI, Voyage, Cohere) to
          unlock topic clustering and semantic search.
        </Text>
      )}
      {canExpand && expanded && (
        <VStack
          align="stretch"
          gap={1}
          paddingLeft={4}
          paddingBottom={1}
          data-testid={`role-row-${role.toLowerCase()}-features`}
        >
          {features.map((f) => (
            <FeatureRow
              key={f.key}
              feature={f}
              override={config[f.key] ?? ""}
              roleLevelOverride={config[role] ?? ""}
              inheritedForFeature={inheritedForFeature[f.key] ?? null}
              inheritedForRole={inheritedForRole}
              inheritedRoleModel={inheritedModel}
              modelOptions={modelOptions}
              onSetOverride={onSetOverride}
            />
          ))}
        </VStack>
      )}
    </Box>
  );
}

function FeatureRow({
  feature,
  override,
  roleLevelOverride,
  inheritedForFeature,
  inheritedForRole,
  inheritedRoleModel,
  modelOptions,
  onSetOverride,
}: {
  feature: FeatureProjection;
  override: string;
  roleLevelOverride: string;
  /** Server cascade answer for this exact feature key. */
  inheritedForFeature: InheritedEntry;
  /** Server cascade answer for the feature's role (fallback chain). */
  inheritedForRole: InheritedEntry;
  /** Resolved model the role-level row would pick — wins over the
   *  server-side feature inheritance because the in-progress config's
   *  role-level pick is local and not yet persisted. */
  inheritedRoleModel?: string;
  modelOptions: string[];
  onSetOverride: (key: string, model: string | null) => void;
}) {
  // The feature's "would inherit" placeholder follows the same cascade
  // the resolver does: a role-level pick in THIS config (in-progress)
  // wins over the server's per-feature cascade, which in turn beats the
  // role cascade. Without that local check the placeholder would lag
  // behind what the user just typed in the role row above.
  //
  // Surface "Inherit (from role-level in this config)" when the user
  // already picked a role-level value here, otherwise walk the same
  // cascade fallback chain the role row uses: server's per-feature
  // answer → server's role-level answer → in-progress role pick from
  // this config → finally the resolved-role model from the page's
  // effective payload, so the placeholder is never blank when there's
  // anything cascading down.
  let inheritOption: { model: string; label: string } | undefined;
  if (roleLevelOverride) {
    inheritOption = {
      model: roleLevelOverride,
      label: "Inherit (role default in this config)",
    };
  } else {
    inheritOption =
      buildInheritOption(inheritedForFeature, null) ??
      buildInheritOption(inheritedForRole, null) ??
      (inheritedRoleModel
        ? { model: inheritedRoleModel, label: "Inherit (role default)" }
        : undefined);
  }
  return (
    <HStack
      gap={2}
      align="center"
      data-testid={`feature-row-${feature.key}`}
    >
      {/* Feature description tooltip lives on the label. Layout
          mirrors the parent role row: label left, big spacer, selector
          right-aligned, expand-slot reserved for alignment with the
          role row above. */}
      <Tooltip content={feature.description}>
        <Box flexShrink={0} cursor="help">
          <Text fontSize="sm">{feature.displayName}</Text>
        </Box>
      </Tooltip>
      <Box flex={1} />
      <Box width="240px" flexShrink={0}>
        <ProviderModelSelector
          model={override}
          options={modelOptions}
          onChange={(m) => onSetOverride(feature.key, m)}
          inheritOption={inheritOption ?? undefined}
        />
      </Box>
      <Box width="24px" flexShrink={0} />
    </HStack>
  );
}

/**
 * Builds the `inheritOption` payload `ProviderModelSelector` consumes.
 * The label tells the user where the value comes from — "Inherit (from
 * organization)" or "Suggested from openai" for the inferred-fallback
 * case — and the model is rendered at reduced opacity in the trigger +
 * as the first dropdown entry.
 */
function buildInheritOption(
  fromServer: InheritedEntry,
  fromEffective: Payload["effective"][ModelRoleKey] | null,
): { model: string; label: string } | undefined {
  if (fromServer) {
    if (fromServer.source === "inferred") {
      const providerName = fromServer.inferredFromProvider ?? "first provider";
      return {
        model: fromServer.model,
        label: `Suggested from ${providerName}`,
      };
    }
    // `feature_override` / `role_default` carry a concrete scope name
    // (organization / team / project). The "system" / env-var fallback
    // is surfaced via `fromEffective` below.
    return {
      model: fromServer.model,
      label: fromServer.scope
        ? `Inherit (from ${fromServer.scope})`
        : "Inherit",
    };
  }
  if (fromEffective) {
    if (fromEffective.source === "system") {
      return {
        model: fromEffective.model,
        label: "Inherit (from System)",
      };
    }
    return {
      model: fromEffective.model,
      label: fromEffective.scope
        ? `Inherit (from ${fromEffective.scope})`
        : "Inherit",
    };
  }
  return undefined;
}

/**
 * Scope picker section. Quick-pick chips ("Organization" / "This team"
 * / "This project") follow the same pattern as `ProviderScopeSection`
 * from the model-provider drawer — picking one replaces the selection
 * with that single scope, and the multi-scope chip picker stays
 * available below for fan-out cases. Lives inline here (rather than
 * pulling `ProviderScopeSection` in) because that component is tightly
 * coupled to `useModelProviderForm`'s reducer; pulling it apart is a
 * follow-up if more surfaces need this primitive.
 */
function ScopeSection({
  scopes,
  onChange,
  available,
  currentOrganizationId,
  currentTeamId,
  currentProjectId,
}: {
  scopes: ScopeChipPickerEntry[];
  onChange: (next: ScopeChipPickerEntry[]) => void;
  available: Payload["available"];
  currentOrganizationId?: string | null;
  currentTeamId?: string | null;
  currentProjectId?: string | null;
}) {
  // Quick-picks + Multiple chip + collapsible dropdown all live inside
  // ScopeChipPicker now — single source of truth. The wrapper used to
  // render its own quick-pick row above the picker; that duplicated
  // the same state derivation in two places (and one always lagged the
  // other by a re-render). See ScopeChipPicker docs for the contract.
  return (
    <ScopeChipPicker
      value={scopes}
      onChange={onChange}
      organizationId={available.organization?.id}
      organizationName={available.organization?.name}
      availableTeams={available.teams}
      availableProjects={available.projects}
      label=""
      showQuickPicks
      currentOrganizationId={
        available.organization ? currentOrganizationId ?? null : null
      }
      currentTeamId={currentTeamId ?? null}
      currentProjectId={currentProjectId ?? null}
    />
  );
}
