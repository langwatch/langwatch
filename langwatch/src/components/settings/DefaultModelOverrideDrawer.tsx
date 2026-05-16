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

import {
  Box,
  Button,
  Card,
  Field,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { allModelOptions } from "~/components/ModelSelector";
import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { api, type RouterOutputs } from "~/utils/api";

import { ModelChip } from "./ModelChip";
import { ProviderModelSelector } from "./ProviderModelSelector";
import {
  ScopeChipPicker,
  type ScopeChipPickerEntry,
} from "./ScopeChipPicker";
import { SmallLabel } from "../SmallLabel";

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
  FAST: "Background and assistive surfaces — search, autocomplete, commit messages, topic clustering.",
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
  onSaved: () => void;
}

export function DefaultModelOverrideDrawer({
  open,
  onClose,
  editing,
  available,
  features,
  effective,
  onSaved,
}: Props) {
  const utils = api.useContext();
  const saveMutation = api.modelProvider.saveDefaultModelsConfig.useMutation();
  const deleteMutation =
    api.modelProvider.deleteDefaultModelsConfig.useMutation();

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

  const featuresByRole = useMemo(() => {
    const m: Record<ModelRoleKey, FeatureProjection[]> = {
      DEFAULT: [],
      FAST: [],
      EMBEDDINGS: [],
    };
    for (const f of features) m[f.role as ModelRoleKey]?.push(f);
    return m;
  }, [features]);

  const modelOptions = useMemo(() => allModelOptions, []);

  const setOverride = useCallback((key: string, model: string | null) => {
    setConfig((prev) => {
      const next = { ...prev };
      if (model === null || model === "") delete next[key];
      else next[key] = model;
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

  const handleDelete = useCallback(async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await deleteMutation.mutateAsync({ id: editing.id });
      await utils.modelProvider.getDefaultModelsForProject.invalidate();
      toaster.create({
        title: "Config deleted",
        type: "success",
        duration: 2500,
        meta: { closable: true },
      });
      onSaved();
      onClose();
    } catch (err) {
      toaster.create({
        title: "Failed to delete",
        description: err instanceof Error ? err.message : String(err),
        type: "error",
        duration: 6000,
        meta: { closable: true },
      });
    } finally {
      setBusy(false);
    }
  }, [editing, deleteMutation, utils, onSaved, onClose]);

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
            <ScopeChipPicker
              value={scopes}
              onChange={setScopes}
              organizationId={available.organization?.id}
              organizationName={available.organization?.name}
              availableTeams={available.teams}
              availableProjects={available.projects}
              label="Scope(s) this config applies to"
            />

            {ROLES.map((role) => (
              <RoleRow
                key={role}
                role={role}
                config={config}
                features={featuresByRole[role]}
                effective={effective[role]}
                expanded={expanded[role]}
                onToggleExpand={() =>
                  setExpanded((prev) => ({ ...prev, [role]: !prev[role] }))
                }
                modelOptions={modelOptions}
                onSetOverride={setOverride}
              />
            ))}
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full" justify="space-between">
            <Button
              variant="ghost"
              colorPalette="red"
              size="sm"
              onClick={handleDelete}
              disabled={!editing || busy}
              data-testid="config-delete"
            >
              Delete
            </Button>
            <HStack gap={2}>
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
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function RoleRow({
  role,
  config,
  features,
  effective,
  expanded,
  onToggleExpand,
  modelOptions,
  onSetOverride,
}: {
  role: ModelRoleKey;
  config: Record<string, string>;
  features: FeatureProjection[];
  effective: Payload["effective"][ModelRoleKey];
  expanded: boolean;
  onToggleExpand: () => void;
  modelOptions: string[];
  onSetOverride: (key: string, model: string | null) => void;
}) {
  const current = config[role] ?? "";
  const inheritedModel = effective?.model;
  const inheritedSource = effective?.scope;
  const canExpand = features.length > 0;
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;

  return (
    <Card.Root data-testid={`role-row-${role.toLowerCase()}`}>
      <Card.Body padding={3}>
        <VStack align="stretch" gap={2}>
          <HStack gap={3} align="center">
            {canExpand ? (
              <Box
                as="button"
                onClick={onToggleExpand}
                cursor="pointer"
                data-testid={`role-row-${role.toLowerCase()}-expand`}
              >
                <ChevronIcon size={16} />
              </Box>
            ) : (
              <Box width="16px" />
            )}
            <Box width="100px" flexShrink={0}>
              <Text fontWeight="medium">{ROLE_LABEL[role]}</Text>
            </Box>
            <Box flex={1} position="relative">
              {!current && inheritedModel && (
                <Box
                  position="absolute"
                  insetInlineStart={3}
                  top={0}
                  bottom={0}
                  display="flex"
                  alignItems="center"
                  pointerEvents="none"
                  data-testid={`role-row-${role.toLowerCase()}-inherited-placeholder`}
                >
                  <ModelChip model={inheritedModel} size="sm" inherited />
                </Box>
              )}
              <ProviderModelSelector
                model={current}
                options={modelOptions}
                onChange={(m) => onSetOverride(role, m)}
              />
            </Box>
            <Text
              fontSize="xs"
              color="fg.muted"
              maxWidth="220px"
              data-testid={`role-row-${role.toLowerCase()}-blurb`}
            >
              {ROLE_BLURB[role]}
            </Text>
          </HStack>
          {current && (
            <HStack gap={2} paddingLeft="116px">
              <Text fontSize="xs" color="fg.muted">
                Pinned at this scope. Clear to inherit
                {inheritedSource ? ` (${inheritedSource})` : ""}.
              </Text>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => onSetOverride(role, null)}
                data-testid={`role-row-${role.toLowerCase()}-clear`}
              >
                Clear
              </Button>
            </HStack>
          )}
          {canExpand && expanded && (
            <VStack
              align="stretch"
              gap={2}
              paddingLeft={6}
              paddingTop={2}
              data-testid={`role-row-${role.toLowerCase()}-features`}
            >
              {features.map((f) => (
                <FeatureRow
                  key={f.key}
                  feature={f}
                  override={config[f.key] ?? ""}
                  roleLevelOverride={config[role] ?? ""}
                  inheritedModel={inheritedModel}
                  modelOptions={modelOptions}
                  onSetOverride={onSetOverride}
                />
              ))}
            </VStack>
          )}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

function FeatureRow({
  feature,
  override,
  roleLevelOverride,
  inheritedModel,
  modelOptions,
  onSetOverride,
}: {
  feature: FeatureProjection;
  override: string;
  roleLevelOverride: string;
  inheritedModel?: string;
  modelOptions: string[];
  onSetOverride: (key: string, model: string | null) => void;
}) {
  // The feature's "would inherit" placeholder follows the same cascade
  // the resolver does: a role-level pick in THIS config wins over the
  // out-of-config effective model. That gives the user a faithful
  // preview of what saving with the current form state would mean.
  const wouldInherit = roleLevelOverride || inheritedModel || "";
  return (
    <HStack
      gap={3}
      align="center"
      data-testid={`feature-row-${feature.key}`}
    >
      <Box width="160px" flexShrink={0}>
        <Text fontSize="sm">{feature.displayName}</Text>
        <Text fontSize="xs" color="fg.muted">
          {feature.description}
        </Text>
      </Box>
      <Box flex={1} position="relative">
        {!override && wouldInherit && (
          <Box
            position="absolute"
            insetInlineStart={3}
            top={0}
            bottom={0}
            display="flex"
            alignItems="center"
            pointerEvents="none"
            data-testid={`feature-row-${feature.key}-inherited-placeholder`}
          >
            <ModelChip model={wouldInherit} size="sm" inherited />
          </Box>
        )}
        <ProviderModelSelector
          model={override}
          options={modelOptions}
          onChange={(m) => onSetOverride(feature.key, m)}
        />
      </Box>
      {override && (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => onSetOverride(feature.key, null)}
          data-testid={`feature-row-${feature.key}-clear`}
        >
          Clear
        </Button>
      )}
    </HStack>
  );
}
