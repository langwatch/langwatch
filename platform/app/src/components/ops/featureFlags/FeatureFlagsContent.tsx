import {
  Badge,
  Box,
  Button,
  Center,
  Heading,
  HStack,
  IconButton,
  Spinner,
  Stack,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Settings2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Switch } from "~/components/ui/switch";
import { Tooltip } from "~/components/ui/tooltip";
import { HandledErrorAlert, showErrorToast } from "~/features/errors";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import type { FeatureFlagRules } from "~/server/featureFlag";
import { api } from "~/utils/api";
import { FeatureFlagRulesDialog } from "./FeatureFlagRulesDialog";
import { summarizeTargeting, targetingLabel } from "./targetingSummary";

interface FlagRow {
  key: string;
  scope: "SYSTEM" | "PRODUCT";
  defaultValue: boolean;
  description: string;
  family: string | null;
  storedValue: boolean | null;
  rules: FeatureFlagRules;
  envOverride: boolean | null;
  effective: boolean;
  lastEditedBy: string | null;
  updatedAt: Date | string | null;
}

export function FeatureFlagsContent() {
  const { scope } = useOpsPermission();
  // OpsScope is { kind: "none" | "platform" }. Mutating endpoints are
  // gated server-side by ops:manage, so we keep the UI in sync by
  // disabling the toggle for non-platform users.
  const canManage = scope?.kind === "platform";
  const publicEnv = usePublicEnv();
  const isSaas = Boolean(publicEnv.data?.IS_SAAS);

  const query = api.ops.listFeatureFlags.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const utils = api.useUtils();
  const setFlag = api.ops.setFeatureFlag.useMutation({
    onSuccess: async () => {
      await utils.ops.listFeatureFlags.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't update the flag" }),
  });
  const clearFlag = api.ops.clearFeatureFlag.useMutation({
    onSuccess: async () => {
      await utils.ops.listFeatureFlags.invalidate();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't clear the override" }),
  });

  const grouped = useMemo(
    () => groupByScope(query.data?.flags ?? []),
    [query.data],
  );

  if (query.isLoading) {
    return (
      <Center paddingY={20}>
        <Spinner />
      </Center>
    );
  }

  if (query.error) {
    return (
      <Center paddingY={20}>
        <HandledErrorAlert
          error={query.error}
          fallbackTitle="Couldn't load feature flags"
        />
      </Center>
    );
  }

  return (
    <Stack gap={8} paddingY={4} maxWidth="1200px">
      <Box>
        <Text fontSize="sm" color="fg.muted">
          Every flag is served from this LangWatch postgres database, whichever
          scope it carries, so flipping one is fast and free. Scope says who the
          flag is for: product-scoped flags are customer-facing features,
          system-scoped flags are kill switches and pipeline toggles. Targeting
          rules work the same for both.
        </Text>
      </Box>

      <ScopeSection
        heading="Product"
        description={
          isSaas
            ? "Customer-facing features. Customers get the value set here when no targeting rule matches and no env override is configured; set a targeting rule to reach a subset of organizations."
            : "Customer-facing features. Customers get the value set here when no targeting rule matches and no env override is configured."
        }
        rows={grouped.product}
        canManage={canManage}
        isSaas={isSaas}
        onToggle={({ key, enabled }) => setFlag.mutateAsync({ key, enabled })}
        onClear={({ key }) => clearFlag.mutateAsync({ key })}
        pendingKey={
          (setFlag.isPending ? setFlag.variables?.key : undefined) ??
          (clearFlag.isPending ? clearFlag.variables?.key : undefined)
        }
      />

      <ScopeSection
        heading="System"
        description="Backend kill switches and pipeline toggles. Resolved from env, this postgres store, then the registry default."
        rows={grouped.system}
        canManage={canManage}
        isSaas={isSaas}
        onToggle={({ key, enabled }) => setFlag.mutateAsync({ key, enabled })}
        onClear={({ key }) => clearFlag.mutateAsync({ key })}
        pendingKey={
          (setFlag.isPending ? setFlag.variables?.key : undefined) ??
          (clearFlag.isPending ? clearFlag.variables?.key : undefined)
        }
      />

      {query.data?.families && query.data.families.length > 0 && (
        <Box>
          <Heading size="sm" mb={2}>
            Flag families
          </Heading>
          <Text fontSize="xs" color="fg.muted" mb={3}>
            Dynamically-named flags that share a key prefix. Individual
            instances appear inline above once a postgres row exists.
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
              {query.data.families.map((f) => (
                <Table.Row key={f.keyPrefix}>
                  <Table.Cell>
                    <code>{f.keyPrefix}*</code>
                  </Table.Cell>
                  <Table.Cell>
                    <ScopeBadge scope={f.scope} />
                  </Table.Cell>
                  <Table.Cell>{f.defaultValue ? "on" : "off"}</Table.Cell>
                  <Table.Cell>{f.description}</Table.Cell>
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
  canManage,
  isSaas,
  onToggle,
  onClear,
  pendingKey,
}: {
  heading: string;
  description: string;
  rows: FlagRow[];
  canManage: boolean;
  isSaas: boolean;
  onToggle: (input: { key: string; enabled: boolean }) => Promise<unknown>;
  onClear: (input: { key: string }) => Promise<unknown>;
  pendingKey: string | undefined;
}) {
  return (
    <Box>
      <Heading size="md" mb={1}>
        {heading}
      </Heading>
      <Text fontSize="xs" color="fg.muted" mb={3}>
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
              <FlagRowView
                key={row.key}
                row={row}
                canManage={canManage}
                showProductWarning={isSaas && row.scope === "PRODUCT"}
                onToggle={onToggle}
                onClear={onClear}
                pending={pendingKey === row.key}
              />
            ))}
          </Table.Body>
        </Table.Root>
      )}
    </Box>
  );
}

/**
 * Blast-radius note for a PRODUCT flag on a shared install. Held as one
 * constant because it is rendered twice: as the tooltip content for a sighted
 * operator, and as screen-reader-only text inside the badge for everyone else.
 * Tooltip content is not in the DOM until hover, so a note kept only there
 * reaches neither a screen reader nor any assertion — which is how the
 * previous wording survived being replaced wholesale with "x" while its bound
 * test stayed green.
 *
 * The srOnly copy is deliberate rather than an `aria-label` on the badge:
 * Chakra renders Badge as a role-less <span>, and ARIA prohibits naming a
 * generic element, so an aria-label there is ignored by screen readers even
 * though Testing Library's getByLabelText happily matches it.
 */
const FLEET_REACH_NOTE =
  "This flag gates a customer-facing feature, and a value set here applies to every organization that no targeting rule matches. On a shared install that is the whole fleet, so prefer a per-organization or per-project rule when rolling one out.";

function FlagRowView({
  row,
  canManage,
  showProductWarning,
  onToggle,
  onClear,
  pending,
}: {
  row: FlagRow;
  canManage: boolean;
  showProductWarning: boolean;
  onToggle: (input: { key: string; enabled: boolean }) => Promise<unknown>;
  onClear: (input: { key: string }) => Promise<unknown>;
  pending: boolean;
}) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [rulesDialogOpen, setRulesDialogOpen] = useState(false);
  const envLocked = row.envOverride !== null;
  const effective = optimistic ?? row.effective;
  const ruleCount = row.rules.length;
  const source = envLocked
    ? "env override"
    : ruleCount > 0
      ? "postgres + rules"
      : row.storedValue !== null
        ? "postgres"
        : "registry default";

  const summary = summarizeTargeting(row.rules);
  const ruleTargetingLabel = targetingLabel(summary);
  // The toggle reads off but a rule has switched the flag on for someone:
  // paint it as on so the row does not read as "nobody has this".
  const partialEnabled = !effective && ruleTargetingLabel !== null;
  const targetingNote = effective ? null : ruleTargetingLabel;

  const onChange = async (next: boolean) => {
    setOptimistic(next);
    try {
      await onToggle({ key: row.key, enabled: next });
    } catch {
      // Mutation onError already surfaces the failure via toast; we
      // swallow here to keep the unhandled-rejection warning out of
      // the console.
    } finally {
      setOptimistic(null);
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
            {showProductWarning && (
              <Tooltip content={FLEET_REACH_NOTE}>
                <Badge colorPalette="yellow" size="sm" variant="subtle">
                  All customers
                  <Text srOnly>{FLEET_REACH_NOTE}</Text>
                </Badge>
              </Tooltip>
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
              checked={effective || partialEnabled}
              disabled={!canManage || envLocked || pending}
              onCheckedChange={(details) => void onChange(details.checked)}
              css={
                partialEnabled
                  ? {
                      "& [data-part='control'][data-state='checked']": {
                        background: "green.500",
                      },
                    }
                  : undefined
              }
            />
            {canManage && !envLocked && (
              <Tooltip
                content={
                  ruleCount === 0
                    ? "Specific targeting"
                    : `Specific targeting (${ruleCount} rule${ruleCount === 1 ? "" : "s"})`
                }
              >
                <IconButton
                  aria-label="Specific targeting"
                  size="xs"
                  variant="ghost"
                  onClick={() => setRulesDialogOpen(true)}
                  color="gray.500"
                >
                  <Settings2 size={14} />
                </IconButton>
              </Tooltip>
            )}
            {envLocked && (
              <Tooltip
                content={`Locked by env override (${row.envOverride ? "1" : "0"}). The toggle is disabled because the env var wins over postgres.`}
              >
                <Badge colorPalette="orange" size="sm" variant="subtle">
                  env override
                </Badge>
              </Tooltip>
            )}
          </HStack>
          {targetingNote && (
            <Text fontSize="xs" color="fg.muted">
              {targetingNote}
            </Text>
          )}
        </VStack>
        <FeatureFlagRulesDialog
          open={rulesDialogOpen}
          onOpenChange={setRulesDialogOpen}
          flagKey={row.key}
          initialRules={row.rules}
        />
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="xs">{source}</Text>
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="xs">{row.defaultValue ? "on" : "off"}</Text>
      </Table.Cell>
      <Table.Cell>
        {row.storedValue !== null ? (
          <VStack align="start" gap={0}>
            <Text fontSize="xs">
              {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : ""}
            </Text>
            <HStack gap={2}>
              <Text fontSize="xs" color="fg.muted">
                {row.lastEditedBy ?? "unknown"}
              </Text>
              {canManage && (
                <Button
                  type="button"
                  variant="plain"
                  size="xs"
                  fontSize="xs"
                  color="blue.500"
                  textDecoration="underline"
                  paddingX={0}
                  height="auto"
                  minWidth="auto"
                  disabled={pending}
                  onClick={() => {
                    void onClear({ key: row.key }).catch(() => {
                      // Error already surfaced via mutation onError
                      // toast; we suppress the rejection here so
                      // it doesn't leak as an unhandled rejection.
                    });
                  }}
                >
                  clear
                </Button>
              )}
            </HStack>
          </VStack>
        ) : (
          <Text fontSize="xs" color="fg.muted">
            never
          </Text>
        )}
      </Table.Cell>
    </Table.Row>
  );
}

function ScopeBadge({ scope }: { scope: "SYSTEM" | "PRODUCT" }) {
  return (
    <Badge
      colorPalette={scope === "SYSTEM" ? "purple" : "blue"}
      size="sm"
      variant="subtle"
    >
      {scope}
    </Badge>
  );
}

function groupByScope(rows: FlagRow[]): {
  system: FlagRow[];
  product: FlagRow[];
} {
  return rows.reduce<{ system: FlagRow[]; product: FlagRow[] }>(
    (acc, r) => {
      if (r.scope === "SYSTEM") acc.system.push(r);
      else acc.product.push(r);
      return acc;
    },
    { system: [], product: [] },
  );
}
