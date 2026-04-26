import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Input,
  Spacer,
  Spinner,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import {
  Pencil,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import SettingsLayout from "~/components/SettingsLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api, type RouterOutputs } from "~/utils/api";

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
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";

  const policiesQuery = api.routingPolicy.list.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId, refetchOnWindowFocus: false },
  );

  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [composer, setComposer] = useState<{
    scope: Scope;
    scopeId: string;
    name: string;
    description: string;
    strategy: Strategy;
    providerCredentialIds: string;
    modelAllowlist: string;
    isDefault: boolean;
  } | null>(null);

  const utils = api.useUtils();
  const refetch = () =>
    utils.routingPolicy.list.invalidate({ organizationId: orgId });

  const createMutation = api.routingPolicy.create.useMutation({
    onSuccess: () => {
      void refetch();
      setEditingId(null);
      setComposer(null);
      toaster.create({ title: "Routing policy created", type: "success" });
    },
    onError: (e) =>
      toaster.create({
        title: "Failed to create policy",
        description: e.message,
        type: "error",
      }),
  });

  const updateMutation = api.routingPolicy.update.useMutation({
    onSuccess: () => {
      void refetch();
      setEditingId(null);
      setComposer(null);
      toaster.create({ title: "Routing policy updated", type: "success" });
    },
    onError: (e) =>
      toaster.create({
        title: "Failed to update policy",
        description: e.message,
        type: "error",
      }),
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
      const s = p.scope as Scope;
      if (out[s]) out[s].push(p);
    }
    return out;
  }, [policiesQuery.data]);

  const startNew = (scope: Scope, scopeIdDefault: string) => {
    setEditingId("new");
    setComposer({
      scope,
      scopeId: scopeIdDefault,
      name: "",
      description: "",
      strategy: "priority",
      providerCredentialIds: "",
      modelAllowlist: "",
      isDefault: false,
    });
  };

  const startEdit = (p: Policy) => {
    setEditingId(p.id);
    setComposer({
      scope: p.scope as Scope,
      scopeId: p.scopeId,
      name: p.name,
      description: p.description ?? "",
      strategy: p.strategy as Strategy,
      providerCredentialIds: Array.isArray(p.providerCredentialIds)
        ? (p.providerCredentialIds as string[]).join(", ")
        : "",
      modelAllowlist: Array.isArray(p.modelAllowlist)
        ? (p.modelAllowlist as string[]).join(", ")
        : "",
      isDefault: p.isDefault,
    });
  };

  const onSubmit = () => {
    if (!composer) return;
    const providerIds = composer.providerCredentialIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const allowlist = composer.modelAllowlist
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (editingId === "new") {
      createMutation.mutate({
        organizationId: orgId,
        scope: composer.scope,
        scopeId: composer.scopeId,
        name: composer.name,
        description: composer.description || null,
        providerCredentialIds: providerIds,
        modelAllowlist: allowlist.length > 0 ? allowlist : null,
        strategy: composer.strategy,
        isDefault: composer.isDefault,
      });
    } else if (editingId) {
      updateMutation.mutate({
        organizationId: orgId,
        id: editingId,
        name: composer.name,
        description: composer.description || null,
        providerCredentialIds: providerIds,
        modelAllowlist: allowlist.length > 0 ? allowlist : null,
        strategy: composer.strategy,
      });
    }
  };

  return (
    <SettingsLayout>
      <VStack align="stretch" gap={6} width="full" maxW="container.xl">
        <HStack alignItems="end">
          <VStack align="start" gap={0}>
            <Heading as="h2" size="lg">
              Routing Policies
            </Heading>
            <Text color="fg.muted" fontSize="sm">
              Define which providers + models personal/team/project keys
              route through. The hierarchy is project → team → organization;
              first match wins.
            </Text>
          </VStack>
          <Spacer />
        </HStack>

        {policiesQuery.isLoading && <Spinner size="sm" />}

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
              {grouped[scope].length === 0 && editingId !== "new" && (
                <Text fontSize="sm" color="fg.muted">
                  No policies defined at this scope.
                </Text>
              )}
              {grouped[scope].map((p) =>
                editingId === p.id ? (
                  <PolicyComposer
                    key={p.id}
                    composer={composer!}
                    setComposer={setComposer}
                    isPending={updateMutation.isPending}
                    onSubmit={onSubmit}
                    onCancel={() => {
                      setEditingId(null);
                      setComposer(null);
                    }}
                    submitLabel="Save changes"
                    lockedScope
                  />
                ) : (
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
                    onDelete={() =>
                      deleteMutation.mutate({
                        organizationId: orgId,
                        id: p.id,
                      })
                    }
                    isPendingSetDefault={
                      setDefaultMutation.isPending &&
                      setDefaultMutation.variables?.id === p.id
                    }
                    isPendingDelete={
                      deleteMutation.isPending &&
                      deleteMutation.variables?.id === p.id
                    }
                  />
                ),
              )}

              {editingId === "new" && composer?.scope === scope && (
                <PolicyComposer
                  composer={composer}
                  setComposer={setComposer}
                  isPending={createMutation.isPending}
                  onSubmit={onSubmit}
                  onCancel={() => {
                    setEditingId(null);
                    setComposer(null);
                  }}
                  submitLabel="Create policy"
                />
              )}
            </VStack>
          </Box>
        ))}
      </VStack>
    </SettingsLayout>
  );
}

function PolicyRow({
  policy,
  onEdit,
  onSetDefault,
  onDelete,
  isPendingSetDefault,
  isPendingDelete,
}: {
  policy: Policy;
  onEdit: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
  isPendingSetDefault: boolean;
  isPendingDelete: boolean;
}) {
  const allowCount = Array.isArray(policy.modelAllowlist)
    ? (policy.modelAllowlist as string[]).length
    : 0;
  const providerCount = Array.isArray(policy.providerCredentialIds)
    ? (policy.providerCredentialIds as string[]).length
    : 0;

  return (
    <HStack
      borderWidth="1px"
      borderColor={policy.isDefault ? "blue.300" : "border.muted"}
      borderRadius="sm"
      padding={3}
      gap={3}
    >
      <VStack align="start" gap={0} flex={1} minWidth={0}>
        <HStack gap={2}>
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

function PolicyComposer({
  composer,
  setComposer,
  isPending,
  onSubmit,
  onCancel,
  submitLabel,
  lockedScope,
}: {
  composer: {
    scope: Scope;
    scopeId: string;
    name: string;
    description: string;
    strategy: Strategy;
    providerCredentialIds: string;
    modelAllowlist: string;
    isDefault: boolean;
  };
  setComposer: (
    next: {
      scope: Scope;
      scopeId: string;
      name: string;
      description: string;
      strategy: Strategy;
      providerCredentialIds: string;
      modelAllowlist: string;
      isDefault: boolean;
    } | null,
  ) => void;
  isPending: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  lockedScope?: boolean;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="blue.300"
      borderRadius="sm"
      padding={3}
      backgroundColor="blue.50"
    >
      <VStack align="stretch" gap={3}>
        <HStack gap={3}>
          <VStack align="stretch" gap={1} flex={1}>
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
              Name
            </Text>
            <Input
              size="sm"
              backgroundColor="white"
              value={composer.name}
              onChange={(e) =>
                setComposer({ ...composer, name: e.target.value })
              }
              placeholder="e.g. developer-default"
            />
          </VStack>
          <VStack align="stretch" gap={1} flex={1}>
            <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
              Strategy
            </Text>
            <select
              value={composer.strategy}
              onChange={(e) =>
                setComposer({
                  ...composer,
                  strategy: e.target.value as Strategy,
                })
              }
              style={{
                padding: "8px",
                border: "1px solid var(--chakra-colors-border-muted)",
                borderRadius: "var(--chakra-radii-sm)",
                background: "white",
                fontSize: "14px",
              }}
            >
              {STRATEGY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </VStack>
          {!lockedScope && composer.scope !== "organization" && (
            <VStack align="stretch" gap={1} flex={1}>
              <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
                {composer.scope === "team" ? "Team ID" : "Project ID"}
              </Text>
              <Input
                size="sm"
                backgroundColor="white"
                value={composer.scopeId}
                onChange={(e) =>
                  setComposer({ ...composer, scopeId: e.target.value })
                }
                placeholder={
                  composer.scope === "team"
                    ? "team_..."
                    : "project_..."
                }
              />
            </VStack>
          )}
        </HStack>

        <VStack align="stretch" gap={1}>
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
            Description
          </Text>
          <Textarea
            size="sm"
            backgroundColor="white"
            rows={2}
            value={composer.description}
            onChange={(e) =>
              setComposer({ ...composer, description: e.target.value })
            }
            placeholder="What this policy is for"
          />
        </VStack>

        <VStack align="stretch" gap={1}>
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
            Provider credential IDs (comma-separated, ordered)
          </Text>
          <Input
            size="sm"
            backgroundColor="white"
            value={composer.providerCredentialIds}
            onChange={(e) =>
              setComposer({
                ...composer,
                providerCredentialIds: e.target.value,
              })
            }
            placeholder="mp_anthropic, mp_openai, mp_gemini"
          />
          <Text fontSize="xs" color="fg.muted">
            (v0 — drag-to-reorder picker comes in a follow-up iteration)
          </Text>
        </VStack>

        <VStack align="stretch" gap={1}>
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
            Model allowlist (comma-separated globs; empty = no restriction)
          </Text>
          <Input
            size="sm"
            backgroundColor="white"
            value={composer.modelAllowlist}
            onChange={(e) =>
              setComposer({ ...composer, modelAllowlist: e.target.value })
            }
            placeholder="claude-*, gpt-5-mini, gemini-2.5-*"
          />
        </VStack>

        <HStack gap={3}>
          <HStack
            cursor="pointer"
            onClick={() =>
              setComposer({ ...composer, isDefault: !composer.isDefault })
            }
            gap={2}
          >
            <Box
              width="16px"
              height="16px"
              borderRadius="sm"
              borderWidth="1px"
              borderColor={composer.isDefault ? "blue.500" : "border.emphasis"}
              backgroundColor={
                composer.isDefault ? "blue.500" : "transparent"
              }
              color="white"
              fontSize="10px"
              display="flex"
              alignItems="center"
              justifyContent="center"
            >
              {composer.isDefault && "✓"}
            </Box>
            <Text fontSize="sm">Set as default for this scope</Text>
          </HStack>
          <Spacer />
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onSubmit}
            loading={isPending}
            disabled={!composer.name.trim() || !composer.scopeId.trim()}
          >
            {submitLabel}
          </Button>
        </HStack>
      </VStack>
    </Box>
  );
}

export default withPermissionGuard("organization:manage", {})(
  RoutingPoliciesPage,
);
