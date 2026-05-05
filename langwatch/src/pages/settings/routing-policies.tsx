import {
  Badge,
  Box,
  Button,
  Field,
  Heading,
  HStack,
  Input,
  NativeSelect,
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

import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { LoadingScreen } from "~/components/LoadingScreen";
import { NotFoundScene } from "~/components/NotFoundScene";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { Drawer } from "~/components/ui/drawer";
import { Link } from "~/components/ui/link";
import { toaster } from "~/components/ui/toaster";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
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
  const { organization, project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
  });
  const orgId = organization?.id ?? "";
  // Admin-in-empty-org (org but no project) is exempted from the no-org
  // bouncer for this route — the FF query must resolve on org alone, not
  // gate on project. Project remains a hint for PostHog cohort targeting.
  const { enabled: governancePreviewEnabled, isLoading: ffLoading } =
    useFeatureFlag("release_ui_ai_governance_enabled", {
      projectId: project?.id,
      organizationId: orgId,
      enabled: !!orgId,
    });

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
    providerCredentialIds: string[];
    modelAllowlist: string[];
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

  const startNew = (
    scope: Scope,
    scopeIdDefault: string,
    initialIsDefault = false,
  ) => {
    setEditingId("new");
    setComposer({
      scope,
      scopeId: scopeIdDefault,
      name: "",
      description: "",
      strategy: "priority",
      providerCredentialIds: [],
      modelAllowlist: [],
      isDefault: initialIsDefault,
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
        ? (p.providerCredentialIds as string[])
        : [],
      modelAllowlist: Array.isArray(p.modelAllowlist)
        ? (p.modelAllowlist as string[])
        : [],
      isDefault: p.isDefault,
    });
  };

  const onSubmit = () => {
    if (!composer) return;

    if (editingId === "new") {
      createMutation.mutate({
        organizationId: orgId,
        scope: composer.scope,
        scopeId: composer.scopeId,
        name: composer.name,
        description: composer.description || null,
        providerCredentialIds: composer.providerCredentialIds,
        modelAllowlist:
          composer.modelAllowlist.length > 0 ? composer.modelAllowlist : null,
        strategy: composer.strategy,
        isDefault: composer.isDefault,
      });
    } else if (editingId) {
      updateMutation.mutate({
        organizationId: orgId,
        id: editingId,
        name: composer.name,
        description: composer.description || null,
        providerCredentialIds: composer.providerCredentialIds,
        modelAllowlist:
          composer.modelAllowlist.length > 0 ? composer.modelAllowlist : null,
        strategy: composer.strategy,
      });
    }
  };

  if (ffLoading) {
    return <LoadingScreen />;
  }
  if (!governancePreviewEnabled) {
    return <NotFoundScene />;
  }

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
    <GovernanceLayout pageTitle="Routing Policies · Governance · LangWatch">
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
                  Without an applicable default, {`'langwatch login'`} (and
                  every personal-key issue path) returns 409{" "}
                  <Text as="span" fontFamily="mono">
                    no_default_routing_policy
                  </Text>
                  . Start with an Organization default that points at
                  whichever provider credentials your team should use, then
                  override per-team or per-project as needed.
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
                    href="https://docs.langwatch.ai/ai-gateway/governance/routing-policies"
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
        onSubmit={onSubmit}
        onCancel={() => {
          setEditingId(null);
          setComposer(null);
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

type ComposerState = {
  scope: Scope;
  scopeId: string;
  name: string;
  description: string;
  strategy: Strategy;
  providerCredentialIds: string[];
  modelAllowlist: string[];
  isDefault: boolean;
};

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

const SCOPE_LABEL: Record<Scope, string> = {
  organization: "Organization",
  team: "Team",
  project: "Project",
};

function RoutingPolicyDrawer({
  open,
  composer,
  setComposer,
  mode,
  isPending,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  composer: ComposerState | null;
  setComposer: (next: ComposerState | null) => void;
  mode: "create" | "edit";
  isPending: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const submitDisabled =
    !composer ||
    !composer.name.trim() ||
    !composer.scopeId.trim() ||
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
              <Field.Root>
                <Field.Label>Scope</Field.Label>
                <Text fontSize="sm" color="fg.muted">
                  {SCOPE_LABEL[composer.scope]}
                  {composer.scope !== "organization" && " — locked to this scope"}
                </Text>
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

              {composer.scope !== "organization" && mode === "create" && (
                <Field.Root required>
                  <Field.Label>
                    {composer.scope === "team" ? "Team ID" : "Project ID"}
                  </Field.Label>
                  <Input
                    value={composer.scopeId}
                    onChange={(e) =>
                      setComposer({ ...composer, scopeId: e.target.value })
                    }
                    placeholder={
                      composer.scope === "team" ? "team_..." : "project_..."
                    }
                  />
                </Field.Root>
              )}

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
                <Field.Label>Provider credentials (ordered)</Field.Label>
                <ChipListEditor
                  values={composer.providerCredentialIds}
                  onChange={(next) =>
                    setComposer({ ...composer, providerCredentialIds: next })
                  }
                  placeholder="mp_anthropic"
                  ordered
                  inputAriaLabel="Add provider credential ID"
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
                  borderColor={
                    composer.isDefault ? "blue.500" : "border.emphasis"
                  }
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
            </VStack>
          )}
        </Drawer.Body>
        <Drawer.Footer>
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
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

export default withPermissionGuard("organization:manage", {})(
  RoutingPoliciesPage,
);
