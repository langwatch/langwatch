import {
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
  retentionUnitCollection,
  type RetentionUnit,
} from "./constants";

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
  onSave: (
    scopes: ScopeTriadEntry[],
    retentionDays: number,
    applyToExisting: boolean,
  ) => void;
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

  useEffect(() => {
    if (open) {
      // Default to the current project so the picker opens on the user's
      // working scope, mirroring the API-key drawer pattern.
      setScopes(
        available.projects.some((p) => p.id === currentProjectId)
          ? [{ scopeType: "PROJECT", scopeId: currentProjectId }]
          : [],
      );
      setPreset(String(DEFAULT_RETENTION_DAYS));
      setCustomAmount("");
      setCustomUnit("weeks");
      setApplyToExisting(true);
    }
  }, [open, currentProjectId, available.projects]);

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
          <Heading size="md">Add retention policy</Heading>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack gap={5} align="stretch">
            <VStack gap={1.5} align="start" width="full">
              <Text fontWeight="600" fontSize="sm">
                Scope
              </Text>
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
            <Button variant="outline" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              disabled={!canSave}
              loading={isSaving}
              onClick={() => onSave(scopes, resolvedDays, applyToExisting)}
            >
              Create
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
