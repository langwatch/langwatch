import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Stack,
  Table,
  Text,
  VStack,
  VisuallyHidden,
} from "@chakra-ui/react";
import type {
  FeatureFlagRules,
  OperatorFeatureFlag as StoredOperatorFeatureFlag,
  OperatorFeatureFlagCatalogue,
} from "@langwatch/feature-flag-contract";
import { readableDate } from "./model/display-formatters.ts";

/** One flag as the BROWSER receives it: `updatedAt` arrives as an ISO string. */
export type OperatorFeatureFlag = Omit<StoredOperatorFeatureFlag, "updatedAt"> & {
  updatedAt: string | null;
};
import { useMemo, useState } from "react";
import { Switch } from "@langwatch/design-system/switch";
import { FeatureFlagRulesDialog } from "./feature-flag-rules-dialog.tsx";
import { summarizeTargeting, targetingLabel } from "./model/targeting-summary.ts";

/**
 * The catalogue as the BROWSER receives it.
 *
 * The contract types `updatedAt` as `Date` because that is what the server
 * builds; nothing transforms the wire, so what arrives is the ISO string.
 */
export type OperatorFeatureFlagCatalogueRead = Omit<OperatorFeatureFlagCatalogue, "flags"> & {
  flags: OperatorFeatureFlag[];
};

export interface OperatorFeatureFlagCatalogueProps {
  /** True on a shared (multi-tenant) install, where a PRODUCT flag reaches every customer. */
  sharedInstall?: boolean;
  catalogue: OperatorFeatureFlagCatalogueRead;
  canManage: boolean;
  pendingKey?: string;
  onSetEnabled: (input: { key: string; enabled: boolean }) => Promise<void>;
  onClear: (input: { key: string }) => Promise<void>;
  onSetRules: (input: { key: string; rules: FeatureFlagRules }) => Promise<void>;
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
  const targeting = describeTargeting(row.rules, effective);

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
            <Text fontSize="xs">
              {row.updatedAt ? readableDate(row.updatedAt).toLocaleString() : ""}
            </Text>
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

function sourceFor(row: OperatorFeatureFlag): string {
  if (row.envOverride !== null) return "env override";
  if (row.rules.length > 0) return "postgres + rules";
  if (row.storedValue !== null) return "postgres";
  return "registry default";
}

/**
 * The one line under a flag's toggle: who a rule has already switched the flag
 * on for, walked the way the resolver walks it.
 */
function describeTargeting(rules: FeatureFlagRules, effective: boolean) {
  const summary = summarizeTargeting(rules);
  const label = targetingLabel(summary);
  const partialEnabled = !effective && label !== null;

  return { partialEnabled, label: effective ? null : label };
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
