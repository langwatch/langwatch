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
 * Feature rows under an expanded role default to "Inherit" - picking
 * a model there pins that feature to the chosen value, leaving the
 * role-level pick alone.
 */

import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { modelSelectorOptions } from "~/components/ModelSelector";
import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { showErrorToast } from "~/features/errors";
import { syncLangyAfterDefaultModelWrite } from "~/features/langy/logic/codingDefaultSync";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  isModelAllowedAsRoleDefault,
  isModelAllowedForFeature,
} from "@langwatch/model-provider-contract";
import { buildCustomModelDisplayNames } from "@langwatch/model-provider-contract";
import { LATEST_ALIAS_PROVIDERS } from "@langwatch/model-provider-contract";
import { api, type RouterOutputs } from "~/utils/api";
import { INHERIT_SENTINEL, ProviderModelSelector } from "./ProviderModelSelector";
import { ScopeChipPicker, type ScopeTriadEntry } from "./ScopeChipPicker";

type Payload = RouterOutputs["modelProvider"]["getDefaultModelsForProject"];
type FeatureProjection = Payload["features"][number];
type ScopeType = "ORGANIZATION" | "TEAM" | "PROJECT";
type ModelRoleKey = "DEFAULT" | "FAST" | "LANGY" | "EMBEDDINGS";

const ROLES: ModelRoleKey[] = ["DEFAULT", "FAST", "LANGY", "EMBEDDINGS"];

/** Stands in for "no row" in the hydration latch, which tracks which
 *  target the drawer's state belongs to and cannot use a config id
 *  for create mode. */
const CREATE_TARGET = "__create__";

const ROLE_LABEL: Record<ModelRoleKey, string> = {
  DEFAULT: "Default",
  FAST: "Fast",
  LANGY: "Langy",
  EMBEDDINGS: "Embeddings",
};

const ROLE_BLURB: Record<ModelRoleKey, string> = {
  DEFAULT:
    "Picked when a prompt or evaluator is created, and any high-stakes call without a specific override.",
  FAST: "Background and assistive surfaces like search, autocomplete, commit messages, topic clustering.",
  LANGY: "The model Langy chats and works with.",
  EMBEDDINGS: "Semantic vectors used by topic clustering and similar features.",
};

/**
 * Restricted-provider gating for the drawer's pickers (codex is the only
 * restricted provider today). A role-level default applies across every
 * feature in the role, so restricted models are offered only for the
 * roles whose whole feature set is licensed to run them (Langy, Fast);
 * a feature-override row re-admits them only when its own feature key
 * is licensed. Exported for tests.
 */
export function roleSelectModelOptions({
  options,
  role,
}: {
  options: string[];
  role: ModelRoleKey;
}): string[] {
  return options.filter((model) => isModelAllowedAsRoleDefault(model, role));
}

export function featureRowModelOptions({
  options,
  featureKey,
}: {
  options: string[];
  featureKey: string;
}): string[] {
  return options.filter((model) =>
    isModelAllowedForFeature({ modelId: model, featureKey }),
  );
}

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
  const utils = api.useUtils();
  const saveMutation = api.modelProvider.saveDefaultModelsConfig.useMutation();
  const { project } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();

  // Pulls the same Payload DefaultModelsSection consumes - tRPC
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

  // Treat the drawer as always-open while mounted - the registry only
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
  // changes - picking new scopes shifts the cascade answer.

  // ── Local state ───────────────────────────────────────────────────
  // `config` mirrors the JSON we'll send on save. Keys present here =
  // overrides. Keys absent = inherit. Local-only "EXPANDED" tracking
  // for which roles have their feature lists open in the form.

  const [scopes, setScopes] = useState<ScopeTriadEntry[]>([]);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<ModelRoleKey, boolean>>({
    DEFAULT: false,
    FAST: false,
    LANGY: false,
    EMBEDDINGS: false,
  });
  const [busy, setBusy] = useState(false);

  // Hydrate edit state once per target, and re-hydrate when the target
  // changes. Both halves matter: keying on the `editing` object identity
  // wiped in-progress edits whenever a background refetch replaced the
  // query data, while a plain "hydrated once" latch goes the other way
  // and keeps the previous target's values. The drawer is non-modal, so
  // the pencil and "+ Add config" behind it can retarget it without ever
  // unmounting, and stale values would then be saved onto another row.
  const hydratedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editingId) {
      // Create mode has nothing to load, it starts empty.
      if (hydratedForRef.current === CREATE_TARGET) return;
      hydratedForRef.current = CREATE_TARGET;
      setScopes([]);
      setConfig({});
      return;
    }
    if (!editing || hydratedForRef.current === editing.id) return;
    hydratedForRef.current = editing.id;
    setScopes(
      editing.scopes.map((s) => ({
        scopeType: s.type as ScopeType,
        scopeId: s.id,
      })),
    );
    setConfig({ ...(editing.config as Record<string, string>) });
  }, [editingId, editing]);

  const inheritedQuery = api.modelProvider.getInheritedValuesForScopes.useQuery(
    {
      projectId: project?.id ?? "",
      scopes: scopes.map((s) => ({
        scopeType: s.scopeType,
        scopeId: s.scopeId,
      })),
      excludeConfigId: editingId,
    },
    {
      // Need at least one picked scope to anchor the cascade walk.
      enabled: !!project?.id && scopes.length > 0 && open,
    },
  );
  const inherited = inheritedQuery.data?.inherited ?? {};

  const featuresByRole = useMemo(() => {
    const m: Record<ModelRoleKey, FeatureProjection[]> = {
      DEFAULT: [],
      FAST: [],
      LANGY: [],
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
  // the picker - a user with only Anthropic configured would see
  // Voyage / Gemini / Perplexity embeddings just because those env
  // vars are set on the host. `listAllForProjectForFrontend` returns
  // stored rows only.
  const projectProviders = api.modelProvider.listAllForProjectForFrontend.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && open, refetchOnMount: false },
  );

  const modelOptionsByRole = useMemo(() => {
    const isLoading = projectProviders.isLoading;
    const hasProviderLoadError = projectProviders.isError;
    const providers = projectProviders.data ?? [];
    const enabledEntries: Array<[string, (typeof providers)[number]]> = providers
      .filter((p) => p.enabled === true)
      .map((p) => [p.provider, p]);
    const enabledKeys = new Set(enabledEntries.map(([k]) => k));
    // Build the alias entries for enabled providers that support them.
    // Aliases sit at the TOP of the chat list (DEFAULT + FAST) so the
    // user lands on "Latest" / "Latest smaller" without scrolling - the
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
      // fall through to the enabled-filter path or - if the project
      // has zero enabled providers (or the query errored) - return an
      // empty list so the picker doesn't lie about what's available.
      if (isLoading) {
        return modelSelectorOptions.filter((o) => o.mode === mode).map((o) => o.value);
      }
      if (hasProviderLoadError || enabledEntries.length === 0) return [];
      // Registry chat/embedding models from any enabled provider. This
      // mirrors the ModelProviderDefaultSection logic - the registry is
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
            ? (providerData.customEmbeddingsModels ?? [])
            : (providerData.customModels ?? []);
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
      LANGY: [...aliasChatOptions, ...chatOptions],
      EMBEDDINGS: filterByMode("embedding"),
    } satisfies Record<ModelRoleKey, string[]>;
  }, [projectProviders.data]);

  // Configured custom-model display names for every provider row this
  // project can see, keyed by `<provider>/<modelId>`.
  const displayNames = useMemo(
    () => buildCustomModelDisplayNames(projectProviders.data ?? []),
    [projectProviders.data],
  );

  const setOverride = useCallback((key: string, model: string | null) => {
    setConfig((prev) => {
      const next = { ...prev };
      // Inherit sentinel + null + empty string all map to "clear the
      // key from in-progress JSON" - the cascade walks up at save time
      // since absent keys mean inherit (no sentinel in storage).
      if (model === null || model === "" || model === INHERIT_SENTINEL) {
        delete next[key];
      } else {
        next[key] = model;
      }
      return next;
    });
  }, []);

  // Creating: at least one key must be pinned, an all-inherit new
  // config is a no-op the backend refuses. Editing: an empty config is
  // a valid save (it deletes the config, absence = pure inherit), but
  // the target row must have loaded so the save carries its id;
  // deriving the id from an unsettled query silently turned edits
  // into creates.
  const hasAnyKey = Object.keys(config).length > 0;
  const canSave = scopes.length > 0 && !busy && (editingId ? !!editing : hasAnyKey);

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    const copy = saveOutcomeCopy({ editingId, hasAnyKey });
    setBusy(true);
    try {
      await saveMutation.mutateAsync({
        id: editingId,
        config,
        scopes: scopes.map((s) => ({
          scopeType: s.scopeType,
          scopeId: s.scopeId,
        })),
      });
      // Refresh every default-model cache AND snap Langy's model pill to the
      // new default when it was following the old one — an open panel used to
      // keep offering the outgoing model until a full reload.
      if (project?.id) {
        await syncLangyAfterDefaultModelWrite({
          utils,
          projectId: project.id,
        });
      }
      toaster.create({
        title: copy.successTitle,
        type: "success",
        duration: 2500,
      });
      onSaved();
      onClose();
    } catch (err) {
      showErrorToast({ error: err, fallbackTitle: copy.failureTitle });
    } finally {
      setBusy(false);
    }
  }, [
    canSave,
    saveMutation,
    editingId,
    hasAnyKey,
    config,
    scopes,
    utils,
    onSaved,
    onClose,
  ]);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(d) => {
        if (!d.open) onClose();
      }}
      size="md"
    >
      <Drawer.Content data-testid="default-model-override-drawer" portalled={false}>
        <Drawer.Header>
          <Drawer.Title>
            {editing ? "Edit default models" : "Add default models"}
          </Drawer.Title>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={5}>
            <ScopeSection scopes={scopes} onChange={setScopes} available={available} />
            <ReplacedConfigsNote
              scopes={scopes}
              configs={dataQuery.data?.configs ?? []}
              editingId={editingId}
            />

            <VStack align="stretch" gap={2}>
              {ROLES.map((role) => (
                <RoleRow
                  key={role}
                  role={role}
                  config={config}
                  features={featuresByRole[role]}
                  inheritedForRole={inherited[role] ?? null}
                  inheritedForFeature={inherited}
                  expanded={expanded[role]}
                  onToggleExpand={() =>
                    setExpanded((prev) => ({ ...prev, [role]: !prev[role] }))
                  }
                  modelOptions={modelOptionsByRole[role]}
                  onSetOverride={setOverride}
                  displayNames={displayNames}
                />
              ))}
            </VStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          {/* Delete moved to the row's 3-dot menu in the table - matches
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
  inheritedForRole,
  inheritedForFeature,
  expanded,
  onToggleExpand,
  modelOptions,
  onSetOverride,
  displayNames,
}: {
  role: ModelRoleKey;
  config: Record<string, string>;
  features: FeatureProjection[];
  /** Server's cascade answer for this role at the picked scopes. Null
   *  when no picked scope OR no cascade hit AND no inferable provider. */
  inheritedForRole: InheritedEntry;
  /** Server's per-key cascade answers; used by feature rows below. */
  inheritedForFeature: Record<string, InheritedEntry>;
  expanded: boolean;
  onToggleExpand: () => void;
  modelOptions: string[];
  onSetOverride: (key: string, model: string | null) => void;
  /** Configured custom-model display names, keyed by `<provider>/<modelId>`. */
  displayNames: Record<string, string>;
}) {
  const current = config[role] ?? "";
  const inheritOption = buildInheritOption(inheritedForRole);
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
      <HStack gap={2} align="center" paddingY={1} opacity={unsupportedAtScope ? 0.55 : 1}>
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
            options={roleSelectModelOptions({ options: modelOptions, role })}
            onChange={(m) => onSetOverride(role, m)}
            inheritOption={inheritOption}
            disabled={unsupportedAtScope}
            displayNames={displayNames}
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
          No provider configured at this scope ships an embedding API. Add an
          embedding-capable provider (OpenAI, Voyage, Cohere) to unlock topic clustering
          and semantic search.
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
              modelOptions={modelOptions}
              onSetOverride={onSetOverride}
              displayNames={displayNames}
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
  modelOptions,
  onSetOverride,
  displayNames,
}: {
  feature: FeatureProjection;
  override: string;
  roleLevelOverride: string;
  /** Server cascade answer for this exact feature key. */
  inheritedForFeature: InheritedEntry;
  /** Server cascade answer for the feature's role (fallback chain). */
  inheritedForRole: InheritedEntry;
  modelOptions: string[];
  onSetOverride: (key: string, model: string | null) => void;
  /** Configured custom-model display names, keyed by `<provider>/<modelId>`. */
  displayNames: Record<string, string>;
}) {
  // The feature's inherit entry follows the same cascade the resolver
  // does: a role-level pick in THIS config (in-progress) wins over the
  // server's per-feature cascade, which in turn beats the role cascade.
  // Without that local check the entry would lag behind what the user
  // just typed in the role row above. When nothing carries a value the
  // entry reads "Not configured", same as the role rows.
  let inheritOption: InheritOptionShape;
  if (roleLevelOverride) {
    inheritOption = {
      model: roleLevelOverride,
      label: "Inherit (role default in this config)",
    };
  } else {
    inheritOption =
      inheritHitOption(inheritedForFeature) ?? buildInheritOption(inheritedForRole);
  }
  return (
    <HStack gap={2} align="center" data-testid={`feature-row-${feature.key}`}>
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
          options={featureRowModelOptions({
            options: modelOptions,
            featureKey: feature.key,
          })}
          onChange={(m) => onSetOverride(feature.key, m)}
          inheritOption={inheritOption ?? undefined}
          displayNames={displayNames}
        />
      </Box>
      <Box width="24px" flexShrink={0} />
    </HStack>
  );
}

export type InheritOptionShape = { model?: string; label: string };

/**
 * Toast copy for the save outcome. Saving an edit with every key on
 * inherit deletes the config on the server (absence = pure inherit),
 * so the toast has to say the config was removed instead of "updated".
 */
function saveOutcomeCopy({
  editingId,
  hasAnyKey,
}: {
  editingId?: string;
  hasAnyKey: boolean;
}): { successTitle: string; failureTitle: string } {
  if (!editingId) {
    return {
      successTitle: "Config added",
      failureTitle: "Couldn't add the default model",
    };
  }
  return {
    successTitle: hasAnyKey
      ? "Config updated"
      : "Config removed, every value inherits now",
    failureTitle: "Couldn't save the default model",
  };
}

/**
 * The inherit entry for a real cascade hit at the picked scopes, or
 * undefined when the server has none. The label names the WIDER scope
 * the value flows down from ("Inherit (from organization)"), which is
 * why the entry is built only from the server's answer for the picked
 * scopes: the server anchors its walk at the most-specific picked
 * scope and excludes the picked scopes themselves, so it can never
 * answer with a narrower tier. The old fallback to the current
 * project's own resolution is what produced "Inherit (from project)"
 * inside an organization-scoped config.
 *
 * The `inferred` source is not a cascade hit, it is the server
 * guessing what the user might want from their enabled providers.
 * Showing it as a ghost value gave the contradictory read that
 * something was set when nothing was.
 */
export function inheritHitOption(entry: InheritedEntry): InheritOptionShape | undefined {
  if (!entry || entry.source === "inferred") return undefined;
  return {
    model: entry.model,
    label: entry.scope ? `Inherit (from ${entry.scope})` : "Inherit",
  };
}

/**
 * Builds the `inheritOption` payload `ProviderModelSelector` consumes.
 * With a cascade hit the entry carries the inherited model, rendered at
 * reduced opacity in the trigger and as the first dropdown entry. With
 * no hit (nothing set anywhere wider, or the widest scope is picked)
 * the entry reads "Not configured" with no model attached: it still
 * exists so an edit can always clear a pinned key back to inherit, it
 * just never claims a value flows down from somewhere.
 */
export function buildInheritOption(entry: InheritedEntry): InheritOptionShape {
  return inheritHitOption(entry) ?? { label: "Not configured" };
}

/**
 * Note under the scope picker when a picked scope already belongs to
 * another config. Saving claims those scopes (one config per scope), so
 * the user learns the existing config gets replaced BEFORE hitting
 * save, instead of discovering a silently rewired table after.
 */
function replacedScopeNames({
  scopes,
  configs,
  editingId,
}: {
  scopes: ScopeTriadEntry[];
  configs: Payload["configs"];
  editingId?: string;
}): string[] {
  const picked = new Set(scopes.map((s) => `${s.scopeType}::${s.scopeId}`));
  const names: string[] = [];
  for (const c of configs) {
    if (c.id === editingId) continue;
    for (const s of c.scopes) {
      if (picked.has(`${s.type}::${s.id}`)) names.push(s.name);
    }
  }
  return Array.from(new Set(names));
}

function ReplacedConfigsNote({
  scopes,
  configs,
  editingId,
}: {
  scopes: ScopeTriadEntry[];
  configs: Payload["configs"];
  editingId?: string;
}) {
  const replacedNames = useMemo(
    () => replacedScopeNames({ scopes, configs, editingId }),
    [scopes, configs, editingId],
  );
  if (replacedNames.length === 0) return null;
  const isSingle = replacedNames.length === 1;
  return (
    // The note appears only after a scope is picked, and it is the one
    // warning that saving overwrites another config. `role="status"`
    // makes the insertion announced, so it reaches a screen reader user
    // before they save rather than not at all.
    <Text
      fontSize="xs"
      color="fg.muted"
      role="status"
      data-testid="replaced-configs-note"
    >
      {replacedNames.join(", ")} already {isSingle ? "has" : "have"} default models.
      Saving replaces {isSingle ? "that config" : "those configs"}.
    </Text>
  );
}

/**
 * Scope picker section. Quick-pick chips ("Organization" / "This team"
 * / "This project") follow the same pattern as `ProviderScopeSection`
 * from the model-provider drawer - picking one replaces the selection
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
  scopes: ScopeTriadEntry[];
  onChange: (next: ScopeTriadEntry[]) => void;
  available: Payload["available"];
}) {
  // Drawer renders only the dropdown - the Organization/Team/Project
  // quick-pick chips are redundant when scope assignment is effectively
  // always at org scope, and the dropdown already surfaces all reachable
  // scopes. The quick-pick variant is preserved on `ScopeChipPicker`
  // (`showQuickPicks` prop) for future surfaces where the chip-row UX
  // makes sense.
  // Default label is "Scope" - render it so the picker reads consistent
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
