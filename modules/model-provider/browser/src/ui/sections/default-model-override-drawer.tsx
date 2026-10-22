/**
 * `defaultModelOverride`: "Inherit" on the wire is key absence. The Langy pill sync helper is
 * missing on purpose (importing `@langwatch/langy-browser` back would cycle), so an open panel
 * keeps the outgoing model stale until remounted.
 */
import type { WireOf } from "@langwatch/api/web";
import { useDrawer } from "@langwatch/browser-host/drawer";
import { Drawer } from "@langwatch/design-system/drawer";
import { Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import {
  INHERIT_SENTINEL,
  ProviderModelSelector,
} from "@langwatch/design-system/provider-model-selector";
import { ScopeChipPicker, type ScopeTriadEntry } from "@langwatch/design-system/scope-chip-picker";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useFeatureFlag } from "@langwatch/feature-flag-client";
import { FrontendFlags, NOT_TARGETED } from "@langwatch/feature-flag-contract";
import {
  buildCustomModelDisplayNames,
  isModelAllowedAsRoleDefault,
  isModelAllowedForFeature,
  LANGWATCH_DECISION_MODEL_ID,
  LATEST_ALIAS_PROVIDERS,
  MODEL_ROLES,
  modelDisplayLabel,
  modelPickerOption,
  modelSelectorOptions,
  type ModelDefaultInheritedValues,
  type ModelDefaultSnapshot,
  type ModelPickerOption,
  type ModelRole,
} from "@langwatch/model-provider-contract";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { modelProviderApi } from "../../behavior/model-provider-api.ts";
import {
  DECISION_MODEL_DISPLAY_NAMES,
  decisionModelPickerOptions,
} from "../../model/decision-model-options.ts";
import { MODEL_ROLE_LABEL } from "../../model/default-model-cascade.ts";
import { useModelProviderHost } from "../../model/model-provider-host.ts";

/** The snapshot as the browser holds one: its instants are ISO strings. */
type Payload = WireOf<ModelDefaultSnapshot>;

type FeatureProjection = Payload["features"][number];
type ScopeType = "ORGANIZATION" | "TEAM" | "PROJECT";

/** Stands in for "no row" in the hydration latch, which tracks which
 *  target the drawer's state belongs to and cannot use a config id
 *  for create mode. */
const CREATE_TARGET = "__create__";

const ROLE_BLURB: Record<ModelRole, string> = {
  DEFAULT:
    "Picked when a prompt or evaluator is created, and any high-stakes call without a specific override.",
  FAST: "Background and assistive surfaces like search, autocomplete, commit messages, topic clustering.",
  LANGY: "The model Langy chats and works with.",
  EMBEDDINGS: "Semantic vectors used by topic clustering and similar features.",
  INSTANT_EVALS:
    "The decision model Instant Evals answer with. LangWatch Instant Preview unless you pick your own.",
};

/** One empty slot per role, so a per-role map never misses a column. */
function perRole<T>(make: () => T): Record<ModelRole, T> {
  return Object.fromEntries(MODEL_ROLES.map((role) => [role, make()])) as Record<ModelRole, T>;
}

/**
 * Restricted-provider gating (codex is the only restricted provider today): a role-level
 * default is offered only where the whole role's feature set is licensed for it (Langy,
 * Fast); a feature-override row re-admits it only when its own feature key is licensed.
 */
export function roleSelectModelOptions({
  options,
  role,
}: {
  options: string[];
  role: ModelRole;
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
  return options.filter((model) => isModelAllowedForFeature({ modelId: model, featureKey }));
}

type ConfigRow = Payload["configs"][number];
/** Only what the pickers read off a provider row. */
type ProviderRow = {
  provider: string;
  enabled?: boolean | null;
  customModels?: ({ modelId?: string | null } | null)[] | null;
  customEmbeddingsModels?: ({ modelId?: string | null } | null)[] | null;
};

function groupFeaturesByRole(
  features: FeatureProjection[],
): Record<ModelRole, FeatureProjection[]> {
  const byRole = perRole<FeatureProjection[]>(() => []);
  for (const f of features) byRole[f.role as ModelRole]?.push(f);

  return byRole;
}

/**
 * The inherit sentinel, null and the empty string all mean "clear the key
 * from the in-progress JSON": absence is inherit on the wire, so no sentinel
 * is ever stored.
 */
function withOverride(
  config: Record<string, string>,
  key: string,
  model: string | null,
): Record<string, string> {
  const next = { ...config };
  const clears = model === null || model === "" || model === INHERIT_SENTINEL;
  if (clears) {
    delete next[key];
    return next;
  }

  next[key] = model;

  return next;
}

/**
 * Hydrate once per target, then re-hydrate when the target changes. Keying on `editing`
 * object identity wiped in-progress edits on a background refetch; the drawer is
 * non-modal, so the pencil behind it can retarget without ever unmounting.
 */
function nextHydration({
  editing,
  editingId,
  hydratedFor,
}: {
  editing: ConfigRow | undefined;
  editingId: string | undefined;
  hydratedFor: string | null;
}): { config: Record<string, string>; scopes: ScopeTriadEntry[]; target: string } | null {
  if (!editingId) {
    if (hydratedFor === CREATE_TARGET) return null;

    return { config: {}, scopes: [], target: CREATE_TARGET };
  }
  if (!editing || hydratedFor === editing.id) return null;

  return {
    config: { ...(editing.config as Record<string, string>) },
    scopes: editing.scopes.map((s) => ({ scopeType: s.type as ScopeType, scopeId: s.id })),
    target: editing.id,
  };
}

/**
 * Creating: at least one key must be pinned, since an all-inherit config is a no-op the
 * server refuses. Every config needs a scope. Editing: an empty config is a valid save
 * (it deletes the config), but the target row must have loaded first.
 */
function configProblems({
  editingId,
  hasAnyKey,
  scopes,
}: {
  editingId: string | undefined;
  hasAnyKey: boolean;
  scopes: ScopeTriadEntry[];
}): { scope?: string; models?: string } {
  return {
    scope: scopes.length === 0 ? "Pick at least one scope." : void 0,
    models: !editingId && !hasAnyKey ? "Set a model for at least one role." : void 0,
  };
}

/**
 * Aliases sit at the top of the chat lists so the reader lands on "Latest" without
 * scrolling; pinning a specific model is the exceptional case. Embeddings get none, since
 * the latest embedding model isn't a moving target the way a chat flagship is.
 */
function aliasChatOptionsFor(enabledKeys: Set<string>): string[] {
  const aliases: string[] = [];
  for (const provider of LATEST_ALIAS_PROVIDERS) {
    if (!enabledKeys.has(provider)) continue;

    aliases.push(`${provider}/latest`);
    aliases.push(`${provider}/latest-mini`);
  }

  return aliases;
}

/** User-defined entries on each enabled provider, custom ids first. */
function customModelIdsFor({
  enabledEntries,
  mode,
}: {
  enabledEntries: [string, ProviderRow][];
  mode: "chat" | "embedding";
}): string[] {
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

  return customModels;
}

/**
 * Still loading: returns the full registry, so the dropdown isn't visually broken on first
 * paint. Once data lands, a project with no enabled providers (or a failed query) gets an
 * empty list rather than a picker that lies about what is available.
 */
function modelOptionsForMode({
  enabledEntries,
  hasProviderLoadError,
  isLoading,
  mode,
}: {
  enabledEntries: [string, ProviderRow][];
  hasProviderLoadError: boolean;
  isLoading: boolean;
  mode: "chat" | "embedding";
}): string[] {
  if (isLoading) {
    return modelSelectorOptions.filter((o) => o.mode === mode).map((o) => o.value);
  }
  if (hasProviderLoadError || enabledEntries.length === 0) return [];

  const enabledKeys = new Set(enabledEntries.map(([key]) => key));
  // The registry is the broad pool; provider toggles narrow it, the same way
  // ModelProviderDefaultSection reads it.
  const registryModels = modelSelectorOptions
    .filter((o) => o.mode === mode && enabledKeys.has(o.value.split("/")[0] ?? ""))
    .map((o) => o.value);

  return Array.from(new Set([...customModelIdsFor({ enabledEntries, mode }), ...registryModels]));
}

function modelOptionsByRoleFor({
  decisionOptions,
  hasProviderLoadError,
  isLoading,
  providers,
}: {
  decisionOptions: ModelPickerOption[];
  hasProviderLoadError: boolean;
  isLoading: boolean;
  providers: ProviderRow[];
}): Record<ModelRole, string[]> {
  const enabledEntries: [string, ProviderRow][] = providers
    .filter((p) => p.enabled === true)
    .map((p) => [p.provider, p]);
  const aliasChatOptions = aliasChatOptionsFor(new Set(enabledEntries.map(([key]) => key)));
  const chatOptions = modelOptionsForMode({
    enabledEntries,
    hasProviderLoadError,
    isLoading,
    mode: "chat",
  });

  return {
    DEFAULT: [...aliasChatOptions, ...chatOptions],
    FAST: [...aliasChatOptions, ...chatOptions],
    LANGY: [...aliasChatOptions, ...chatOptions],
    EMBEDDINGS: modelOptionsForMode({
      enabledEntries,
      hasProviderLoadError,
      isLoading,
      mode: "embedding",
    }),
    // Decision models only, never the chat catalogue (ADR-182 decision 2).
    INSTANT_EVALS: decisionOptions.map((option) => option.value),
  };
}

/**
 * The cache refresh runs in its own try: the write already committed, so a failed refresh
 * must not turn a successful save into a reported failure. Invalidating `modelProvider`
 * reaches every mounted reader on that prefix (including the Langy pill) but not Langy's own store.
 */
async function persistConfig({
  config,
  copy,
  editingId,
  host,
  saveMutation,
  scopes,
  utils,
}: {
  config: Record<string, string>;
  copy: { failureTitle: string; successTitle: string };
  editingId: string | undefined;
  host: ReturnType<typeof useModelProviderHost>;
  saveMutation: {
    mutateAsync(input: {
      id?: string;
      config: Record<string, string>;
      scopes: { scopeType: ScopeType; scopeId: string }[];
    }): Promise<unknown>;
  };
  scopes: ScopeTriadEntry[];
  utils: { modelProvider: { invalidate: () => Promise<void> } };
}): Promise<boolean> {
  try {
    await saveMutation.mutateAsync({
      id: editingId,
      config,
      scopes: scopes.map((s) => ({ scopeType: s.scopeType, scopeId: s.scopeId })),
    });
    try {
      await utils.modelProvider.invalidate();
    } catch {
      // Best-effort refresh; the save itself already succeeded.
    }
    host.succeeded({ title: copy.successTitle });

    return true;
  } catch (err) {
    if (!host.isReportedGlobally(err)) {
      host.failed({ error: err, fallbackTitle: copy.failureTitle });
    }

    return false;
  }
}

interface Props {
  /** Config id when editing; absent = create. Kept as a single serializable
   *  prop so the drawer fits the URL-driven `currentDrawer` pattern used
   *  everywhere else. */
  editingId?: string;
}

export function DefaultModelOverrideDrawer({ editingId }: Props) {
  const host = useModelProviderHost();
  const { closeDrawer } = useDrawer();
  const { projectId, organizationId } = host.scope();
  const utils = modelProviderApi.useUtils();
  // Asked of the organization only, so the picker agrees with the server's write check.
  const { enabled: ownDecisionModelsEnabled } = useFeatureFlag(
    FrontendFlags.release_instant_evals_own_decision_model,
    { projectId: NOT_TARGETED, organizationId, enabled: !!organizationId },
  );
  const saveMutation = modelProviderApi.modelProvider.saveDefaultModelsConfig.useMutation();

  // Pulls the same Payload DefaultModelsSection consumes - tRPC
  // de-duplicates the query so the parent page render doesn't pay an
  // extra round-trip. The drawer used to receive these as props from
  // the page, but URL-routed drawers can't accept non-serializable
  // payloads.
  const dataQuery = modelProviderApi.modelProvider.getDefaultModelsForProject.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );
  const editing = editingId ? dataQuery.data?.configs.find((c) => c.id === editingId) : undefined;
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
  const [expanded, setExpanded] = useState<Record<ModelRole, boolean>>(() => perRole(() => false));
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const scopeRef = useRef<HTMLDivElement>(null);
  const rolesRef = useRef<HTMLDivElement>(null);

  const hydratedForRef = useRef<string | null>(null);
  useEffect(() => {
    const next = nextHydration({ editing, editingId, hydratedFor: hydratedForRef.current });
    if (!next) return;

    hydratedForRef.current = next.target;
    setAttempted(false);
    setScopes(next.scopes);
    setConfig(next.config);
  }, [editingId, editing]);

  const inheritedQuery = modelProviderApi.modelProvider.getInheritedValuesForScopes.useQuery(
    {
      projectId: projectId ?? "",
      scopes: scopes.map((s) => ({
        scopeType: s.scopeType,
        scopeId: s.scopeId,
      })),
      excludeConfigId: editingId,
    },
    {
      // Need at least one picked scope to anchor the cascade walk.
      enabled: !!projectId && scopes.length > 0 && open,
    },
  );
  const inherited = inheritedQuery.data?.inherited ?? {};

  const featuresByRole = groupFeaturesByRole(features);

  // Narrow the picker to explicitly configured providers only. The legacy
  // `getAllForProject` Record merges in env-fed defaults, surfacing unrelated
  // providers just because their key is set on the host.
  // `listAllForProjectForFrontend` returns stored rows only.
  const projectProviders = modelProviderApi.modelProvider.listAllForProjectForFrontend.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId && open, refetchOnMount: false },
  );

  const decisionOptions = decisionModelPickerOptions({
    ownModelsEnabled: ownDecisionModelsEnabled,
    enabledProviderKeys: projectProviders.data
      ? new Set(projectProviders.data.filter((p) => p.enabled === true).map((p) => p.provider))
      : null,
  });
  const modelOptionsByRole = modelOptionsByRoleFor({
    decisionOptions,
    hasProviderLoadError: projectProviders.isError,
    isLoading: projectProviders.isLoading,
    providers: projectProviders.data ?? [],
  });

  // Configured custom-model display names for every provider row this
  // project can see, keyed by `<provider>/<modelId>`, plus the decision models' labels.
  const displayNames = {
    ...buildCustomModelDisplayNames(projectProviders.data ?? []),
    ...DECISION_MODEL_DISPLAY_NAMES,
  };
  const pickerOptionFor = (modelValue: string): ModelPickerOption =>
    decisionOptions.find((option) => option.value === modelValue) ??
    modelPickerOption({ displayNames, modelValue });

  const setOverride = (key: string, model: string | null) => {
    setConfig((prev) => withOverride(prev, key, model));
  };

  const hasAnyKey = Object.keys(config).length > 0;
  const problems = configProblems({ editingId, hasAnyKey, scopes });
  const targetPending = !!editingId && !editing;

  const handleSave = async () => {
    if (busy || targetPending) return;

    setAttempted(true);
    if (problems.scope) {
      focusFirstControl(scopeRef.current);
      return;
    }
    if (problems.models) {
      focusFirstControl(rolesRef.current);
      return;
    }

    const copy = saveOutcomeCopy({ editingId, hasAnyKey });
    setBusy(true);
    try {
      const saved = await persistConfig({
        config,
        copy,
        editingId,
        host,
        saveMutation,
        scopes,
        utils,
      });
      if (saved) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="sm"
      title={editing ? "Edit default models" : "Add default models"}
      data-testid="default-model-override-drawer"
      footer={{
        cancel: { onClick: onClose },
        primaryAction: {
          label: editing ? "Save changes" : "Add config",
          onClick: handleSave,
          loading: busy,
          disabledReason: targetPending ? "Loading this config" : void 0,
          "data-testid": "config-save",
        },
      }}
    >
      <VStack align="stretch" gap={5}>
        <Box ref={scopeRef}>
          <ScopeSection scopes={scopes} onChange={setScopes} available={available} />
          {attempted && problems.scope && (
            <Text color="red.fg" fontSize="xs" role="alert" data-testid="scope-error">
              {problems.scope}
            </Text>
          )}
        </Box>
        <ReplacedConfigsNote
          scopes={scopes}
          configs={dataQuery.data?.configs ?? []}
          editingId={editingId}
        />

        <VStack align="stretch" gap={2} ref={rolesRef}>
          {attempted && problems.models && (
            <Text color="red.fg" fontSize="xs" role="alert" data-testid="models-error">
              {problems.models}
            </Text>
          )}
          {MODEL_ROLES.map((role) => (
            <RoleRow
              key={role}
              role={role}
              config={config}
              features={featuresByRole[role]}
              inheritedForRole={inherited[role] ?? null}
              inheritedForFeature={inherited}
              expanded={expanded[role]}
              onToggleExpand={() => setExpanded((prev) => ({ ...prev, [role]: !prev[role] }))}
              modelOptions={modelOptionsByRole[role]}
              onSetOverride={setOverride}
              displayNames={displayNames}
              pickerOptionFor={pickerOptionFor}
            />
          ))}
        </VStack>
      </VStack>
    </Drawer>
  );
}

/** Moves focus to the first control inside a group, so a failed save lands the cursor there. */
function focusFirstControl(group: HTMLElement | null) {
  group?.querySelector<HTMLElement>('input, button, [role="combobox"]')?.focus();
}

type InheritedEntry = ModelDefaultInheritedValues["inherited"][string];

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
  pickerOptionFor,
}: {
  role: ModelRole;
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
  /** The picker entry for one model id: its label and the line under it. */
  pickerOptionFor: (modelValue: string) => ModelPickerOption;
}) {
  const current = config[role] ?? "";
  const inheritOption = buildInheritOption(inheritedForRole, role);
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
          <Box flexShrink={0} cursor="help" data-testid={`role-row-${role.toLowerCase()}-label`}>
            <Text fontWeight="medium" fontSize="sm">
              {MODEL_ROLE_LABEL[role]}
            </Text>
          </Box>
        </Tooltip>
        <Box flex={1} />
        <Box width="240px" flexShrink={0}>
          <ProviderModelSelector
            model={current}
            query={{
              data: roleSelectModelOptions({ options: modelOptions, role }).map(pickerOptionFor),
              isLoading: false,
            }}
            onChange={(m) => onSetOverride(role, m)}
            inheritOption={inheritOption}
            disabled={unsupportedAtScope}
            labelFor={(fullModelId) => modelDisplayLabel({ fullModelId, displayNames })}
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
          No provider configured at this scope ships an embedding API. Add an embedding-capable
          provider (OpenAI, Voyage, Cohere) to unlock topic clustering and semantic search.
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
              pickerOptionFor={pickerOptionFor}
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
  pickerOptionFor,
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
  pickerOptionFor: (modelValue: string) => ModelPickerOption;
}) {
  // The feature's inherit entry follows the resolver's cascade: a role-level
  // pick in THIS config wins over the server's per-feature cascade, which
  // beats the role cascade — otherwise it would lag behind what the user
  // just typed in the role row above.
  let inheritOption: InheritOptionShape;
  if (roleLevelOverride) {
    inheritOption = {
      model: roleLevelOverride,
      label: "Inherit (role default in this config)",
    };
  } else {
    inheritOption =
      inheritHitOption(inheritedForFeature) ??
      buildInheritOption(inheritedForRole, feature.role as ModelRole);
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
          query={{
            data: featureRowModelOptions({
              options: modelOptions,
              featureKey: feature.key,
            }).map(pickerOptionFor),
            isLoading: false,
          }}
          onChange={(m) => onSetOverride(feature.key, m)}
          inheritOption={inheritOption ?? undefined}
          labelFor={(fullModelId) => modelDisplayLabel({ fullModelId, displayNames })}
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
function saveOutcomeCopy({ editingId, hasAnyKey }: { editingId?: string; hasAnyKey: boolean }): {
  successTitle: string;
  failureTitle: string;
} {
  if (!editingId) {
    return {
      successTitle: "Config added",
      failureTitle: "Couldn't add the default model",
    };
  }
  return {
    successTitle: hasAnyKey ? "Config updated" : "Config removed, every value inherits now",
    failureTitle: "Couldn't save the default model",
  };
}

/**
 * The inherit entry for a real cascade hit, or undefined when the server has none.
 * `inferred` is not a cascade hit (the server guessing from enabled providers), and
 * showing it as a ghost value gave the contradictory read that something was set.
 */
export function inheritHitOption(entry: InheritedEntry): InheritOptionShape | undefined {
  if (!entry || entry.source === "inferred") return undefined;
  return {
    model: entry.model,
    label: entry.scope ? `Inherit (from ${entry.scope})` : "Inherit",
  };
}

/**
 * Builds the `inheritOption` payload `ProviderModelSelector` consumes. With no cascade
 * hit it reads "Not configured" with no model attached, so an edit can clear a pinned key
 * back to inherit; the Instant Evals column instead falls back to LangWatch Instant Preview.
 */
export function buildInheritOption(entry: InheritedEntry, role?: ModelRole): InheritOptionShape {
  const hit = inheritHitOption(entry);
  if (hit) return hit;
  if (role === "INSTANT_EVALS") return { model: LANGWATCH_DECISION_MODEL_ID, label: "Default" };
  return { label: "Not configured" };
}

/**
 * Note under the scope picker when a picked scope already belongs to
 * another config: saving claims those scopes (one config per scope), so the
 * user learns about the replacement BEFORE hitting save.
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
  const replacedNames = replacedScopeNames({ scopes, configs, editingId });
  if (replacedNames.length === 0) return null;
  const isSingle = replacedNames.length === 1;
  return (
    // The note appears only after a scope is picked, and it is the one
    // warning that saving overwrites another config. `<output>`
    // makes the insertion announced, so it reaches a screen reader user
    // before they save rather than not at all.
    <Text
      fontSize="xs"
      color="fg.muted"
      as="output"
      display="block"
      data-testid="replaced-configs-note"
    >
      {replacedNames.join(", ")} already {isSingle ? "has" : "have"} default models. Saving replaces{" "}
      {isSingle ? "that config" : "those configs"}.
    </Text>
  );
}

/**
 * Scope picker section, following `ProviderScopeSection`'s pattern but kept
 * inline: it is tightly coupled to `useModelProviderForm`'s reducer, a
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
  // Renders only the dropdown: the Organization/Team/Project quick-pick
  // chips are redundant when scope assignment is effectively always at org
  // scope, and the dropdown already surfaces all reachable scopes (chips
  // stay available via `ScopeChipPicker`'s `showQuickPicks` prop). Default
  // label "Scope" matches the model-provider drawer's scope section.
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
