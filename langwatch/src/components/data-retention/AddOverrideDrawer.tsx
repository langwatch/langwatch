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
  DEFAULT_RETENTION_DAYS,
  INDEFINITE_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  RETENTION_WEEK_DAYS,
} from "~/server/data-retention/retentionPolicy.schema";
import {
  CUSTOM_PRESET_VALUE,
  DAYS_PER_UNIT,
  INDEFINITE_PRESET_VALUE,
  RETENTION_PRESETS,
  type RetentionUnit,
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

/** Map a stored day count back onto the drawer's preset/custom controls. Stored
 *  values are always week-aligned, so the custom fallback round-trips through
 *  whole weeks cleanly; the indefinite sentinel maps to its admin-only preset. */
function initialRetentionState(days: number): {
  preset: string;
  amount: string;
  unit: RetentionUnit;
} {
  if (days === INDEFINITE_RETENTION_DAYS) {
    return { preset: INDEFINITE_PRESET_VALUE, amount: "", unit: "weeks" };
  }
  const match = RETENTION_PRESETS.find((p) => p.days === days);
  if (match) return { preset: match.value, amount: "", unit: "weeks" };
  return {
    preset: CUSTOM_PRESET_VALUE,
    amount: String(days / RETENTION_WEEK_DAYS),
    unit: "weeks",
  };
}

export function AddOverrideDrawer({
  open,
  onClose,
  available,
  currentOrganizationId,
  currentTeamId,
  currentProjectId,
  isPlatformAdmin,
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
  const [scopes, setScopes] = useState<ScopeTriadEntry[]>([]);
  const [preset, setPreset] = useState<string>(String(DEFAULT_RETENTION_DAYS));
  const [customAmount, setCustomAmount] = useState<string>("");
  const [customUnit, setCustomUnit] = useState<RetentionUnit>("weeks");
  const [applyToExisting, setApplyToExisting] = useState<boolean>(true);

  // Platform admins get an extra "No retention (keep forever)" option. The 0
  // sentinel is structurally valid input; the route authorizes it admin-only.
  const presetCollection = useMemo(
    () =>
      createListCollection({
        items: [
          ...RETENTION_PRESETS.map((p) => ({ value: p.value, label: p.label })),
          ...(isPlatformAdmin
            ? [
                {
                  value: INDEFINITE_PRESET_VALUE,
                  label: "No retention (keep forever)",
                },
              ]
            : []),
          { value: CUSTOM_PRESET_VALUE, label: "Custom…" },
        ],
      }),
    [isPlatformAdmin],
  );

  const isEditing = !!editTarget;

  useEffect(() => {
    if (!open) return;
    if (editTarget) {
      // Edit mode: lock to the policy's scope and prefill its current value.
      setScopes([editTarget.scope]);
      const init = initialRetentionState(editTarget.retentionDays);
      setPreset(init.preset);
      setCustomAmount(init.amount);
      setCustomUnit(init.unit);
      setApplyToExisting(true);
      return;
    }
    // Add mode: default to the current project so the picker opens on the
    // user's working scope, mirroring the API-key drawer pattern.
    setScopes(
      available.projects.some((p) => p.id === currentProjectId)
        ? [{ scopeType: "PROJECT", scopeId: currentProjectId }]
        : [],
    );
    setPreset(String(DEFAULT_RETENTION_DAYS));
    setCustomAmount("");
    setCustomUnit("weeks");
    setApplyToExisting(true);
    // Initialize only when the drawer opens or the edit target changes — NOT on
    // currentProjectId / available.projects reference churn (a background
    // snapshot refetch would otherwise re-run this and wipe in-progress edits).
    // The latest scope inputs are read inside, so the next open re-reads them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editTarget]);

  const resolvedDays = (() => {
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
    (Number.isFinite(resolvedDays) &&
      Number.isInteger(resolvedDays) &&
      resolvedDays >= MIN_RETENTION_DAYS &&
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
                  : preset === CUSTOM_PRESET_VALUE && customAmount && daysValid
                    ? `Stored as ${resolvedDays} days.`
                    : preset === CUSTOM_PRESET_VALUE &&
                        customAmount &&
                        !daysValid
                      ? `Must be between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS} days.`
                      : `Minimum ${MIN_RETENTION_DAYS} days (7 weeks). Retention is partition-aligned and rounded to whole weeks under the hood.`}
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
