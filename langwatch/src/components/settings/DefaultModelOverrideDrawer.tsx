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

import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { LATEST_ALIAS_PROVIDERS } from "~/server/modelProviders/latestAliases";
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
  /** Config id when editing an existing policy; absent = create. The
   *  drawer fetches the full ConfigRow + available / features / effective
   *  payloads from the same getDefaultModelsForProject query
   *  DefaultModelsSection already consumes (tRPC dedupes the second
   *  caller). Kept as a single serializable prop so the drawer fits
   *  the URL-driven `currentDrawer` pattern used everywhere else. */
  editingId?: string;
}

export function DefaultModelOverrideDrawer({ editingId }: Props) {
  const utils = api.useContext();
  const saveMutation = api.modelProvider.saveDefaultModelsConfig.useMutation();
  const { project } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();

  // Pulls the same Payload DefaultModelsSection consumes — tRPC
  // de-duplicates the query so the parent page render doesn't pay an
  // extra round-trip. The drawer used to receive these as props from
  // the page, but URL-routed drawers can't accept non-serializable
  // payloads.
  const dataQuery = api.modelProvider.getDefaultModelsForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );
  const editing = editingId
    ? dataQuery.data?.configs.find((c) => c.id === editingId)
    : undefined;
  const available = dataQuery.data?.available ?? {
    organization: null,
    teams: [],
    projects: [],
  };
  const features: FeatureProjection[] = dataQuery.data?.features ?? [];
  const effective: Payload["effective"] =
    dataQuery.data?.effective ??
    ({
      DEFAULT: null,
      FAST: null,
      EMBEDDINGS: null,
    } as Payload["effective"]);

  // Treat the drawer as always-open while mounted — the registry only
  // renders it when `drawer.open === "defaultModelOverride"`. closeDrawer
  // pops the URL param and unmounts.
  const open = true;
  const onClose = closeDrawer;
  const onSaved = () => {
    // No-op: the save mutation invalidates both queries on success.
    // Kept as a name to preserve the previous prop-driven contract for
    // future callers that might want to react to a successful save.
  };

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

  // Narrow the model picker to only providers the user explicitly
  // configured (one of their scopes has a stored ModelProvider row).
  // The legacy `getAllForProject` Record merges env-fed defaults
  // (every registry provider whose API key happens to be present in
  // the server's process env), which surfaces unrelated providers in
  // the picker — a user with only Anthropic configured would see
  // Voyage / Gemini / Perplexity embeddings just because those env
  // vars are set on the host. `listAllForProjectForFrontend` returns
  // stored rows only.
  const projectProviders =
    api.modelProvider.listAllForProjectForFrontend.useQuery(
      { projectId: project?.id ?? "" },
      { enabled: !!project?.id && open, refetchOnMount: false },
    );

  const modelOptionsByRole = useMemo(() => {
    const isLoading = projectProviders.isLoading;
    const hasProviderLoadError = projectProviders.isError;
    const providers = projectProviders.data?.providers ?? [];
    const enabledEntries: Array<
      [string, (typeof providers)[number]]
    > = providers
      .filter((p) => p.enabled === true)
      .map((p) => [p.provider, p]);
    const enabledKeys = new Set(enabledEntries.map(([k]) => k));
    // Build the alias entries for enabled providers that support them.
    // Aliases sit at the TOP of the chat list (DEFAULT + FAST) so the
    // user lands on "Latest" / "Latest smaller" without scrolling — the
    // expectation is that pinning a specific model is the exceptional
    // case, not the default. EMBEDDINGS doesn't get aliases (the latest
    // embedding model isn't a moving target the way chat flagships are).
    const aliasChatOptions: string[] = [];
    for (const provider of LATEST_ALIAS_PROVIDERS) {
      if (!enabledKeys.has(provider)) continue;
      aliasChatOptions.push(`${provider}/latest`);
      aliasChatOptions.push(`${provider}/latest-mini`);
    }
    const filterByMode = (mode: "chat" | "embedding") => {
      // Still loading: show the full registry so the dropdown isn't
      // visually broken during first paint. Once data lands we either
      // fall through to the enabled-filter path or — if the project
      // has zero enabled providers (or the query errored) — return an
      // empty list so the picker doesn't lie about what's available.
      if (isLoading) {
        return modelSelectorOptions
          .filter((o) => o.mode === mode)
          .map((o) => o.value);
      }
      if (hasProviderLoadError || enabledEntries.length === 0) return [];
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
    const chatOptions = filterByMode("chat");
    return {
      // Aliases at the top of chat lists; concrete models below.
      DEFAULT: [...aliasChatOptions, ...chatOptions],
      FAST: [...aliasChatOptions, ...chatOptions],
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
      // Invalidate the local table query plus the resolved-default
      // query so the prompts page, evaluation wizard, and other
      // consumers of the cascaded default model pick up the change.
      await Promise.all([
        utils.modelProvider.getDefaultModelsForProject.invalidate(),
        utils.modelProvider.getResolvedDefault.invalidate(),
      ]);
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
        error: err,
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
            {editing ? "Edit default models" : "Add default models"}
          </Drawer.Title>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={5}>
            <ScopeSection
              scopes={scopes}
              onChange={setScopes}
              available={available}
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
 * organization)" or similar — and the model is rendered at reduced
 * opacity in the trigger + as the first dropdown entry.
 *
 * For the `inferred` source (server falls back to "we'd pick the
 * latest from your first provider") the label is a neutral "Inherit"
 * rather than "Suggested from X" — the picker already surfaces the
 * provider's `/latest` and `/latest-mini` aliases at the top of the
 * list, so the per-provider attribution would just add noise. The
 * inherit entry itself stays so the user can always toggle back from
 * an explicit override.
 */
function buildInheritOption(
  fromServer: InheritedEntry,
  fromEffective: Payload["effective"][ModelRoleKey] | null,
): { model: string; label: string } | undefined {
  if (fromServer) {
    // Skip the "inferred" source: an inferred value is the server
    // guessing what the user MIGHT want based on which providers are
    // enabled, not a real cascade hit. Showing it as a ghost
    // placeholder under a "Not configured" badge gave the
    // contradictory read that something was set when nothing was —
    // the row stays empty until the user explicitly picks a model.
    if (fromServer.source === "inferred") {
      return undefined;
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
    // Same rationale as the `inferred` skip above: env-var fallback
    // isn't a configured scope, just a host-level default. The drawer
    // is for setting explicit policy, so empty stays empty.
    if (fromEffective.source === "system") {
      return undefined;
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
}: {
  scopes: ScopeChipPickerEntry[];
  onChange: (next: ScopeChipPickerEntry[]) => void;
  available: Payload["available"];
}) {
  // Drawer renders only the dropdown — the Organization/Team/Project
  // quick-pick chips are redundant when scope assignment is effectively
  // always at org scope, and the dropdown already surfaces all reachable
  // scopes. The quick-pick variant is preserved on `ScopeChipPicker`
  // (`showQuickPicks` prop) for future surfaces where the chip-row UX
  // makes sense.
  // Default label is "Scope" — render it so the picker reads consistent
  // with the model-provider drawer's scope section.
  return (
    <ScopeChipPicker
      value={scopes}
      onChange={onChange}
      organizationId={available.organization?.id}
      organizationName={available.organization?.name}
      availableTeams={available.teams}
      availableProjects={available.projects}
    />
  );
}
