import {
  Badge,
  Box,
  Button,
  Center,
  HStack,
  Heading,
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
import { toaster } from "~/components/ui/toaster";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import type { FeatureFlagRules } from "~/server/featureFlag";
import { api } from "~/utils/api";
import { FeatureFlagRulesDialog } from "./FeatureFlagRulesDialog";

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
    onError: (error) => {
      toaster.create({
        title: "Failed to update flag",
        description: error.message,
        type: "error",
      });
    },
  });
  const clearFlag = api.ops.clearFeatureFlag.useMutation({
    onSuccess: async () => {
      await utils.ops.listFeatureFlags.invalidate();
    },
    onError: (error) => {
      toaster.create({
        title: "Failed to clear override",
        description: error.message,
        type: "error",
      });
    },
  });

  const grouped = useMemo(() => groupByScope(query.data?.flags ?? []), [query.data]);

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
        <Text color="red.500">{query.error.message}</Text>
      </Center>
    );
  }

  return (
    <Stack gap={8} paddingY={4} maxWidth="1200px">
      <Box>
        <Text fontSize="sm" color="fg.muted">
          System-scoped flags are kill switches and pipeline toggles served
          from this LangWatch postgres database. They never round-trip to
          PostHog, so flipping them is fast and free.{" "}
          {isSaas
            ? "Product-scoped flags still resolve through PostHog for user targeting and A/B tests; postgres values here only apply as an emergency override."
            : "Product-scoped flags fall back to this postgres store when PostHog is not configured."}
        </Text>
      </Box>

      <ScopeSection
        heading="System"
        description="Backend kill switches and pipeline toggles. Always resolved from postgres, env, or registry default. PostHog is never consulted."
        rows={grouped.system}
        canManage={canManage}
        isSaas={isSaas}
        onToggle={({ key, enabled }) =>
          setFlag.mutateAsync({ key, enabled })
        }
        onClear={({ key }) => clearFlag.mutateAsync({ key })}
        pendingKey={
          (setFlag.isPending ? setFlag.variables?.key : undefined) ??
          (clearFlag.isPending ? clearFlag.variables?.key : undefined)
        }
      />

      <ScopeSection
        heading="Product"
        description={
          isSaas
            ? "UI features and A/B tests. Source of truth is PostHog; postgres value here is an emergency override only."
            : "UI features. On this self-hosted install, the postgres value here is the source of truth."
        }
        rows={grouped.product}
        canManage={canManage}
        isSaas={isSaas}
        onToggle={({ key, enabled }) =>
          setFlag.mutateAsync({ key, enabled })
        }
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

  // Walk rules honoring first-match-wins, so a disabled rule earlier in
  // the list correctly shadows a later enabled rule for the same scope.
  // An empty-match rule matches every context, so once one is seen, no
  // later rule can ever fire and we stop.
  let everyoneViaRule: boolean | null = null;
  const orgDecisions = new Map<string, boolean>();
  const projectDecisions = new Map<string, boolean>();
  for (const r of row.rules) {
    const isEveryone = !r.match.organizationId && !r.match.projectId;
    if (isEveryone) {
      everyoneViaRule = r.enabled;
      break;
    }
    if (r.match.organizationId && !orgDecisions.has(r.match.organizationId)) {
      orgDecisions.set(r.match.organizationId, r.enabled);
    }
    if (r.match.projectId && !projectDecisions.has(r.match.projectId)) {
      projectDecisions.set(r.match.projectId, r.enabled);
    }
  }
  const enabledOrgIds = new Set(
    Array.from(orgDecisions.entries())
      .filter(([, v]) => v)
      .map(([k]) => k),
  );
  const enabledProjectIds = new Set(
    Array.from(projectDecisions.entries())
      .filter(([, v]) => v)
      .map(([k]) => k),
  );
  const enabledEveryoneViaRule = everyoneViaRule === true;
  const partialEnabled =
    !effective &&
    (enabledEveryoneViaRule ||
      enabledOrgIds.size > 0 ||
      enabledProjectIds.size > 0);
  const targetingSummary = enabledEveryoneViaRule
    ? "Enabled for everyone via rule"
    : [
        enabledOrgIds.size > 0 &&
          `${enabledOrgIds.size} organization${enabledOrgIds.size === 1 ? "" : "s"}`,
        enabledProjectIds.size > 0 &&
          `${enabledProjectIds.size} project${enabledProjectIds.size === 1 ? "" : "s"}`,
      ]
        .filter(Boolean)
        .join(", ");
  const targetingLabel =
    !effective && targetingSummary
      ? enabledEveryoneViaRule
        ? targetingSummary
        : `Enabled for ${targetingSummary}`
      : null;

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
              <Tooltip content="PRODUCT flags normally resolve through PostHog. Setting a postgres value here will override PostHog for every caller; emergency use only.">
                <Badge colorPalette="yellow" size="sm" variant="subtle">
                  PostHog managed
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
          {targetingLabel && (
            <Text fontSize="xs" color="fg.muted">
              {targetingLabel}
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
              {row.updatedAt
                ? new Date(row.updatedAt).toLocaleString()
                : ""}
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

function groupByScope(rows: FlagRow[]): { system: FlagRow[]; product: FlagRow[] } {
  return rows.reduce<{ system: FlagRow[]; product: FlagRow[] }>(
    (acc, r) => {
      if (r.scope === "SYSTEM") acc.system.push(r);
      else acc.product.push(r);
      return acc;
    },
    { system: [], product: [] },
  );
}
