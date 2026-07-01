import {
  Badge,
  Button,
  createListCollection,
  Field,
  Heading,
  HStack,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import {
  ScopeChipPicker,
  type ScopeTriadEntry,
} from "~/components/settings/ScopeChipPicker";
import { Drawer } from "~/components/ui/drawer";
import { Select } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import {
  ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS,
  INDEFINITE_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  RETENTION_WEEK_DAYS,
} from "~/server/data-retention/retentionPolicy.schema";
import {
  buildRetentionMenuItems,
  CUSTOM_PRESET_VALUE,
  DAYS_PER_UNIT,
  INDEFINITE_PRESET_VALUE,
  LEGACY_PRESET_VALUE,
  type RetentionPreset,
  type RetentionUnit,
  retentionPresetsForTier,
  retentionUnitCollection,
  SCOPE_ICON,
} from "./constants";

/** A row the overflow menu's Edit action targets: a single scope's policy,
 *  prefilled into the drawer with the scope locked. */
export type RetentionEditTarget = {
  scope: ScopeTriadEntry;
  scopeName: string;
  retentionDays: number;
};

/** Map a stored day count back onto the drawer's controls, given what the
 *  org's plan can represent. Stored values are always week-aligned, so the
 *  custom fallback round-trips through whole weeks cleanly. A value the current
 *  plan can't offer (a grandfathered high paid value, or indefinite for a
 *  non-admin) maps to the read-only legacy option rather than being coerced. */
function initialRetentionState({
  days,
  presets,
  isEnterprise,
  isPlatformAdmin,
}: {
  days: number;
  presets: RetentionPreset[];
  isEnterprise: boolean;
  isPlatformAdmin: boolean;
}): {
  preset: string;
  amount: string;
  unit: RetentionUnit;
} {
  if (days === INDEFINITE_RETENTION_DAYS) {
    return isPlatformAdmin
      ? { preset: INDEFINITE_PRESET_VALUE, amount: "", unit: "weeks" }
      : { preset: LEGACY_PRESET_VALUE, amount: "", unit: "weeks" };
  }
  const match = presets.find((p) => p.days === days);
  if (match) return { preset: match.value, amount: "", unit: "weeks" };
  // Only enterprise/self-hosted has a custom field, and only for values that
  // clear its floor and align to whole weeks. Anything else is grandfathered.
  const customEligible =
    isEnterprise &&
    days >= ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS &&
    days % RETENTION_WEEK_DAYS === 0;
  if (customEligible) {
    return {
      preset: CUSTOM_PRESET_VALUE,
      amount: String(days / RETENTION_WEEK_DAYS),
      unit: "weeks",
    };
  }
  return { preset: LEGACY_PRESET_VALUE, amount: "", unit: "weeks" };
}

export function AddOverrideDrawer({
  open,
  onClose,
  available,
  currentOrganizationId,
  currentTeamId,
  currentProjectId,
  isPlatformAdmin,
  isEnterprise,
  isSaving,
  onSave,
  editTarget,
}: {
  open: boolean;
  onClose: () => void;
  available: {
    organization: { id: string; name: string } | null;
    teams: { id: string; name: string }[];
    projects: { id: string; name: string; teamId: string }[];
  };
  currentOrganizationId: string | undefined;
  currentTeamId: string | undefined;
  currentProjectId: string;
  isPlatformAdmin: boolean;
  /** True for enterprise (and self-hosted, which resolves to enterprise). Paid
   *  non-enterprise orgs get the fixed short menu with no custom field. */
  isEnterprise: boolean;
  isSaving: boolean;
  onSave: (params: {
    scopes: ScopeTriadEntry[];
    retentionDays: number;
    applyToExisting: boolean;
  }) => void;
  /** When set, the drawer edits this existing policy: the scope is locked and
   *  shown read-only, and the retention is prefilled. Absent = add mode. */
  editTarget?: RetentionEditTarget | null;
}) {
  // The retention menu is plan-gated: paid orgs get a fixed short pair, while
  // enterprise/self-hosted get the full list plus a custom field.
  const presets = useMemo(
    () => retentionPresetsForTier(isEnterprise),
    [isEnterprise],
  );
  const defaultPreset = presets[0]?.value ?? CUSTOM_PRESET_VALUE;

  const [scopes, setScopes] = useState<ScopeTriadEntry[]>([]);
  const [preset, setPreset] = useState<string>(defaultPreset);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [customUnit, setCustomUnit] = useState<RetentionUnit>("weeks");
  // Default OFF: a new/edited policy applies to future ingestion only unless the
  // user explicitly opts in. Applying to existing data triggers a ClickHouse
  // ALTER … UPDATE rewrite across all of the scope's parts — an expensive,
  // hard-to-undo operation — so it must be a deliberate choice, not the default.
  const [applyToExisting, setApplyToExisting] = useState<boolean>(false);

  const isEditing = !!editTarget;

  // When editing a policy whose stored value the current plan can't offer
  // (a grandfathered paid value, or indefinite for a non-admin), surface it as
  // a read-only legacy option so the user sees the truth and isn't forced to
  // coerce it. Absent from Add mode — new policies only pick allowed values.
  const legacyDays =
    isEditing &&
    editTarget &&
    initialRetentionState({
      days: editTarget.retentionDays,
      presets,
      isEnterprise,
      isPlatformAdmin,
    }).preset === LEGACY_PRESET_VALUE
      ? editTarget.retentionDays
      : null;

  // Menu = [legacy?] + plan presets + [keep-forever (admin)] + [custom
  // (enterprise/self-hosted only)]. Paid orgs get neither custom nor
  // keep-forever, so their entire menu is the fixed short pair. Built by a pure
  // helper (unit-tested) so the plan gating doesn't depend on rendering.
  const presetCollection = useMemo(
    () =>
      createListCollection({
        items: buildRetentionMenuItems({
          isEnterprise,
          isPlatformAdmin,
          legacyDays,
        }),
      }),
    [isEnterprise, isPlatformAdmin, legacyDays],
  );

  useEffect(() => {
    if (!open) return;
    if (editTarget) {
      // Edit mode: lock to the policy's scope and prefill its current value.
      setScopes([editTarget.scope]);
      const init = initialRetentionState({
        days: editTarget.retentionDays,
        presets,
        isEnterprise,
        isPlatformAdmin,
      });
      setPreset(init.preset);
      setCustomAmount(init.amount);
      setCustomUnit(init.unit);
      setApplyToExisting(false);
      return;
    }
    // Add mode: default to the current project so the picker opens on the
    // user's working scope, mirroring the API-key drawer pattern.
    setScopes(
      available.projects.some((p) => p.id === currentProjectId)
        ? [{ scopeType: "PROJECT", scopeId: currentProjectId }]
        : [],
    );
    setPreset(defaultPreset);
    setCustomAmount("");
    setCustomUnit("weeks");
    setApplyToExisting(false);
    // Initialize when the drawer opens, the edit target changes, or the plan
    // tier resolves. `isEnterprise` starts false while `useActivePlan` loads and
    // flips once when it settles; without it here, opening the drawer on a cold
    // plan load would strand an enterprise value in the read-only "legacy" state
    // (paid can't represent it). It's a stable boolean, so it re-inits at most
    // once. Deliberately NOT keyed on currentProjectId / available.projects
    // reference churn — a background snapshot refetch would wipe in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editTarget, isEnterprise]);

  const resolvedDays = (() => {
    // The legacy option is read-only: it can't be saved, only replaced by
    // picking a real option, so it resolves to no valid value.
    if (preset === LEGACY_PRESET_VALUE) return NaN;
    if (preset === CUSTOM_PRESET_VALUE) {
      const n = Number(customAmount);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return NaN;
      return n * DAYS_PER_UNIT[customUnit];
    }
    return Number(preset);
  })();

  const daysValid =
    // Indefinite (0) is only reachable via the admin-only preset; the route
    // re-checks the capability, so the UI just needs to treat it as valid.
    resolvedDays === INDEFINITE_RETENTION_DAYS ||
    // Any curated preset (the plan menu) is a pre-vetted allowed value — no
    // range check needed; that's the point of the fixed menu. Only the custom
    // field (enterprise/self-hosted) needs the ≥49 floor + week alignment.
    (preset !== CUSTOM_PRESET_VALUE && preset !== LEGACY_PRESET_VALUE) ||
    (preset === CUSTOM_PRESET_VALUE &&
      Number.isFinite(resolvedDays) &&
      Number.isInteger(resolvedDays) &&
      resolvedDays >= ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS &&
      resolvedDays <= MAX_RETENTION_DAYS &&
      resolvedDays % RETENTION_WEEK_DAYS === 0);

  const canSave = scopes.length > 0 && daysValid && !isSaving;

  return (
    <Drawer.Root
      placement="end"
      size="md"
      open={open}
      onOpenChange={({ open: isOpen }) => {
        if (!isOpen) onClose();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Heading size="md">
            {isEditing ? "Edit retention policy" : "Add retention policy"}
          </Heading>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack gap={5} align="stretch">
            <VStack gap={1.5} align="start" width="full">
              <Text fontWeight="600" fontSize="sm">
                Scope
              </Text>
              {isEditing && editTarget ? (
                // Scope is fixed when editing — changing it would mean deleting
                // this rule and creating another, which is what "Add" is for.
                <ScopeReadout
                  scopeType={editTarget.scope.scopeType}
                  name={editTarget.scopeName}
                />
              ) : (
                <ScopeChipPicker
                  value={scopes}
                  onChange={setScopes}
                  organizationId={available.organization?.id}
                  organizationName={available.organization?.name}
                  availableTeams={available.teams}
                  availableProjects={available.projects}
                  label=""
                  currentOrganizationId={
                    available.organization ? currentOrganizationId : undefined
                  }
                  currentTeamId={currentTeamId}
                  currentProjectId={currentProjectId}
                />
              )}
            </VStack>

            <Field.Root>
              <Field.Label>Retention</Field.Label>
              <Select.Root
                collection={presetCollection}
                value={[preset]}
                onValueChange={(details) => {
                  const v = details.value[0];
                  if (v) setPreset(v);
                }}
              >
                <Select.Trigger background="bg">
                  <Select.ValueText placeholder="Pick a retention" />
                </Select.Trigger>
                <Select.Content>
                  {presetCollection.items.map((item) => (
                    <Select.Item key={item.value} item={item}>
                      {item.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              {preset === CUSTOM_PRESET_VALUE && (
                <HStack gap={2} marginTop={2} align="start">
                  <Input
                    type="number"
                    min={1}
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    width="120px"
                    placeholder="e.g. 8"
                  />
                  <Select.Root
                    collection={retentionUnitCollection}
                    value={[customUnit]}
                    onValueChange={(details) => {
                      const v = details.value[0] as RetentionUnit | undefined;
                      if (v) setCustomUnit(v);
                    }}
                  >
                    <Select.Trigger background="bg" width="140px">
                      <Select.ValueText />
                    </Select.Trigger>
                    <Select.Content>
                      {retentionUnitCollection.items.map((item) => (
                        <Select.Item key={item.value} item={item}>
                          {item.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </HStack>
              )}
              <Field.HelperText>
                {preset === INDEFINITE_PRESET_VALUE
                  ? "Data will be kept indefinitely — exempt from automatic deletion."
                  : preset === LEGACY_PRESET_VALUE
                    ? "This length isn't available on your plan. Pick an option above to change it — leaving it keeps the current value."
                    : preset === CUSTOM_PRESET_VALUE &&
                        customAmount &&
                        daysValid
                      ? `Stored as ${resolvedDays} days.`
                      : preset === CUSTOM_PRESET_VALUE &&
                          customAmount &&
                          !daysValid
                        ? `Must be between ${ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS} days, in whole weeks.`
                        : isEnterprise
                          ? `Custom values start at ${ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS} days (7 weeks) and round to whole weeks.`
                          : "Retention length is set by your plan."}
              </Field.HelperText>
            </Field.Root>

            <HStack gap={3} align="start">
              <Switch
                checked={applyToExisting}
                onCheckedChange={({ checked }) =>
                  setApplyToExisting(checked === true)
                }
              />
              <VStack align="start" gap={0}>
                <Text fontWeight="600" fontSize="sm">
                  Apply this change to existing data
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  Rewrites this project's existing rows so the new retention
                  takes effect immediately, not just for new ingestion.
                </Text>
              </VStack>
            </HStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full" justify="end" gap={2}>
            {/* Edit drawers reached from a row overflow menu carry only the
                primary action — the header X cancels (row-actions-overflow-menu.md).
                The Add drawer keeps an explicit Cancel for its create flow. */}
            {!isEditing && (
              <Button variant="outline" onClick={onClose} disabled={isSaving}>
                Cancel
              </Button>
            )}
            <Button
              colorPalette="blue"
              disabled={!canSave}
              loading={isSaving}
              onClick={() =>
                onSave({ scopes, retentionDays: resolvedDays, applyToExisting })
              }
            >
              {isEditing ? "Save changes" : "Create"}
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

/** Read-only display of a locked scope in the edit drawer: the scope's tier
 *  icon, name, and a tier badge, matching the policy table's row layout. */
function ScopeReadout({
  scopeType,
  name,
}: {
  scopeType: ScopeTriadEntry["scopeType"];
  name: string;
}) {
  const Icon = SCOPE_ICON[scopeType];
  return (
    <HStack
      gap={2}
      width="full"
      paddingX={3}
      paddingY={2}
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      background="bg.subtle"
    >
      <Icon size={14} />
      <Text>{name}</Text>
      <Badge size="sm" colorPalette="gray">
        {scopeType.toLowerCase()}
      </Badge>
    </HStack>
  );
}
