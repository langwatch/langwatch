import {
  Badge,
  Box,
  Button,
  Field,
  Heading,
  HStack,
  Input,
  Stack,
  Table,
  Text,
  VStack,
  VisuallyHidden,
} from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { Switch } from "@langwatch/design-system/switch";
import type {
  FeatureFlagRule,
  FeatureFlagRules,
  OperatorFeatureFlag,
  OperatorFeatureFlagCatalogue,
} from "@langwatch/feature-flag-contract";
import { useEffect, useMemo, useRef, useState } from "react";

export interface OperatorFeatureFlagCatalogueProps {
  /** True on a shared (multi-tenant) install, where a PRODUCT flag reaches every customer. */
  sharedInstall?: boolean;
  catalogue: OperatorFeatureFlagCatalogue;
  canManage: boolean;
  pendingKey?: string;
  onSetEnabled: (input: { key: string; enabled: boolean }) => Promise<void>;
  onClear: (input: { key: string }) => Promise<void>;
  onSetRules: (input: { key: string; rules: FeatureFlagRules }) => Promise<void>;
}

export interface FeatureFlagRuleEditorRule {
  organizationId: string;
  projectId: string;
  percentage: string;
  /**
   * "New organizations": an ISO date, and every organization created on or
   * after it matches. An operator rolling out to new signups cannot write the
   * ids of organizations that do not exist yet, so the rule names one date
   * instead and every later signup matches it without another edit.
   */
  organizationCreatedAfter: string;
  enabled: boolean;
  preservedMatch: FeatureFlagRule["match"];
}

export function rulesToEditor(rules: FeatureFlagRules): FeatureFlagRuleEditorRule[] {
  if (rules.length === 0) {
    return [newEditorRule()];
  }

  return rules.map((rule) => ({
    organizationId: rule.match.organizationId ?? "",
    projectId: rule.match.projectId ?? "",
    percentage: rule.match.percentage?.toString() ?? "",
    organizationCreatedAfter: rule.match.organizationCreatedAfter ?? "",
    enabled: rule.enabled,
    preservedMatch: { ...rule.match },
  }));
}

export function editorToRules(rules: FeatureFlagRuleEditorRule[]): FeatureFlagRules {
  return rules.map((rule) => {
    const match = { ...rule.preservedMatch };
    delete match.organizationId;
    delete match.projectId;
    delete match.percentage;
    delete match.organizationCreatedAfter;

    const organizationId = rule.organizationId.trim();
    const projectId = rule.projectId.trim();
    const percentage = rule.percentage.trim();
    const organizationCreatedAfter = rule.organizationCreatedAfter.trim();
    if (organizationId) match.organizationId = organizationId;
    if (projectId) match.projectId = projectId;
    if (percentage) match.percentage = Number(percentage);
    if (organizationCreatedAfter) match.organizationCreatedAfter = organizationCreatedAfter;

    return { match, enabled: rule.enabled };
  });
}

export function OperatorFeatureFlagCatalogueView({
  catalogue,
  canManage,
  pendingKey,
  sharedInstall,
  onSetEnabled,
  onClear,
  onSetRules,
}: OperatorFeatureFlagCatalogueProps) {
  const grouped = useMemo(() => groupByScope(catalogue.flags), [catalogue.flags]);

  return (
    <Stack gap={8} paddingY={4} maxWidth="1200px">
      <Text fontSize="sm" color="fg.muted">
        Flags resolve from their validated boot override, force-enable list, matching operator rule
        or row, then registry default. Operator changes reach every process through the bounded
        shared cache.
      </Text>

      <ScopeSection
        heading="System"
        description="Backend kill switches and pipeline toggles. Resolved from the env override first, then this postgres store, then the registry default."
        rows={grouped.system}
        sharedInstall={sharedInstall}
        canManage={canManage}
        pendingKey={pendingKey}
        onSetEnabled={onSetEnabled}
        onClear={onClear}
        onSetRules={onSetRules}
      />
      <ScopeSection
        heading="Product"
        description="Browser-visible product rollouts and experiments. Customers get the value set here when no targeting rule matches it first and no env override is set."
        rows={grouped.product}
        sharedInstall={sharedInstall}
        canManage={canManage}
        pendingKey={pendingKey}
        onSetEnabled={onSetEnabled}
        onClear={onClear}
        onSetRules={onSetRules}
      />

      {catalogue.families.length > 0 && (
        <Box>
          <Heading size="sm" marginBottom={2}>
            Flag families
          </Heading>
          <Text fontSize="xs" color="fg.muted" marginBottom={3}>
            Dynamically named flags sharing a prefix. Instances appear above after an operator row
            is written.
          </Text>
          <Table.Root size="sm" variant="line">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Prefix</Table.ColumnHeader>
                <Table.ColumnHeader>Scope</Table.ColumnHeader>
                <Table.ColumnHeader>Default</Table.ColumnHeader>
                <Table.ColumnHeader>Description</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {catalogue.families.map((family) => (
                <Table.Row key={family.keyPrefix}>
                  <Table.Cell>
                    <code>{family.keyPrefix}*</code>
                  </Table.Cell>
                  <Table.Cell>
                    <ScopeBadge scope={family.scope} />
                  </Table.Cell>
                  <Table.Cell>{family.defaultValue ? "on" : "off"}</Table.Cell>
                  <Table.Cell>{family.description}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
      )}
    </Stack>
  );
}

function ScopeSection({
  heading,
  description,
  rows,
  sharedInstall,
  canManage,
  pendingKey,
  onSetEnabled,
  onClear,
  onSetRules,
}: {
  heading: string;
  description: string;
  rows: OperatorFeatureFlag[];
  sharedInstall?: boolean;
  canManage: boolean;
  pendingKey: string | undefined;
  onSetEnabled: OperatorFeatureFlagCatalogueProps["onSetEnabled"];
  onClear: OperatorFeatureFlagCatalogueProps["onClear"];
  onSetRules: OperatorFeatureFlagCatalogueProps["onSetRules"];
}) {
  return (
    <Box>
      <Heading size="md" marginBottom={1}>
        {heading}
      </Heading>
      <Text fontSize="xs" color="fg.muted" marginBottom={3}>
        {description}
      </Text>
      {rows.length === 0 ? (
        <Text fontSize="sm" color="fg.muted" fontStyle="italic">
          No flags registered.
        </Text>
      ) : (
        <Table.Root size="sm" variant="line">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Flag</Table.ColumnHeader>
              <Table.ColumnHeader>Effective</Table.ColumnHeader>
              <Table.ColumnHeader>Source</Table.ColumnHeader>
              <Table.ColumnHeader>Default</Table.ColumnHeader>
              <Table.ColumnHeader>Last edit</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((row) => (
              <FlagRow
                sharedInstall={sharedInstall}
                key={row.key}
                row={row}
                canManage={canManage}
                pending={pendingKey === row.key}
                onSetEnabled={onSetEnabled}
                onClear={onClear}
                onSetRules={onSetRules}
              />
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </Box>
  );
}

function FlagRow({
  row,
  sharedInstall,
  canManage,
  pending,
  onSetEnabled,
  onClear,
  onSetRules,
}: {
  row: OperatorFeatureFlag;
  sharedInstall?: boolean;
  canManage: boolean;
  pending: boolean;
  onSetEnabled: OperatorFeatureFlagCatalogueProps["onSetEnabled"];
  onClear: OperatorFeatureFlagCatalogueProps["onClear"];
  onSetRules: OperatorFeatureFlagCatalogueProps["onSetRules"];
}) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const envLocked = row.envOverride !== null;
  const effective = optimistic ?? row.effective;
  const targeting = summarizeTargeting(row.rules, effective);

  const setEnabled = async (enabled: boolean) => {
    setOptimistic(enabled);
    try {
      await onSetEnabled({ key: row.key, enabled });
    } catch {
      return;
    } finally {
      setOptimistic(null);
    }
  };

  const clear = async () => {
    try {
      await onClear({ key: row.key });
    } catch {
      return;
    }
  };

  return (
    <Table.Row>
      <Table.Cell>
        <VStack align="start" gap={0}>
          <HStack gap={2}>
            <Text fontFamily="mono" fontSize="xs">
              {row.key}
            </Text>
            <ScopeBadge scope={row.scope} />
            {row.scope === "PRODUCT" && sharedInstall && (
              <Badge colorPalette="red" size="sm" variant="subtle">
                All customers
                <VisuallyHidden>
                  Enabling this reaches the whole fleet when no targeting rule matches it first;
                  scope the change with a per-organization or per-project rule instead.
                </VisuallyHidden>
              </Badge>
            )}
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            {row.description}
          </Text>
        </VStack>
      </Table.Cell>
      <Table.Cell>
        <VStack align="start" gap={1}>
          <HStack gap={2}>
            <Switch
              checked={effective || targeting.partialEnabled}
              disabled={!canManage || envLocked || pending}
              onCheckedChange={(details) => void setEnabled(details.checked)}
            />
            {canManage && !envLocked && (
              <Button size="xs" variant="ghost" onClick={() => setRulesOpen(true)}>
                Target ({row.rules.length})
              </Button>
            )}
            {envLocked && (
              <Badge colorPalette="orange" size="sm" variant="subtle">
                env override
              </Badge>
            )}
          </HStack>
          {targeting.label && (
            <Text fontSize="xs" color="fg.muted">
              {targeting.label}
            </Text>
          )}
        </VStack>
        <FeatureFlagRulesDialog
          open={rulesOpen}
          onOpenChange={setRulesOpen}
          flagKey={row.key}
          initialRules={row.rules}
          onSave={onSetRules}
        />
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="xs">{sourceFor(row)}</Text>
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="xs">{row.defaultValue ? "on" : "off"}</Text>
      </Table.Cell>
      <Table.Cell>
        {row.storedValue === null ? (
          <Text fontSize="xs" color="fg.muted">
            never
          </Text>
        ) : (
          <VStack align="start" gap={0}>
            <Text fontSize="xs">{row.updatedAt?.toLocaleString() ?? ""}</Text>
            <HStack gap={2}>
              <Text fontSize="xs" color="fg.muted">
                {row.lastEditedBy ?? "unknown"}
              </Text>
              {canManage && (
                <Button
                  variant="plain"
                  size="xs"
                  paddingX={0}
                  disabled={pending}
                  onClick={() => void clear()}
                >
                  clear
                </Button>
              )}
            </HStack>
          </VStack>
        )}
      </Table.Cell>
    </Table.Row>
  );
}

function FeatureFlagRulesDialog({
  open,
  onOpenChange,
  flagKey,
  initialRules,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flagKey: string;
  initialRules: FeatureFlagRules;
  onSave: OperatorFeatureFlagCatalogueProps["onSetRules"];
}) {
  const [draft, setDraft] = useState(() => rulesToEditor(initialRules));
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setDraft(rulesToEditor(initialRules));
      setValidationError(null);
    }
    wasOpen.current = open;
  }, [open, initialRules]);

  const save = async () => {
    if (draft.some((rule) => !validPercentage(rule.percentage))) {
      setValidationError("A percentage must be a whole number from 0 to 100.");
      return;
    }
    // A date nothing can read is a rule that never matches, which reads to the
    // operator as a rollout that silently never started.
    if (draft.some((rule) => !validCreatedAfter(rule.organizationCreatedAfter))) {
      setValidationError("New organizations needs a date, for example 2026-09-01.");
      return;
    }

    setSaving(true);
    try {
      await onSave({ key: flagKey, rules: editorToRules(draft) });
      onOpenChange(false);
    } catch {
      return;
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(details: { open: boolean }) => onOpenChange(details.open)}
      size="lg"
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Targeting rules</Dialog.Title>
          <Dialog.Description>
            Rules are evaluated top-to-bottom. Conditions in one rule are combined.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <VStack align="stretch" gap={3}>
            <Text fontFamily="mono" fontSize="xs" color="fg.muted">
              {flagKey}
            </Text>
            {draft.map((rule, index) => (
              <RuleEditorRow
                key={index}
                rule={rule}
                onChange={(patch) => {
                  setDraft((current) =>
                    current.map((candidate, candidateIndex) => {
                      return candidateIndex === index ? { ...candidate, ...patch } : candidate;
                    }),
                  );
                }}
                onRemove={() => {
                  setDraft((current) =>
                    current.filter((_, candidateIndex) => candidateIndex !== index),
                  );
                }}
              />
            ))}
            {validationError && <Text color="fg.error">{validationError}</Text>}
            <Button
              variant="ghost"
              size="sm"
              alignSelf="flex-start"
              onClick={() => setDraft((current) => [...current, newEditorRule()])}
            >
              Add rule
            </Button>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.ActionTrigger asChild>
            <Button variant="outline" disabled={saving}>
              Cancel
            </Button>
          </Dialog.ActionTrigger>
          <Button colorPalette="blue" loading={saving} onClick={() => void save()}>
            Save rules
          </Button>
        </Dialog.Footer>
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}

function RuleEditorRow({
  rule,
  onChange,
  onRemove,
}: {
  rule: FeatureFlagRuleEditorRule;
  onChange: (patch: Partial<FeatureFlagRuleEditorRule>) => void;
  onRemove: () => void;
}) {
  return (
    <HStack align="flex-end" gap={2} padding={2} borderWidth="1px" borderRadius="md">
      <RuleInput
        label="Organization id"
        value={rule.organizationId}
        onChange={(organizationId) => onChange({ organizationId })}
      />
      <RuleInput
        label="Project id"
        value={rule.projectId}
        onChange={(projectId) => onChange({ projectId })}
      />
      <RuleInput
        label="Percentage"
        value={rule.percentage}
        onChange={(percentage) => onChange({ percentage })}
        type="number"
      />
      <RuleInput
        label="New organizations after"
        value={rule.organizationCreatedAfter}
        onChange={(organizationCreatedAfter) => onChange({ organizationCreatedAfter })}
        type="date"
      />
      <Field.Root flexBasis="100px">
        <Field.Label fontSize="xs">Enabled</Field.Label>
        <Switch
          checked={rule.enabled}
          onCheckedChange={(details) => onChange({ enabled: details.checked })}
        />
      </Field.Root>
      <Button size="xs" variant="ghost" onClick={onRemove}>
        Remove
      </Button>
    </HStack>
  );
}

function RuleInput({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number" | "date";
}) {
  return (
    <Field.Root flex={1}>
      <Field.Label fontSize="xs">{label}</Field.Label>
      <Input
        size="sm"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field.Root>
  );
}

function newEditorRule(): FeatureFlagRuleEditorRule {
  return {
    organizationId: "",
    projectId: "",
    percentage: "",
    organizationCreatedAfter: "",
    enabled: true,
    preservedMatch: {},
  };
}

function validCreatedAfter(value: string): boolean {
  if (!value.trim()) return true;
  return !Number.isNaN(Date.parse(value));
}

function validPercentage(value: string): boolean {
  if (!value.trim()) return true;
  const percentage = Number(value);

  return Number.isInteger(percentage) && percentage >= 0 && percentage <= 100;
}

function sourceFor(row: OperatorFeatureFlag): string {
  if (row.envOverride !== null) return "env override";
  if (row.rules.length > 0) return "postgres + rules";
  if (row.storedValue !== null) return "postgres";
  return "registry default";
}

function summarizeTargeting(rules: FeatureFlagRules, effective: boolean) {
  const organizationIds = new Set<string>();
  const projectIds = new Set<string>();
  let percentageRules = 0;
  let newOrganizationRules = 0;
  let everyone = false;

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (
      !rule.match.organizationId &&
      !rule.match.projectId &&
      !rule.match.percentage &&
      !rule.match.organizationCreatedAfter
    ) {
      everyone = true;
      break;
    }

    if (rule.match.organizationId) organizationIds.add(rule.match.organizationId);
    if (rule.match.projectId) projectIds.add(rule.match.projectId);
    if (rule.match.percentage) percentageRules += 1;
    if (rule.match.organizationCreatedAfter) newOrganizationRules += 1;
  }

  const parts = [
    organizationIds.size ? `${organizationIds.size} organisation(s)` : "",
    projectIds.size ? `${projectIds.size} project(s)` : "",
    percentageRules ? `${percentageRules} percentage rollout(s)` : "",
    newOrganizationRules ? "new organizations" : "",
  ].filter(Boolean);
  const partialEnabled = !effective && (everyone || parts.length > 0);
  if (effective) {
    return { partialEnabled, label: null };
  }

  if (everyone) {
    return { partialEnabled, label: "Enabled for everyone via rule" };
  }

  const label = parts.length ? `Enabled for ${parts.join(", ")}` : null;

  return { partialEnabled, label };
}

function ScopeBadge({ scope }: { scope: "SYSTEM" | "PRODUCT" }) {
  return (
    <Badge colorPalette={scope === "SYSTEM" ? "purple" : "blue"} size="sm" variant="subtle">
      {scope}
    </Badge>
  );
}

function groupByScope(flags: OperatorFeatureFlag[]): {
  system: OperatorFeatureFlag[];
  product: OperatorFeatureFlag[];
} {
  return flags.reduce(
    (grouped, flag) => {
      grouped[flag.scope === "SYSTEM" ? "system" : "product"].push(flag);
      return grouped;
    },
    { system: [], product: [] } as {
      system: OperatorFeatureFlag[];
      product: OperatorFeatureFlag[];
    },
  );
}
