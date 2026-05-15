/**
 * Drawer for authoring or editing a single default-model override
 * assignment. Mirrors the shape from the flat-assignments payload:
 * pick one or more scopes via `ScopeChipPicker`, pick whether the rule
 * targets a whole role or a specific feature, pick the model.
 *
 * Saving fans out the right per-scope set / clear calls so the storage
 * (one ModelDefault row per scope) stays consistent with the grouped
 * "one rule, many chips" UI representation. See
 * specs/model-providers/role-based-default-models.feature for the
 * behavioural contract.
 */

import {
  Badge,
  Button,
  Field,
  HStack,
  RadioGroup,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { allModelOptions } from "~/components/ModelSelector";
import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { api, type RouterOutputs } from "~/utils/api";

import { ProviderModelSelector } from "./ProviderModelSelector";
import {
  ScopeChipPicker,
  type ScopeChipPickerEntry,
} from "./ScopeChipPicker";
import { SmallLabel } from "../SmallLabel";

type Payload = RouterOutputs["modelProvider"]["getDefaultModelsForProject"];
type Assignment = Payload["assignments"][number];
type FeatureProjection = Payload["features"][number];
type ScopeType = "ORGANIZATION" | "TEAM" | "PROJECT";
type ModelRoleKey = "DEFAULT" | "FAST" | "EMBEDDINGS";

const ROLE_LABEL: Record<ModelRoleKey, string> = {
  DEFAULT: "Default",
  FAST: "Fast",
  EMBEDDINGS: "Embeddings",
};

interface Props {
  open: boolean;
  onClose: () => void;
  /** Undefined = creating a new override; set = editing an existing one. */
  editing?: Assignment;
  available: Payload["available"];
  features: FeatureProjection[];
  onSaved: () => void;
}

export function DefaultModelOverrideDrawer({
  open,
  onClose,
  editing,
  available,
  features,
  onSaved,
}: Props) {
  const utils = api.useContext();
  const setRoleMutation =
    api.modelProvider.setRoleAssignmentForScope.useMutation();
  const setFeatureMutation =
    api.modelProvider.setFeatureOverrideForScope.useMutation();

  // ── Local form state ──────────────────────────────────────────────
  // `scopes` holds the chip selection. `target` is the radio + the
  // chosen role or feature key. `model` is the picked model. Saving
  // diffs originalScopes vs scopes and issues set/clear per-scope.

  const [scopes, setScopes] = useState<ScopeChipPickerEntry[]>([]);
  const [mode, setMode] = useState<"role" | "feature">("role");
  const [role, setRole] = useState<ModelRoleKey>("DEFAULT");
  const [featureKey, setFeatureKey] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Snapshot the original identity so a role/featureKey change knows to
  // delete the old rows in addition to writing the new ones.
  const original = useMemo(() => {
    if (!editing) return null;
    return {
      scopes: editing.scopes.map((s) => ({
        scopeType: s.type as ScopeType,
        scopeId: s.id,
      })),
      role: editing.role as ModelRoleKey,
      featureKey: editing.featureKey,
      model: editing.model,
    };
  }, [editing]);

  // (Re)hydrate state whenever the drawer is reopened with a different
  // editing target (or for a fresh create).
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setScopes(
        editing.scopes.map((s) => ({
          scopeType: s.type as ScopeType,
          scopeId: s.id,
        })),
      );
      setMode(editing.featureKey ? "feature" : "role");
      setRole(editing.role as ModelRoleKey);
      setFeatureKey(editing.featureKey ?? "");
      setModel(editing.model);
    } else {
      setScopes([]);
      setMode("role");
      setRole("DEFAULT");
      setFeatureKey("");
      setModel("");
    }
  }, [open, editing]);

  const modelOptions = useMemo(() => allModelOptions, []);
  const featureOptions = useMemo(() => features, [features]);

  const targetValid =
    mode === "role" ? !!role : !!featureKey && !!features.find((f) => f.key === featureKey);
  const canSave = scopes.length > 0 && targetValid && !!model && !saving;
  const canDelete = !!editing && !saving;

  // ── Save flow ─────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const writes: Array<Promise<unknown>> = [];

      // Identity change: clear every original row before writing the new
      // set, since the (role, featureKey) identifier moved.
      const identityChanged =
        original !== null &&
        (original.role !==
          (mode === "role" ? role : (features.find((f) => f.key === featureKey)?.role ?? role)) ||
          (original.featureKey ?? "") !== (mode === "feature" ? featureKey : ""));

      const clearScopes = identityChanged
        ? original?.scopes ?? []
        : (original?.scopes ?? []).filter(
            (orig) =>
              !scopes.find(
                (s) =>
                  s.scopeType === orig.scopeType && s.scopeId === orig.scopeId,
              ),
          );

      for (const s of clearScopes) {
        if (original?.featureKey) {
          writes.push(
            setFeatureMutation.mutateAsync({
              scopeType: s.scopeType,
              scopeId: s.scopeId,
              featureKey: original.featureKey,
              model: null,
            }),
          );
        } else {
          writes.push(
            setRoleMutation.mutateAsync({
              scopeType: s.scopeType,
              scopeId: s.scopeId,
              role: original?.role ?? role,
              model: null,
            }),
          );
        }
      }

      for (const s of scopes) {
        if (mode === "feature") {
          writes.push(
            setFeatureMutation.mutateAsync({
              scopeType: s.scopeType,
              scopeId: s.scopeId,
              featureKey,
              model,
            }),
          );
        } else {
          writes.push(
            setRoleMutation.mutateAsync({
              scopeType: s.scopeType,
              scopeId: s.scopeId,
              role,
              model,
            }),
          );
        }
      }

      await Promise.all(writes);
      await utils.modelProvider.getDefaultModelsForProject.invalidate();
      toaster.create({
        title: editing ? "Override updated" : "Override added",
        type: "success",
        duration: 2500,
        meta: { closable: true },
      });
      onSaved();
      onClose();
    } catch (err) {
      toaster.create({
        title: "Failed to save override",
        description: err instanceof Error ? err.message : String(err),
        type: "error",
        duration: 6000,
        meta: { closable: true },
      });
    } finally {
      setSaving(false);
    }
  }, [
    canSave,
    original,
    mode,
    role,
    featureKey,
    features,
    scopes,
    model,
    editing,
    onSaved,
    onClose,
    setRoleMutation,
    setFeatureMutation,
    utils,
  ]);

  // ── Delete flow ───────────────────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const writes: Array<Promise<unknown>> = [];
      for (const s of editing.scopes) {
        if (editing.featureKey) {
          writes.push(
            setFeatureMutation.mutateAsync({
              scopeType: s.type as ScopeType,
              scopeId: s.id,
              featureKey: editing.featureKey,
              model: null,
            }),
          );
        } else {
          writes.push(
            setRoleMutation.mutateAsync({
              scopeType: s.type as ScopeType,
              scopeId: s.id,
              role: editing.role,
              model: null,
            }),
          );
        }
      }
      await Promise.all(writes);
      await utils.modelProvider.getDefaultModelsForProject.invalidate();
      toaster.create({
        title: "Override deleted",
        type: "success",
        duration: 2500,
        meta: { closable: true },
      });
      onSaved();
      onClose();
    } catch (err) {
      toaster.create({
        title: "Failed to delete override",
        description: err instanceof Error ? err.message : String(err),
        type: "error",
        duration: 6000,
        meta: { closable: true },
      });
    } finally {
      setSaving(false);
    }
  }, [editing, onSaved, onClose, setRoleMutation, setFeatureMutation, utils]);

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
            {editing ? "Edit override" : "Add override"}
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
              label="Scope(s) this override applies to"
            />

            <Field.Root>
              <SmallLabel>What does it override?</SmallLabel>
              <RadioGroup.Root
                value={mode}
                onValueChange={(d) => setMode(d.value as "role" | "feature")}
              >
                <HStack gap={4}>
                  <RadioGroup.Item
                    value="role"
                    data-testid="override-mode-role"
                  >
                    <RadioGroup.ItemHiddenInput />
                    <RadioGroup.ItemIndicator />
                    <RadioGroup.ItemText>A whole role</RadioGroup.ItemText>
                  </RadioGroup.Item>
                  <RadioGroup.Item
                    value="feature"
                    data-testid="override-mode-feature"
                  >
                    <RadioGroup.ItemHiddenInput />
                    <RadioGroup.ItemIndicator />
                    <RadioGroup.ItemText>
                      A specific feature
                    </RadioGroup.ItemText>
                  </RadioGroup.Item>
                </HStack>
              </RadioGroup.Root>
            </Field.Root>

            {mode === "role" ? (
              <Field.Root>
                <SmallLabel>Role</SmallLabel>
                <HStack gap={2}>
                  {(["DEFAULT", "FAST", "EMBEDDINGS"] as const).map((r) => (
                    <Button
                      key={r}
                      size="sm"
                      variant={role === r ? "solid" : "outline"}
                      data-testid={`override-role-${r.toLowerCase()}`}
                      onClick={() => setRole(r)}
                    >
                      {ROLE_LABEL[r]}
                    </Button>
                  ))}
                </HStack>
              </Field.Root>
            ) : (
              <Field.Root>
                <SmallLabel>Feature</SmallLabel>
                <VStack align="stretch" gap={2}>
                  {featureOptions.map((f) => (
                    <Button
                      key={f.key}
                      size="sm"
                      variant={featureKey === f.key ? "solid" : "outline"}
                      data-testid={`override-feature-${f.key}`}
                      onClick={() => setFeatureKey(f.key)}
                      justifyContent="flex-start"
                    >
                      <HStack gap={2}>
                        <Badge colorPalette="purple" variant="subtle">
                          {ROLE_LABEL[f.role as ModelRoleKey]}
                        </Badge>
                        <Text fontSize="sm">{f.displayName}</Text>
                      </HStack>
                    </Button>
                  ))}
                </VStack>
              </Field.Root>
            )}

            <Field.Root>
              <SmallLabel>Model</SmallLabel>
              <ProviderModelSelector
                model={model}
                options={modelOptions}
                onChange={setModel}
              />
            </Field.Root>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full" justify="space-between">
            <Tooltip
              content="Removes every per-scope ModelDefault row in this rule"
              disabled={!canDelete}
            >
              <Button
                variant="ghost"
                colorPalette="red"
                size="sm"
                onClick={handleDelete}
                disabled={!canDelete}
                data-testid="override-delete"
              >
                Delete
              </Button>
            </Tooltip>
            <HStack gap={2}>
              <Button variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                colorPalette="orange"
                size="sm"
                onClick={handleSave}
                disabled={!canSave}
                loading={saving}
                data-testid="override-save"
              >
                {editing ? "Save changes" : "Add override"}
              </Button>
            </HStack>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
