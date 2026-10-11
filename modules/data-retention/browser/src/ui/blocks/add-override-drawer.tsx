import {
  ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS,
  INDEFINITE_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  RETENTION_WEEK_DAYS,
  type ScopeAssignment,
} from "@langwatch/data-retention-contract";
import { Card } from "@langwatch/design-system/card";
import { Drawer } from "@langwatch/design-system/drawer";
import {
  Badge,
  Box,
  createListCollection,
  Field,
  HStack,
  Input,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";
import { Switch } from "@langwatch/design-system/switch";
import { type Ref, type RefObject, useEffect, useMemo, useRef, useState } from "react";

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
} from "../../model/retention-constants.ts";

/** A row the overflow menu's Edit action targets: a single scope's policy,
 *  prefilled into the drawer with the scope locked. */
export type RetentionEditTarget = {
  scope: ScopeAssignment;
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
  const isCustomEligible =
    isEnterprise &&
    days >= ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS &&
    days % RETENTION_WEEK_DAYS === 0;
  if (isCustomEligible) {
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
  currentProjectId,
  isPlatformAdmin,
  isEnterprise,
  isSaving,
  onSave,
  editTarget,
  scopePicker,
}: {
  open: boolean;
  onClose: () => void;
  available: { projects: { id: string }[] };
  currentProjectId: string;
  isPlatformAdmin: boolean;
  /** True for enterprise (and self-hosted, which resolves to enterprise). Paid
   *  non-enterprise orgs get the fixed short menu with no custom field. */
  isEnterprise: boolean;
  isSaving: boolean;
  onSave: (params: {
    scopes: ScopeAssignment[];
    retentionDays: number;
    applyToExisting: boolean;
  }) => void;
  /** When set, the drawer edits this existing policy: the scope is locked and
   *  shown read-only, and the retention is prefilled. Absent = add mode. */
  editTarget?: RetentionEditTarget | null;
  /** Renders the scope picker in Add mode. A named render port rather than a
   *  direct dependency: scope selection is a shared app concern (organization
   *  / team / project data, not owned by this feature), so the caller supplies
   *  its own picker wired to `value`/`onChange`. */
  scopePicker: (props: {
    value: ScopeAssignment[];
    onChange: (value: ScopeAssignment[]) => void;
  }) => React.ReactNode;
}) {
  // The retention menu is plan-gated: paid orgs get a fixed short pair, while
  // enterprise/self-hosted get the full list plus a custom field.
  const presets = useMemo(() => retentionPresetsForTier(isEnterprise), [isEnterprise]);
  const defaultPreset = presets[0]?.value ?? CUSTOM_PRESET_VALUE;

  const [scopes, setScopes] = useState<ScopeAssignment[]>([]);
  const [preset, setPreset] = useState<string>(defaultPreset);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [customUnit, setCustomUnit] = useState<RetentionUnit>("weeks");
  // Default OFF: a new/edited policy applies to future ingestion only unless the
  // user explicitly opts in. Applying to existing data triggers a ClickHouse
  // ALTER … UPDATE rewrite across all of the scope's parts — an expensive,
  // hard-to-undo operation — so it must be a deliberate choice, not the default.
  const [applyToExisting, setApplyToExisting] = useState<boolean>(false);
  const [attempted, setAttempted] = useState(false);

  const isEditing = !!editTarget;

  // When editing a policy whose stored value the current plan can't offer
  // (a grandfathered paid value, or indefinite for a non-admin), surface it as
  // a read-only legacy option so the user sees the truth and isn't forced to
  // coerce it. Absent from Add mode — new policies only pick allowed values.
  const legacyDays = legacyRetentionDays({ editTarget, presets, isEnterprise, isPlatformAdmin });

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
    setAttempted(false);
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
    // Reinit when drawer opens, edit target changes, or plan/admin flags settle.
    // Exclude currentProjectId and available.projects to avoid wiping edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editTarget, isEnterprise, isPlatformAdmin]);

  const resolvedDays = resolveRetentionDays({ preset, customAmount, customUnit });
  const daysValid = isRetentionDaysValid({ preset, resolvedDays });

  // Create/Save stays clickable; an attempt with a problem shows it and focuses it.
  const scopeRef = useRef<HTMLDivElement>(null);
  const presetRef = useRef<HTMLButtonElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const noScope = scopes.length === 0;
  const daysProblem = daysValid ? null : retentionProblem({ preset });

  const trySave = () => {
    if (isSaving) return;
    if (noScope || !daysValid) {
      setAttempted(true);
      focusFirstProblem({ noScope, preset, refs: { scopeRef, amountRef, presetRef } });
      return;
    }
    onSave({ scopes, retentionDays: resolvedDays, applyToExisting });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEditing ? "Edit retention policy" : "Add retention policy"}
      size="md"
      footer={{
        // Edit drawers reached from a row overflow menu carry only the primary
        // action; the X cancels (row-actions-overflow-menu.md). Add keeps Cancel.
        cancel: isEditing ? undefined : { onClick: onClose },
        primaryAction: {
          label: isEditing ? "Save changes" : "Create",
          onClick: trySave,
          loading: isSaving,
        },
        busy: isSaving,
      }}
    >
      <VStack gap={5} align="stretch">
        <VStack gap={1.5} align="start" width="full">
          <Text fontWeight="600" fontSize="sm">
            Scope
          </Text>
          {isEditing && editTarget ? (
            // Scope is fixed when editing — changing it would mean deleting
            // this rule and creating another, which is what "Add" is for.
            <ScopeReadout scopeType={editTarget.scope.scopeType} name={editTarget.scopeName} />
          ) : (
            <Box ref={scopeRef} tabIndex={-1} outline="none" width="full">
              {scopePicker({ value: scopes, onChange: setScopes })}
              {attempted && noScope && (
                <Text role="alert" fontSize="xs" color="fg.error" marginTop={1.5}>
                  Pick at least one scope.
                </Text>
              )}
            </Box>
          )}
        </VStack>

        <Field.Root invalid={attempted && daysProblem !== null}>
          <Field.Label>Retention</Field.Label>
          <Select.Root
            collection={presetCollection}
            value={[preset]}
            onValueChange={(details) => {
              const v = details.value[0];
              if (v) setPreset(v);
            }}
          >
            <Select.Trigger ref={presetRef} background="bg">
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
            <CustomRetentionField
              amount={customAmount}
              unit={customUnit}
              inputRef={amountRef}
              onAmountChange={setCustomAmount}
              onUnitChange={setCustomUnit}
            />
          )}
          {attempted && daysProblem !== null ? (
            <Field.ErrorText>{daysProblem}</Field.ErrorText>
          ) : (
            <Field.HelperText>
              {retentionHelperText({
                preset,
                customAmount,
                daysValid,
                resolvedDays,
                isEnterprise,
              })}
            </Field.HelperText>
          )}
        </Field.Root>

        <HStack gap={3} align="start">
          <Switch
            checked={applyToExisting}
            onCheckedChange={({ checked }) => setApplyToExisting(checked === true)}
          />
          <VStack align="start" gap={0}>
            <Text fontWeight="600" fontSize="sm">
              Apply this change to existing data
            </Text>
            <Text fontSize="xs" color="fg.muted">
              Rewrites this project's existing rows so the new retention takes effect immediately,
              not just for new ingestion.
            </Text>
          </VStack>
        </HStack>
      </VStack>
    </Drawer>
  );
}

/** The stored value an edited policy keeps when the plan can no longer offer it. */
function legacyRetentionDays({
  editTarget,
  presets,
  isEnterprise,
  isPlatformAdmin,
}: {
  editTarget: RetentionEditTarget | null | undefined;
  presets: RetentionPreset[];
  isEnterprise: boolean;
  isPlatformAdmin: boolean;
}): number | null {
  if (!editTarget) return null;
  const { preset } = initialRetentionState({
    days: editTarget.retentionDays,
    presets,
    isEnterprise,
    isPlatformAdmin,
  });
  return preset === LEGACY_PRESET_VALUE ? editTarget.retentionDays : null;
}

/** The day count the controls describe; NaN where they describe none. */
function resolveRetentionDays({
  preset,
  customAmount,
  customUnit,
}: {
  preset: string;
  customAmount: string;
  customUnit: RetentionUnit;
}): number {
  // The legacy option is read-only: it can't be saved, only replaced by
  // picking a real option, so it resolves to no valid value.
  if (preset === LEGACY_PRESET_VALUE) return NaN;
  if (preset !== CUSTOM_PRESET_VALUE) return Number(preset);
  const n = Number(customAmount);
  if (!Number.isInteger(n) || n <= 0) return NaN;
  return n * DAYS_PER_UNIT[customUnit];
}

/**
 * Indefinite (0) is only reachable via the admin-only preset, and a curated preset is
 * pre-vetted, so neither needs a range check. Only the custom field
 * (enterprise/self-hosted) needs the floor, the ceiling and week alignment.
 */
function isRetentionDaysValid({
  preset,
  resolvedDays,
}: {
  preset: string;
  resolvedDays: number;
}): boolean {
  if (resolvedDays === INDEFINITE_RETENTION_DAYS) return true;
  if (preset === LEGACY_PRESET_VALUE) return false;
  if (preset !== CUSTOM_PRESET_VALUE) return true;
  return (
    Number.isInteger(resolvedDays) &&
    resolvedDays >= ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS &&
    resolvedDays <= MAX_RETENTION_DAYS &&
    resolvedDays % RETENTION_WEEK_DAYS === 0
  );
}

/** Moves focus to the first control that stopped the save, in visual order. */
function focusFirstProblem({
  noScope,
  preset,
  refs,
}: {
  noScope: boolean;
  preset: string;
  refs: {
    scopeRef: RefObject<HTMLElement | null>;
    amountRef: RefObject<HTMLElement | null>;
    presetRef: RefObject<HTMLElement | null>;
  };
}): void {
  if (noScope) refs.scopeRef.current?.focus();
  else if (preset === CUSTOM_PRESET_VALUE) refs.amountRef.current?.focus();
  else refs.presetRef.current?.focus();
}

const LEGACY_NOTE =
  "This length isn't available on your plan. Pick an option above to change it; leaving it keeps the current value.";
const CUSTOM_RANGE_NOTE = `Must be between ${ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS} days, in whole weeks.`;

/** What is wrong with the chosen length: only the legacy option and a custom value can fail. */
function retentionProblem({ preset }: { preset: string }): string {
  return preset === LEGACY_PRESET_VALUE ? LEGACY_NOTE : CUSTOM_RANGE_NOTE;
}

/** The custom length: a whole number and its unit. */
function CustomRetentionField({
  amount,
  unit,
  inputRef,
  onAmountChange,
  onUnitChange,
}: {
  amount: string;
  unit: RetentionUnit;
  inputRef: Ref<HTMLInputElement>;
  onAmountChange: (amount: string) => void;
  onUnitChange: (unit: RetentionUnit) => void;
}) {
  return (
    <HStack gap={2} marginTop={2} align="start">
      <Input
        ref={inputRef}
        type="number"
        min={1}
        value={amount}
        onChange={(e) => onAmountChange(e.target.value)}
        width="120px"
        placeholder="e.g. 8"
      />
      <Select.Root
        collection={retentionUnitCollection}
        value={[unit]}
        onValueChange={(details) => {
          const picked = retentionUnitCollection.items.find(
            (item) => item.value === details.value[0],
          );
          if (picked) onUnitChange(picked.value);
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
  );
}

/** Read-only display of a locked scope in the edit drawer: the scope's tier
 *  icon, name, and a tier badge, matching the policy table's row layout. */
function retentionHelperText({
  preset,
  customAmount,
  daysValid,
  resolvedDays,
  isEnterprise,
}: {
  preset: string;
  customAmount: string;
  daysValid: boolean;
  resolvedDays: number;
  isEnterprise: boolean;
}): string {
  if (preset === INDEFINITE_PRESET_VALUE) {
    return "Data will be kept indefinitely (exempt from automatic deletion).";
  }
  if (preset === LEGACY_PRESET_VALUE) return LEGACY_NOTE;
  if (preset === CUSTOM_PRESET_VALUE && customAmount && daysValid) {
    return `Stored as ${resolvedDays} days.`;
  }
  if (preset === CUSTOM_PRESET_VALUE && customAmount && !daysValid) return CUSTOM_RANGE_NOTE;
  if (isEnterprise) {
    return `Custom values start at ${ENTERPRISE_CUSTOM_MIN_RETENTION_DAYS} days (7 weeks) and round to whole weeks.`;
  }
  return "Retention length is set by your plan.";
}

function ScopeReadout({
  scopeType,
  name,
}: {
  scopeType: ScopeAssignment["scopeType"];
  name: string;
}) {
  const Icon = SCOPE_ICON[scopeType];
  return (
    <Card variant="nested" tone="neutral" padding="sm">
      <HStack gap={2} width="full">
        <Icon size={14} />
        <Text>{name}</Text>
        <Badge size="sm" colorPalette="gray">
          {scopeType.toLowerCase()}
        </Badge>
      </HStack>
    </Card>
  );
}
