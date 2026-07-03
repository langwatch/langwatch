import {
  Badge,
  Box,
  Button,
  Field,
  Heading,
  HStack,
  IconButton,
  Input,
  NativeSelect,
  Separator,
  Spacer,
  Spinner,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import {
  ArrowDown,
  ArrowUp,
  Lightbulb,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "~/components/gateway/ConfirmDialog";
import { FieldInfoTooltip } from "~/components/gateway/FieldInfoTooltip";
import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { ProviderScopeChips } from "~/components/settings/ProviderScopeChips";
import {
  ScopeChipPicker,
  type ScopeTriadEntry,
} from "~/components/settings/ScopeChipPicker";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { Checkbox } from "~/components/ui/checkbox";
import { Drawer } from "~/components/ui/drawer";
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";
import { docsUrl } from "~/utils/docsUrl";

type Policy = RouterOutputs["routingPolicy"]["list"][number];
type Scope = "organization" | "team" | "project";
type Strategy = "priority" | "cost" | "latency" | "round_robin";

const SCOPE_GROUPS: Array<{ scope: Scope; label: string; subtitle: string }> = [
  {
    scope: "organization",
    label: "Organization defaults",
    subtitle:
      "Apply to every team / project that doesn't define its own default",
  },
  {
    scope: "team",
    label: "Team defaults",
    subtitle: "Override the org default for users in a specific team",
  },
  {
    scope: "project",
    label: "Project defaults",
    subtitle: "Override at the project level for production agents",
  },
];

const STRATEGY_OPTIONS: Array<{ value: Strategy; label: string }> = [
  { value: "priority", label: "Priority (try in order)" },
  { value: "cost", label: "Cost-optimised" },
  { value: "latency", label: "Latency-optimised" },
  { value: "round_robin", label: "Round-robin" },
];

function RoutingPoliciesPage() {
  const { organization, project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";

  const policiesQuery = api.routingPolicy.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );

  // Fuel the structured picker on the drawer with the org's actual
  // ModelProviders. Must be the one-entry-per-row org listing:
  // `getAllForProject` collapses rows by provider key, so two "custom"
  // providers would surface as a single picker option and every other
  // row in an existing policy renders as "Unknown credential".
  const credentialsQuery =
    api.modelProvider.listAllForOrganizationForFrontend.useQuery(
      { organizationId: orgId },
      { enabled: !!orgId, refetchOnWindowFocus: false },
    );

  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [policyToDelete, setPolicyToDelete] = useState<Policy | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);

  const availableTeams = useMemo(
    () => organization?.teams?.map((t) => ({ id: t.id, name: t.name })) ?? [],
    [organization?.teams],
  );
  const availableProjects = useMemo(
    () =>
      organization?.teams?.flatMap((t) =>
        t.projects.map((p) => ({
          id: p.id,
          name: `${p.name} · ${t.name}`,
          teamId: t.id,
        })),
      ) ?? [],
    [organization?.teams],
  );
  const teamNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of organization?.teams ?? []) map.set(t.id, t.name);
    return map;
  }, [organization?.teams]);
  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of organization?.teams ?? []) {
      for (const p of t.projects) map.set(p.id, p.name);
    }
    return map;
  }, [organization?.teams]);
  const resolveScopeEntriesWithNames = (
    scopes: ScopeTriadEntry[],
  ): ScopeTriadEntry[] =>
    scopes.map((s) => ({
      scopeType: s.scopeType,
      scopeId: s.scopeId,
      name:
        s.scopeType === "ORGANIZATION"
          ? organization?.name
          : s.scopeType === "TEAM"
            ? teamNameById.get(s.scopeId)
            : projectNameById.get(s.scopeId),
    }));

  const utils = api.useUtils();
  const refetch = () =>
    utils.routingPolicy.list.invalidate({ organizationId: orgId });

  // G82 - surface tRPC errors INSIDE the drawer in addition to the toast.
  // The toast was racing the drawer's own scrim/overlay z-index on some
  // viewport heights and silently failed to render, leaving "Create
  // policy" looking like a no-op. Inline alert is the durable signal.
  const [drawerError, setDrawerError] = useState<string | null>(null);

  const createMutation = api.routingPolicy.create.useMutation({
    onSuccess: () => {
      void refetch();
      setEditingId(null);
      setComposer(null);
      setDrawerError(null);
      toaster.create({ title: "Routing policy created", type: "success" });
    },
    onError: (e) => {
      setDrawerError(e.message);
      toaster.create({
        title: "Failed to create policy",
        description: e.message,
        type: "error",
      });
    },
  });

  const updateMutation = api.routingPolicy.update.useMutation({
    onSuccess: () => {
      void refetch();
      setEditingId(null);
      setComposer(null);
      setDrawerError(null);
      toaster.create({ title: "Routing policy updated", type: "success" });
    },
    onError: (e) => {
      setDrawerError(e.message);
      toaster.create({
        title: "Failed to update policy",
        description: e.message,
        type: "error",
      });
    },
  });

  const setDefaultMutation = api.routingPolicy.setDefault.useMutation({
    onSuccess: () => {
      void refetch();
      toaster.create({ title: "Default policy updated", type: "success" });
    },
    onError: (e) =>
      toaster.create({
        title: "Failed to set default",
        description: e.message,
        type: "error",
      }),
  });

  const deleteMutation = api.routingPolicy.delete.useMutation({
    onSuccess: () => {
      void refetch();
      setPolicyToDelete(null);
      toaster.create({ title: "Routing policy deleted", type: "success" });
    },
    onError: (e) =>
      toaster.create({
        title: "Failed to delete policy",
        description: e.message,
        type: "error",
      }),
  });

  const grouped = useMemo(() => {
    const out: Record<Scope, Policy[]> = {
      organization: [],
      team: [],
      project: [],
    };
    for (const p of policiesQuery.data ?? []) {
      // Multi-scope policies bucket under the FIRST scope row. The
      // PolicyRow shows the full scope chip list so the multi-scope
      // nature is still visible to the operator.
      const first = p.scopes?.[0];
      if (!first) continue;
      const scopeKey = String(first.scopeType).toLowerCase() as Scope;
      if (out[scopeKey]) out[scopeKey].push(p);
    }
    return out;
  }, [policiesQuery.data]);

  const startNew = (
    scope: Scope,
    scopeIdDefault: string,
    initialIsDefault = false,
  ) => {
    setDrawerError(null);
    setEditingId("new");
    const seedType = scope.toUpperCase() as ScopeTriadEntry["scopeType"];
    const seedId =
      seedType === "ORGANIZATION" ? orgId : scopeIdDefault;
    setComposer({
      scopes: seedId
        ? [{ scopeType: seedType, scopeId: seedId }]
        : [],
      name: "",
      description: "",
      strategy: "priority",
      modelProviderIds: [],
      modelAllowlist: [],
      isDefault: initialIsDefault,
      aliases: [],
      policyRules: EMPTY_POLICY_RULES,
    });
  };

  const startEdit = (p: Policy) => {
    setDrawerError(null);
    setEditingId(p.id);
    const scopes: ScopeTriadEntry[] = p.scopes.map((s) => ({
      scopeType: s.scopeType as ScopeTriadEntry["scopeType"],
      scopeId: s.scopeId,
    }));
    const aliasesObj = ((p as any).modelAliases ?? {}) as Record<
      string,
      string
    >;
    setComposer({
      scopes,
      name: p.name,
      description: p.description ?? "",
      strategy: p.strategy as Strategy,
      modelProviderIds: Array.isArray(p.modelProviderIds)
        ? (p.modelProviderIds as string[])
        : [],
      modelAllowlist: Array.isArray(p.modelAllowlist)
        ? (p.modelAllowlist as string[])
        : [],
      isDefault: p.isDefault,
      aliases: Object.entries(aliasesObj).map(([from, to]) => ({
        from,
        to,
      })),
      policyRules: policyRulesFromServer((p as any).policyRules),
    });
  };

  const onSubmit = () => {
    if (!composer) return;

    const aliasesPayload: Record<string, string> = {};
    for (const pair of composer.aliases) {
      const from = pair.from.trim();
      const to = pair.to.trim();
      if (from && to) aliasesPayload[from] = to;
    }
    const policyRulesPayload = buildPolicyRulesPayload(composer.policyRules);

    if (editingId === "new") {
      createMutation.mutate({
        organizationId: orgId,
        scopes: composer.scopes,
        name: composer.name,
        description: composer.description || null,
        modelProviderIds: composer.modelProviderIds,
        modelAllowlist:
          composer.modelAllowlist.length > 0 ? composer.modelAllowlist : null,
        strategy: composer.strategy,
        isDefault: composer.isDefault,
        modelAliases: aliasesPayload,
        policyRules: policyRulesPayload,
      });
    } else if (editingId) {
      updateMutation.mutate({
        organizationId: orgId,
        id: editingId,
        name: composer.name,
        description: composer.description || null,
        modelProviderIds: composer.modelProviderIds,
        modelAllowlist:
          composer.modelAllowlist.length > 0 ? composer.modelAllowlist : null,
        strategy: composer.strategy,
        modelAliases: aliasesPayload,
        policyRules: policyRulesPayload,
      });
    }
  };

  const hasAnyPolicy =
    grouped.organization.length +
      grouped.team.length +
      grouped.project.length >
    0;
  const hasAnyDefault =
    [...grouped.organization, ...grouped.team, ...grouped.project].some(
      (p) => p.isDefault,
    );

  return (
    <GovernanceLayout pageTitle="Routing Policies · AI Governance · LangWatch">
      <VStack align="stretch" gap={6} width="full" maxW="container.xl">
        <HStack alignItems="end">
          <VStack align="start" gap={0}>
            <Heading as="h2" size="lg">
              Routing Policies
            </Heading>
            <Text color="fg.muted" fontSize="sm">
              Define which providers and models personal, team, and project
              keys route through. The hierarchy is project → team →
              organization; first match wins.
            </Text>
          </VStack>
          <Spacer />
        </HStack>

        {policiesQuery.isLoading && <Spinner size="sm" />}

        {!policiesQuery.isLoading && !hasAnyDefault && (
          <Box
            borderWidth="1px"
            borderColor="orange.300"
            borderRadius="md"
            backgroundColor="orange.50"
            padding={4}
          >
            <HStack alignItems="start" gap={3}>
              <Box color="orange.600" paddingTop="2px">
                <Lightbulb size={18} />
              </Box>
              <VStack align="start" gap={1}>
                <Text fontSize="sm" fontWeight="semibold">
                  {hasAnyPolicy
                    ? "Mark one of your policies as default"
                    : "Publish a default policy to unblock end-user keys"}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  When at least one model provider is reachable from a
                  user's personal team, personal keys still mint
                  without a default and the gateway picks providers in {" "}
                  <Text as="span" fontFamily="mono">
                    fallbackPriorityGlobal
                  </Text>{" "}
                  order. Orgs with zero accessible providers still hit
                  a 409 at issue time; configure a model provider first.
                  Publish an explicit default to pin a deterministic
                  chain at the organization level, then override
                  per-team or per-project as needed.
                </Text>
                <HStack gap={3} paddingTop={1}>
                  <Button
                    size="xs"
                    colorPalette="orange"
                    onClick={() => startNew("organization", orgId, true)}
                  >
                    <Plus size={12} /> Add organization default
                  </Button>
                  <Link
                    href={docsUrl("/ai-gateway/governance/routing-policies")}
                    isExternal
                    color="orange.700"
                    fontSize="xs"
                    fontWeight="medium"
                  >
                    Docs →
                  </Link>
                </HStack>
              </VStack>
            </HStack>
          </Box>
        )}

        {SCOPE_GROUPS.map(({ scope, label, subtitle }) => (
          <Box
            key={scope}
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="md"
            padding={4}
          >
            <HStack alignItems="start" marginBottom={3}>
              <VStack align="start" gap={0}>
                <Text fontSize="sm" fontWeight="semibold">
                  {label}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  {subtitle}
                </Text>
              </VStack>
              <Spacer />
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  startNew(
                    scope,
                    scope === "organization" ? orgId : "",
                  )
                }
              >
                <Plus size={14} /> New
              </Button>
            </HStack>

            <VStack align="stretch" gap={2}>
              {grouped[scope].length === 0 && (
                <Text fontSize="sm" color="fg.muted">
                  No policies defined at this scope.
                </Text>
              )}
              {grouped[scope].map((p) => (
                <PolicyRow
                  key={p.id}
                  policy={p}
                  onEdit={() => startEdit(p)}
                  onSetDefault={() =>
                    setDefaultMutation.mutate({
                      organizationId: orgId,
                      id: p.id,
                    })
                  }
                  onDelete={() => setPolicyToDelete(p)}
                  isPendingSetDefault={
                    setDefaultMutation.isPending &&
                    setDefaultMutation.variables?.id === p.id
                  }
                  isPendingDelete={
                    deleteMutation.isPending &&
                    deleteMutation.variables?.id === p.id
                  }
                  resolveScopeEntriesWithNames={resolveScopeEntriesWithNames}
                />
              ))}
            </VStack>
          </Box>
        ))}
      </VStack>

      <RoutingPolicyDrawer
        open={composer !== null}
        composer={composer}
        setComposer={setComposer}
        mode={editingId === "new" ? "create" : "edit"}
        isPending={
          editingId === "new"
            ? createMutation.isPending
            : updateMutation.isPending
        }
        availableCredentials={
          credentialsQuery.data
            ? credentialsQuery.data.providers
                .filter((mp) => !!mp.id)
                .map((mp) => ({
                  id: mp.id!,
                  modelProviderName: mp.name ?? mp.provider,
                  slot: "primary",
                  disabledAt: mp.disabledAt
                    ? new Date(mp.disabledAt).toISOString()
                    : null,
                  healthStatus: mp.healthStatus ?? "UNKNOWN",
                }))
            : []
        }
        credentialsLoading={credentialsQuery.isLoading}
        modelProvidersAdminPath="/settings/model-providers"
        errorMessage={drawerError}
        onClearError={() => setDrawerError(null)}
        onSubmit={onSubmit}
        onCancel={() => {
          setDrawerError(null);
          setEditingId(null);
          setComposer(null);
        }}
        organizationId={orgId}
        organizationName={organization?.name}
        availableTeams={availableTeams}
        availableProjects={availableProjects}
        resolveScopeEntriesWithNames={resolveScopeEntriesWithNames}
      />
      <ConfirmDialog
        open={!!policyToDelete}
        onOpenChange={(open) => {
          if (!open) setPolicyToDelete(null);
        }}
        title={
          policyToDelete?.isDefault
            ? `Delete default policy "${policyToDelete?.name}"?`
            : `Delete routing policy "${policyToDelete?.name ?? ""}"?`
        }
        message={
          policyToDelete?.isDefault
            ? "This is the default policy at this scope. NEW personal-key issuance falls back to fallbackPriorityGlobal ordering across scope-eligible providers until another default is published. Existing VKs that already reference this policy keep the persisted routingPolicyId and will fail closed on the next request until you re-bind them to another policy."
            : "Virtual keys that explicitly reference this policy will lose the reference and fail closed at the next request. Re-publish or pick another policy on the affected VKs to restore routing."
        }
        confirmLabel="Delete policy"
        tone="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (!policyToDelete) return;
          deleteMutation.mutate({
            organizationId: orgId,
            id: policyToDelete.id,
          });
        }}
      />
    </GovernanceLayout>
  );
}

function PolicyRow({
  policy,
  onEdit,
  onSetDefault,
  onDelete,
  isPendingSetDefault,
  isPendingDelete,
  resolveScopeEntriesWithNames,
}: {
  policy: Policy;
  onEdit: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
  isPendingSetDefault: boolean;
  isPendingDelete: boolean;
  resolveScopeEntriesWithNames: (
    scopes: ScopeTriadEntry[],
  ) => ScopeTriadEntry[];
}) {
  const allowCount = Array.isArray(policy.modelAllowlist)
    ? (policy.modelAllowlist as string[]).length
    : 0;
  const providerCount = Array.isArray(policy.modelProviderIds)
    ? (policy.modelProviderIds as string[]).length
    : 0;
  const scopeEntries: ScopeTriadEntry[] = policy.scopes.map((s) => ({
    scopeType: s.scopeType as ScopeTriadEntry["scopeType"],
    scopeId: s.scopeId,
  }));

  return (
    <HStack
      borderWidth="1px"
      borderColor={policy.isDefault ? "blue.300" : "border.muted"}
      borderRadius="sm"
      padding={3}
      gap={3}
    >
      <VStack align="start" gap={1} flex={1} minWidth={0}>
        <HStack gap={2} flexWrap="wrap">
          <Text fontSize="sm" fontWeight="medium">
            {policy.name}
          </Text>
          {policy.isDefault && (
            <Badge colorPalette="blue" size="sm" variant="surface">
              default
            </Badge>
          )}
          <Badge size="sm" variant="surface">
            {policy.strategy}
          </Badge>
          <ProviderScopeChips
            scopes={resolveScopeEntriesWithNames(scopeEntries)}
            size="xs"
          />
        </HStack>
        {policy.description && (
          <Text fontSize="xs" color="fg.muted">
            {policy.description}
          </Text>
        )}
        <Text fontSize="xs" color="fg.muted">
          {providerCount} provider{providerCount === 1 ? "" : "s"}
          {allowCount > 0 && ` · ${allowCount} model glob${allowCount === 1 ? "" : "s"} allow-listed`}
          {allowCount === 0 && " · no model restrictions"}
        </Text>
      </VStack>
      {!policy.isDefault && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onSetDefault}
          loading={isPendingSetDefault}
          title="Set as default for this scope"
        >
          <Star size={14} /> Set default
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={onEdit}>
        <Pencil size={14} /> Edit
      </Button>
      <Button
        size="sm"
        variant="ghost"
        colorPalette="red"
        onClick={onDelete}
        loading={isPendingDelete}
      >
        <Trash2 size={14} />
      </Button>
    </HStack>
  );
}

type AliasPair = { from: string; to: string };
type PolicyDim = "tools" | "mcp" | "urls" | "models";

type ComposerState = {
  scopes: ScopeTriadEntry[];
  name: string;
  description: string;
  strategy: Strategy;
  modelProviderIds: string[];
  modelAllowlist: string[];
  isDefault: boolean;
  aliases: AliasPair[];
  policyRules: Record<PolicyDim, { deny: string; allow: string }>;
};

const EMPTY_POLICY_RULES: Record<PolicyDim, { deny: string; allow: string }> = {
  tools: { deny: "", allow: "" },
  mcp: { deny: "", allow: "" },
  urls: { deny: "", allow: "" },
  models: { deny: "", allow: "" },
};

const POLICY_DIM_META: Record<
  PolicyDim,
  { label: string; placeholderDeny: string; helper: string }
> = {
  tools: {
    label: "Tools",
    placeholderDeny: "e.g. ^shell_.*\ndelete_user",
    helper:
      "RE2 regexes matched against OpenAI tools[].function.name + Anthropic tools[].name. Deny wins.",
  },
  mcp: {
    label: "MCP servers",
    placeholderDeny: "e.g. unapproved\\.example\\.com",
    helper:
      "Matched against mcp_servers[].name and .url. Deny wins; applies before dispatch.",
  },
  urls: {
    label: "URLs",
    placeholderDeny: "e.g. internal\\.corp\\..*",
    helper:
      "Extracted from the raw request body (user messages, tool args, system prompts). First deny match returns 403 url_not_allowed.",
  },
  models: {
    label: "Models (policy)",
    placeholderDeny: "e.g. gpt-4o-search.*",
    helper:
      "RE2 regex policy distinct from the model allowlist above. Use this to enforce company policy (e.g. no non-deterministic models).",
  },
};

function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function buildPolicyRulesPayload(
  rules: Record<PolicyDim, { deny: string; allow: string }>,
): Record<PolicyDim, { deny: string[]; allow: string[] | null }> {
  const out: Record<PolicyDim, { deny: string[]; allow: string[] | null }> =
    {} as Record<PolicyDim, { deny: string[]; allow: string[] | null }>;
  for (const dim of ["tools", "mcp", "urls", "models"] as PolicyDim[]) {
    const denyArr = parseLines(rules[dim].deny);
    const allowArr = parseLines(rules[dim].allow);
    out[dim] = {
      deny: denyArr,
      allow: allowArr.length > 0 ? allowArr : null,
    };
  }
  return out;
}

function policyRulesFromServer(
  raw: unknown,
): Record<PolicyDim, { deny: string; allow: string }> {
  const out = { ...EMPTY_POLICY_RULES };
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const dim of ["tools", "mcp", "urls", "models"] as PolicyDim[]) {
    const dimRaw = src[dim];
    if (!dimRaw || typeof dimRaw !== "object") continue;
    const dimObj = dimRaw as { deny?: unknown; allow?: unknown };
    const deny = Array.isArray(dimObj.deny)
      ? (dimObj.deny as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    const allow = Array.isArray(dimObj.allow)
      ? (dimObj.allow as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    out[dim] = { deny: deny.join("\n"), allow: allow.join("\n") };
  }
  return out;
}

/**
 * Inline chip-list editor for ordered string lists. Used for routing-policy
 * provider IDs (where order = fallback priority) and model allow-list globs
 * (where order is decorative but must round-trip).
 *
 * Replaces the prior comma-separated freetext to make order explicit and
 * removal one-click. Type-Enter (or comma / paste) appends a chip, ✕ removes,
 * up/down arrows reorder.
 */
function ChipListEditor({
  values,
  onChange,
  placeholder,
  ordered,
  inputAriaLabel,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  ordered: boolean;
  inputAriaLabel: string;
}) {
  const [draft, setDraft] = useState("");

  const commitDraft = () => {
    const tokens = draft
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && !values.includes(t));
    if (tokens.length === 0) {
      setDraft("");
      return;
    }
    onChange([...values, ...tokens]);
    setDraft("");
  };

  const removeAt = (i: number) =>
    onChange(values.filter((_, idx) => idx !== i));

  const swap = (a: number, b: number) => {
    if (a < 0 || b < 0 || a >= values.length || b >= values.length) return;
    const next = values.slice();
    const tmp = next[a]!;
    next[a] = next[b]!;
    next[b] = tmp;
    onChange(next);
  };

  const moveUp = (i: number) => swap(i, i - 1);
  const moveDown = (i: number) => swap(i, i + 1);

  return (
    <VStack align="stretch" gap={2}>
      {values.length > 0 && (
        <VStack align="stretch" gap={1}>
          {values.map((value, i) => (
            <HStack
              key={`${value}-${i}`}
              borderWidth="1px"
              borderColor="border.muted"
              borderRadius="sm"
              paddingX={2}
              paddingY={1}
              gap={2}
              backgroundColor="bg.subtle"
            >
              {ordered && (
                <Text fontSize="xs" color="fg.muted" minWidth="20px">
                  {i + 1}.
                </Text>
              )}
              <Text fontSize="sm" flex={1} fontFamily="mono">
                {value}
              </Text>
              {ordered && (
                <>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => moveUp(i)}
                    disabled={i === 0}
                    aria-label="Move up"
                  >
                    <ArrowUp size={12} />
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => moveDown(i)}
                    disabled={i === values.length - 1}
                    aria-label="Move down"
                  >
                    <ArrowDown size={12} />
                  </Button>
                </>
              )}
              <Button
                size="xs"
                variant="ghost"
                onClick={() => removeAt(i)}
                aria-label="Remove"
              >
                <X size={12} />
              </Button>
            </HStack>
          ))}
        </VStack>
      )}
      <HStack gap={2}>
        <Input
          aria-label={inputAriaLabel}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commitDraft();
            }
          }}
          onBlur={() => {
            if (draft.trim().length > 0) commitDraft();
          }}
          placeholder={placeholder}
          size="sm"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={commitDraft}
          disabled={draft.trim().length === 0}
        >
          <Plus size={12} /> Add
        </Button>
      </HStack>
    </VStack>
  );
}

type ProviderCredentialOption = {
  id: string;
  modelProviderName: string;
  slot: string;
  disabledAt: string | null;
  healthStatus: string;
};

/**
 * Structured ordered multi-select for model providers. Replaces
 * the prior free-text ChipListEditor (G19) - the input expected raw
 * GatewayProviderCredential CUIDs and the placeholder hinted at slugs
 * like `mp_anthropic`, so admins typed slugs and got a 403 rejection
 * (G82). Now: dropdown of the org's configured credentials by name +
 * slot, ordered fallback list, no way to type an invalid ID.
 */
function ProviderCredentialPicker({
  selectedIds,
  onChange,
  available,
  loading,
  modelProvidersAdminPath,
}: {
  selectedIds: string[];
  onChange: (next: string[]) => void;
  available: ProviderCredentialOption[];
  loading: boolean;
  modelProvidersAdminPath: string | null;
}) {
  const byId = useMemo(() => {
    const map = new Map<string, ProviderCredentialOption>();
    for (const c of available) map.set(c.id, c);
    return map;
  }, [available]);

  // G86 - disabled credentials never appear as new pick options. They
  // can stay in the selected list (an existing policy may already
  // reference one), but the dropdown only offers active ones so an
  // admin doesn't pick a credential that will fail the moment a VK
  // routes through it.
  const activeAvailable = useMemo(
    () => available.filter((c) => !c.disabledAt),
    [available],
  );
  const remaining = useMemo(
    () => activeAvailable.filter((c) => !selectedIds.includes(c.id)),
    [activeAvailable, selectedIds],
  );
  const onlyDisabledExist =
    available.length > 0 && activeAvailable.length === 0;

  const removeAt = (i: number) =>
    onChange(selectedIds.filter((_, idx) => idx !== i));

  const swap = (a: number, b: number) => {
    if (a < 0 || b < 0 || a >= selectedIds.length || b >= selectedIds.length)
      return;
    const next = selectedIds.slice();
    const tmp = next[a]!;
    next[a] = next[b]!;
    next[b] = tmp;
    onChange(next);
  };

  const addById = (id: string) => {
    if (!id || selectedIds.includes(id)) return;
    onChange([...selectedIds, id]);
  };

  const formatLabel = (option: ProviderCredentialOption) =>
    option.slot && option.slot !== "primary"
      ? `${option.modelProviderName} (${option.slot})`
      : option.modelProviderName;

  if (loading) {
    return (
      <HStack gap={2}>
        <Spinner size="xs" />
        <Text fontSize="sm" color="fg.muted">
          Loading model providers…
        </Text>
      </HStack>
    );
  }

  if (available.length === 0 && selectedIds.length === 0) {
    return (
      <Box
        borderWidth="1px"
        borderColor="orange.300"
        borderRadius="md"
        backgroundColor="orange.50"
        padding={3}
      >
        <VStack align="start" gap={1}>
          <Text fontSize="sm" fontWeight="semibold">
            No model providers yet
          </Text>
          <Text fontSize="xs" color="fg.muted">
            A routing policy points at one or more model providers.
            Configure at least one before saving this policy.
          </Text>
          {modelProvidersAdminPath && (
            <Link
              href={modelProvidersAdminPath}
              color="orange.700"
              fontSize="xs"
              fontWeight="medium"
            >
              Open Model Providers admin →
            </Link>
          )}
        </VStack>
      </Box>
    );
  }

  if (onlyDisabledExist && selectedIds.length === 0) {
    return (
      <Box
        borderWidth="1px"
        borderColor="orange.300"
        borderRadius="md"
        backgroundColor="orange.50"
        padding={3}
      >
        <VStack align="start" gap={1}>
          <Text fontSize="sm" fontWeight="semibold">
            All model providers are disabled
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {available.length === 1
              ? "The org has 1 model provider, but it's disabled."
              : `The org has ${available.length} model providers, but all are disabled.`}
            {" "}Re-enable one (or add a fresh one) before this policy can
            route traffic.
          </Text>
          {modelProvidersAdminPath && (
            <Link
              href={modelProvidersAdminPath}
              color="orange.700"
              fontSize="xs"
              fontWeight="medium"
            >
              Open Model Providers admin →
            </Link>
          )}
        </VStack>
      </Box>
    );
  }

  return (
    <VStack align="stretch" gap={2}>
      {selectedIds.length > 0 && (
        <VStack align="stretch" gap={1}>
          {selectedIds.map((id, i) => {
            const option = byId.get(id);
            const label = option ? formatLabel(option) : null;
            return (
              <HStack
                key={`${id}-${i}`}
                borderWidth="1px"
                borderColor={option ? "border.muted" : "red.300"}
                borderRadius="sm"
                paddingX={2}
                paddingY={1}
                gap={2}
                backgroundColor={option ? "bg.subtle" : "red.50"}
              >
                <Text fontSize="xs" color="fg.muted" minWidth="20px">
                  {i + 1}.
                </Text>
                <VStack align="start" gap={0} flex={1} minWidth={0}>
                  <Text fontSize="sm" fontWeight="medium">
                    {label ?? "Unknown credential"}
                  </Text>
                  <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                    {id}
                  </Text>
                  {option?.disabledAt && (
                    <Text fontSize="xs" color="orange.600">
                      Disabled - requests will skip this credential
                    </Text>
                  )}
                </VStack>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => swap(i, i - 1)}
                  disabled={i === 0}
                  aria-label="Move up"
                >
                  <ArrowUp size={12} />
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => swap(i, i + 1)}
                  disabled={i === selectedIds.length - 1}
                  aria-label="Move down"
                >
                  <ArrowDown size={12} />
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => removeAt(i)}
                  aria-label="Remove"
                >
                  <X size={12} />
                </Button>
              </HStack>
            );
          })}
        </VStack>
      )}
      {remaining.length > 0 ? (
        <NativeSelect.Root size="sm">
          <NativeSelect.Field
            value=""
            aria-label="Add model provider"
            onChange={(e) => {
              const value = e.target.value;
              if (value) {
                addById(value);
                e.target.value = "";
              }
            }}
          >
            <option value="">+ Add model provider…</option>
            {remaining.map((option) => (
              <option key={option.id} value={option.id}>
                {formatLabel(option)}
                {option.disabledAt ? " - disabled" : ""}
              </option>
            ))}
          </NativeSelect.Field>
        </NativeSelect.Root>
      ) : (
        <Text fontSize="xs" color="fg.muted">
          All configured model providers are in this policy.
        </Text>
      )}
    </VStack>
  );
}

function RoutingPolicyDrawer({
  open,
  composer,
  setComposer,
  mode,
  isPending,
  availableCredentials,
  credentialsLoading,
  modelProvidersAdminPath,
  errorMessage,
  onClearError,
  onSubmit,
  onCancel,
  organizationId,
  organizationName,
  availableTeams,
  availableProjects,
  resolveScopeEntriesWithNames,
}: {
  open: boolean;
  composer: ComposerState | null;
  setComposer: (next: ComposerState | null) => void;
  mode: "create" | "edit";
  isPending: boolean;
  availableCredentials: ProviderCredentialOption[];
  credentialsLoading: boolean;
  modelProvidersAdminPath: string | null;
  errorMessage: string | null;
  onClearError: () => void;
  onSubmit: () => void;
  onCancel: () => void;
  organizationId: string | undefined;
  organizationName?: string;
  availableTeams: Array<{ id: string; name: string }>;
  availableProjects: Array<{ id: string; name: string; teamId?: string }>;
  resolveScopeEntriesWithNames: (
    scopes: ScopeTriadEntry[],
  ) => ScopeTriadEntry[];
}) {
  const submitDisabled =
    !composer ||
    !composer.name.trim() ||
    composer.scopes.length === 0 ||
    composer.modelProviderIds.length === 0 ||
    isPending;

  return (
    <Drawer.Root
      open={open}
      onOpenChange={({ open: next }) => {
        if (!next) onCancel();
      }}
      placement="end"
      size="md"
    >
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>
            {mode === "create" ? "New routing policy" : "Edit routing policy"}
          </Drawer.Title>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          {composer && (
            <VStack align="stretch" gap={4}>
              <Field.Root required>
                <Field.Label>Scopes</Field.Label>
                {mode === "create" ? (
                  <ScopeChipPicker
                    value={composer.scopes}
                    onChange={(next) =>
                      setComposer({ ...composer, scopes: next })
                    }
                    organizationId={organizationId}
                    organizationName={organizationName}
                    availableTeams={availableTeams}
                    availableProjects={availableProjects}
                    label=""
                  />
                ) : (
                  <>
                    <ProviderScopeChips
                      scopes={resolveScopeEntriesWithNames(composer.scopes)}
                    />
                    <Field.HelperText>
                      Scope is fixed after create. Delete and recreate to
                      change which org / team / project this policy
                      applies to.
                    </Field.HelperText>
                  </>
                )}
              </Field.Root>

              <Field.Root required>
                <Field.Label>Name</Field.Label>
                <Input
                  value={composer.name}
                  onChange={(e) =>
                    setComposer({ ...composer, name: e.target.value })
                  }
                  placeholder="e.g. developer-default"
                  autoFocus
                />
              </Field.Root>

              <Field.Root required>
                <Field.Label>Strategy</Field.Label>
                <NativeSelect.Root size="sm">
                  <NativeSelect.Field
                    value={composer.strategy}
                    onChange={(e) =>
                      setComposer({
                        ...composer,
                        strategy: e.target.value as Strategy,
                      })
                    }
                  >
                    {STRATEGY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </NativeSelect.Field>
                </NativeSelect.Root>
              </Field.Root>

              <Field.Root>
                <Field.Label>Description</Field.Label>
                <Textarea
                  rows={2}
                  value={composer.description}
                  onChange={(e) =>
                    setComposer({ ...composer, description: e.target.value })
                  }
                  placeholder="What this policy is for"
                />
              </Field.Root>

              <Field.Root required>
                <Field.Label>
                  Model Providers (ordered)
                  <FieldInfoTooltip
                    description="Ordered list of the org's model providers. The gateway tries #1 first; on 5xx, timeout, rate-limit, or circuit-breaker the next item in the list takes over. Re-order with the ↑/↓ arrows on each row to set fallback priority."
                    docHref="/ai-gateway/governance/routing-policies"
                  />
                </Field.Label>
                <ProviderCredentialPicker
                  selectedIds={composer.modelProviderIds}
                  onChange={(next) =>
                    setComposer({ ...composer, modelProviderIds: next })
                  }
                  available={availableCredentials}
                  loading={credentialsLoading}
                  modelProvidersAdminPath={modelProvidersAdminPath}
                />
                <Field.HelperText>
                  First match wins. Use ↑/↓ to set fallback priority.
                </Field.HelperText>
              </Field.Root>

              <Field.Root>
                <Field.Label>Model allowlist (globs)</Field.Label>
                <ChipListEditor
                  values={composer.modelAllowlist}
                  onChange={(next) =>
                    setComposer({ ...composer, modelAllowlist: next })
                  }
                  placeholder="claude-*"
                  ordered={false}
                  inputAriaLabel="Add model allowlist glob"
                />
                <Field.HelperText>
                  Empty = no restriction. Globs match against the requested model name.
                </Field.HelperText>
              </Field.Root>

              <Separator />
              <HStack>
                <Text fontSize="sm" fontWeight="semibold">
                  Model aliases
                </Text>
                <FieldInfoTooltip
                  description="Rewrite the model name a client requests before it reaches the provider. Useful for mapping 'gpt-4o' -> 'gpt-4o-mini' for cost control, or fanning one logical model across providers."
                  docHref="/ai-gateway/model-aliases"
                />
              </HStack>
              <Text fontSize="xs" color="fg.muted">
                Per-policy alias rewrite. Applied to the model field before
                dispatch.
              </Text>
              <VStack align="stretch" gap={2}>
                {composer.aliases.map((pair, idx) => (
                  <HStack key={idx}>
                    <Input
                      placeholder="from (e.g. gpt-4o)"
                      size="sm"
                      value={pair.from}
                      onChange={(e) =>
                        setComposer({
                          ...composer,
                          aliases: composer.aliases.map((p, i) =>
                            i === idx ? { ...p, from: e.target.value } : p,
                          ),
                        })
                      }
                    />
                    <Text>{"->"}</Text>
                    <Input
                      placeholder="to (e.g. gpt-4o-mini)"
                      size="sm"
                      value={pair.to}
                      onChange={(e) =>
                        setComposer({
                          ...composer,
                          aliases: composer.aliases.map((p, i) =>
                            i === idx ? { ...p, to: e.target.value } : p,
                          ),
                        })
                      }
                    />
                    <IconButton
                      aria-label="Remove alias"
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        setComposer({
                          ...composer,
                          aliases: composer.aliases.filter(
                            (_, i) => i !== idx,
                          ),
                        })
                      }
                    >
                      <Trash2 size={12} />
                    </IconButton>
                  </HStack>
                ))}
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    setComposer({
                      ...composer,
                      aliases: [
                        ...composer.aliases,
                        { from: "", to: "" },
                      ],
                    })
                  }
                >
                  <Plus size={12} /> Add alias
                </Button>
              </VStack>

              <Separator />
              <HStack>
                <Text fontSize="sm" fontWeight="semibold">
                  Policy rules
                </Text>
                <FieldInfoTooltip
                  description="RE2 regex deny/allow lists across 4 dimensions: tools, MCP servers, URLs, models. Enforced pre-dispatch (zero provider cost). Deny wins."
                  docHref="/ai-gateway/policy-rules"
                />
              </HStack>
              <Text fontSize="xs" color="fg.muted">
                One pattern per line. Broken regex returns 503 fail-closed
                (never silent bypass).
              </Text>
              {(["tools", "mcp", "urls", "models"] as PolicyDim[]).map(
                (dim) => (
                  <Box key={dim}>
                    <Text fontSize="sm" fontWeight="medium" mb={1}>
                      {POLICY_DIM_META[dim].label}
                    </Text>
                    <Text fontSize="xs" color="fg.muted" mb={2}>
                      {POLICY_DIM_META[dim].helper}
                    </Text>
                    <HStack gap={3} align="flex-start">
                      <Field.Root flex={1}>
                        <Field.Label fontSize="xs">Deny</Field.Label>
                        <Textarea
                          value={composer.policyRules[dim].deny}
                          onChange={(e) =>
                            setComposer({
                              ...composer,
                              policyRules: {
                                ...composer.policyRules,
                                [dim]: {
                                  ...composer.policyRules[dim],
                                  deny: e.target.value,
                                },
                              },
                            })
                          }
                          placeholder={POLICY_DIM_META[dim].placeholderDeny}
                          rows={3}
                          fontFamily="mono"
                          fontSize="xs"
                        />
                      </Field.Root>
                      <Field.Root flex={1}>
                        <Field.Label fontSize="xs">
                          Allow (optional)
                        </Field.Label>
                        <Textarea
                          value={composer.policyRules[dim].allow}
                          onChange={(e) =>
                            setComposer({
                              ...composer,
                              policyRules: {
                                ...composer.policyRules,
                                [dim]: {
                                  ...composer.policyRules[dim],
                                  allow: e.target.value,
                                },
                              },
                            })
                          }
                          placeholder="leave blank = no allowlist"
                          rows={3}
                          fontFamily="mono"
                          fontSize="xs"
                        />
                      </Field.Root>
                    </HStack>
                  </Box>
                ),
              )}

              <Checkbox
                checked={composer.isDefault}
                onChange={(e) =>
                  setComposer({
                    ...composer,
                    isDefault: e.target.checked,
                  })
                }
              >
                <Text fontSize="sm">Set as default for this scope</Text>
              </Checkbox>
            </VStack>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <VStack align="stretch" gap={3} width="full">
            {errorMessage && (
              <Box
                borderWidth="1px"
                borderColor="red.300"
                borderRadius="md"
                backgroundColor="red.50"
                padding={3}
              >
                <HStack alignItems="start" gap={2}>
                  <Box color="red.600" paddingTop="2px">
                    <X size={14} />
                  </Box>
                  <VStack align="start" gap={0} flex={1} minWidth={0}>
                    <Text fontSize="xs" fontWeight="semibold" color="red.700">
                      {mode === "create"
                        ? "Couldn't create the policy"
                        : "Couldn't save the policy"}
                    </Text>
                    <Text fontSize="xs" color="red.700">
                      {errorMessage}
                    </Text>
                  </VStack>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={onClearError}
                    aria-label="Dismiss error"
                  >
                    <X size={12} />
                  </Button>
                </HStack>
              </Box>
            )}
            <HStack gap={2} width="full" justifyContent="flex-end">
              <Button variant="ghost" onClick={onCancel} disabled={isPending}>
                Cancel
              </Button>
              <Button
                onClick={onSubmit}
                loading={isPending}
                disabled={submitDisabled}
              >
                {mode === "create" ? "Create policy" : "Save changes"}
              </Button>
            </HStack>
          </VStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(withPermissionGuard("organization:manage", {})(RoutingPoliciesPage));
