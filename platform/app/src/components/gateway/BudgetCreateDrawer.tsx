import {
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Text,
  Textarea,
  VStack,
  Wrap,
} from "@chakra-ui/react";
import { Boxes, Building2, Folder, KeyRound, User, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import { toaster } from "~/components/ui/toaster";
import { describeError, readHandledError } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import { humanizeGatewayError } from "./gatewayErrorCopy";

/**
 * A budget on a scope no active key can reach is refused, because it would
 * never spend and never block. Provisioning one ahead of the keys that will
 * use it is legitimate, so the refusal offers the way through instead of
 * being a dead end. Offered here rather than as a checkbox on the form: an
 * admin who has not hit the refusal has no way to know what it would mean.
 */
const UNREACHABLE_SCOPE_CODE = "gateway_budget_scope_unreachable";

type BudgetCreateDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

type ScopeKind =
  | "ORGANIZATION"
  | "GROUP"
  | "TEAM"
  | "PROJECT"
  | "PRINCIPAL"
  | "VIRTUAL_KEY";
type Window = "MINUTE" | "HOUR" | "DAY" | "WEEK" | "MONTH" | "TOTAL" | "MANUAL";

const KIND_OPTIONS: Array<{
  kind: ScopeKind;
  label: string;
  icon: React.ReactElement;
}> = [
  {
    kind: "ORGANIZATION",
    label: "Organization",
    icon: <Building2 size={14} aria-hidden />,
  },
  { kind: "GROUP", label: "Group", icon: <Boxes size={14} aria-hidden /> },
  { kind: "TEAM", label: "Team", icon: <Users size={14} aria-hidden /> },
  { kind: "PROJECT", label: "Project", icon: <Folder size={14} aria-hidden /> },
  { kind: "PRINCIPAL", label: "Member", icon: <User size={14} aria-hidden /> },
  {
    kind: "VIRTUAL_KEY",
    label: "Virtual key",
    icon: <KeyRound size={14} aria-hidden />,
  },
];

export function BudgetCreateDrawer({
  open,
  onOpenChange,
  onCreated,
}: BudgetCreateDrawerProps) {
  const { project, team, organization } = useOrganizationTeamProject();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopeKind, setScopeKind] = useState<ScopeKind>("PROJECT");
  const [targetId, setTargetId] = useState<string>("");
  const [providerKey, setProviderKey] = useState<string>("");
  const [window, setWindow] = useState<Window>("MONTH");
  const [limitUsd, setLimitUsd] = useState("");
  const [onBreach, setOnBreach] = useState<"BLOCK" | "WARN">("BLOCK");
  const [cycleAnchorAt, setCycleAnchorAt] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** Set once the server has refused this budget as unreachable. */
  const [scopeUnreachable, setScopeUnreachable] = useState(false);

  // Only a window that rolls on its own can be phased. Total never rolls
  // and manual rolls only when someone asks it to, so neither offers the
  // field, and the server refuses an anchor on either.
  const isScheduledWindow = window !== "TOTAL" && window !== "MANUAL";

  const orgId = organization?.id ?? "";

  const membersQuery = api.organization.getAllOrganizationMembers.useQuery(
    { organizationId: orgId },
    {
      enabled: !!orgId && open && scopeKind === "PRINCIPAL",
      refetchOnWindowFocus: false,
    },
  );
  // GROUP budgets target Group rows (the entity SCIM provisions and
  // GroupMembership fans budgets out over) and say "Group" like the rest
  // of the product; the org-chart Department table is a different entity
  // with no gateway budget scope.
  const groupsQuery = api.gatewayBudgets.groupTargets.useQuery(
    { organizationId: orgId },
    {
      enabled: !!orgId && open && scopeKind === "GROUP",
      refetchOnWindowFocus: false,
      retry: false,
    },
  );
  const keysQuery = api.virtualKeys.list.useQuery(
    { organizationId: orgId },
    {
      enabled: !!orgId && open && scopeKind === "VIRTUAL_KEY",
      refetchOnWindowFocus: false,
    },
  );
  const providersQuery = api.modelProvider.listAllForOrganizationForFrontend.useQuery(
    { organizationId: orgId },
    { enabled: !!orgId && open, refetchOnWindowFocus: false },
  );

  const teams = useMemo(
    () => organization?.teams?.map((t) => ({ id: t.id, name: t.name })) ?? [],
    [organization?.teams],
  );
  const projects = useMemo(
    () =>
      organization?.teams?.flatMap((t) =>
        t.projects.map((p) => ({ id: p.id, name: `${p.name} · ${t.name}` })),
      ) ?? [],
    [organization?.teams],
  );
  const activeKeys = useMemo(
    () => (keysQuery.data ?? []).filter((k) => k.status === "active"),
    [keysQuery.data],
  );
  const providerOptions = useMemo(
    () =>
      (providersQuery.data?.providers ?? [])
        .filter((p) => p.id)
        .map((p) => ({ id: p.id!, name: p.name ?? p.provider })),
    [providersQuery.data],
  );

  const utils = api.useUtils();
  const createMutation = api.gatewayBudgets.create.useMutation({
    onSuccess: async () => {
      await Promise.all([
        organization
          ? utils.gatewayBudgets.list.invalidate({
              organizationId: organization.id,
            })
          : Promise.resolve(),
        project
          ? utils.gatewayBudgets.listForProject.invalidate({
              projectId: project.id,
            })
          : Promise.resolve(),
      ]);
    },
  });

  const reset = () => {
    setName("");
    setDescription("");
    setScopeKind("PROJECT");
    setTargetId("");
    setProviderKey("");
    setWindow("MONTH");
    setLimitUsd("");
    setOnBreach("BLOCK");
    setCycleAnchorAt("");
    setSubmitError(null);
    setScopeUnreachable(false);
  };

  const close = () => {
    if (createMutation.isPending) return;
    reset();
    onOpenChange(false);
  };

  /**
   * The refusal was about the scope that was picked, and the retry beside it
   * resubmits the form as it stands with `allowUnreachable` set. Left behind
   * after a different scope is picked, that button would wave through a
   * scope the server never refused.
   */
  const clearRefusal = () => {
    setSubmitError(null);
    setScopeUnreachable(false);
  };

  const pickKind = (kind: ScopeKind) => {
    setScopeKind(kind);
    clearRefusal();
    // Seed the target with the current context where one exists.
    if (kind === "TEAM") setTargetId(team?.id ?? "");
    else if (kind === "PROJECT") setTargetId(project?.id ?? "");
    else setTargetId("");
  };

  const pickTarget = (id: string) => {
    setTargetId(id);
    clearRefusal();
  };

  const targetOptions: Array<{ id: string; name: string }> | null =
    scopeKind === "ORGANIZATION"
      ? null
      : scopeKind === "GROUP"
        ? (groupsQuery.data ?? []).map((g) => ({
            id: g.id,
            name:
              g.memberCount === 1
                ? `${g.name} (1 member)`
                : `${g.name} (${g.memberCount} members)`,
          }))
        : scopeKind === "TEAM"
          ? teams
          : scopeKind === "PROJECT"
            ? projects
            : scopeKind === "PRINCIPAL"
              ? (membersQuery.data ?? []).map((m) => ({
                  id: m.id,
                  name: m.name ?? m.email ?? m.id,
                }))
              : activeKeys.map((k) => ({ id: k.id, name: k.name }));

  const targetsLoading =
    (scopeKind === "GROUP" && groupsQuery.isLoading) ||
    (scopeKind === "PRINCIPAL" && membersQuery.isLoading) ||
    (scopeKind === "VIRTUAL_KEY" && keysQuery.isLoading);

  const submit = async ({ allowUnreachable = false } = {}) => {
    if (!organization) return;
    if (!name || !limitUsd) {
      toaster.create({ title: "Name and limit are required", type: "error" });
      return;
    }
    const parsed = Number.parseFloat(limitUsd);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toaster.create({
        title: "Limit must be a positive number",
        type: "error",
      });
      return;
    }
    if (scopeKind !== "ORGANIZATION" && !targetId) {
      setSubmitError("Pick what this budget applies to.");
      return;
    }
    setSubmitError(null);
    try {
      const scope =
        scopeKind === "ORGANIZATION"
          ? { kind: "ORGANIZATION" as const, organizationId: organization.id }
          : scopeKind === "GROUP"
            ? { kind: "GROUP" as const, groupId: targetId }
            : scopeKind === "TEAM"
              ? { kind: "TEAM" as const, teamId: targetId }
              : scopeKind === "PROJECT"
                ? { kind: "PROJECT" as const, projectId: targetId }
                : scopeKind === "PRINCIPAL"
                  ? { kind: "PRINCIPAL" as const, principalUserId: targetId }
                  : { kind: "VIRTUAL_KEY" as const, virtualKeyId: targetId };
      await createMutation.mutateAsync({
        organizationId: organization.id,
        name,
        description: description || undefined,
        scope,
        window,
        limitUsd,
        onBreach,
        providerKey: providerKey || null,
        // The picker gives a local wall-clock string with no zone; the
        // Date constructor reads it in the browser's zone, which is the
        // one the admin typed it in.
        cycleAnchorAt:
          isScheduledWindow && cycleAnchorAt ? new Date(cycleAnchorAt) : null,
        allowUnreachable: allowUnreachable || undefined,
      });
      onCreated();
      reset();
      onOpenChange(false);
    } catch (error) {
      if (readHandledError(error)?.code === UNREACHABLE_SCOPE_CODE) {
        setScopeUnreachable(true);
        setSubmitError(describeError({ error }));
        return;
      }
      setScopeUnreachable(false);
      setSubmitError(humanizeGatewayError(error, "Failed to create budget"));
    }
  };

  return (
    <Drawer.Root open={open} onOpenChange={() => close()} placement="end" size="md">
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.Title>New budget</Drawer.Title>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={4}>
            <Field.Root required>
              <Field.Label>
                Name
                <FieldInfoTooltip
                  description="Human-readable identifier shown in the list and audit log. Typical patterns: 'org monthly cap', 'acme-eng daily', 'prod-vk-burst'."
                  docHref="/ai-gateway/budgets#creating-a-budget"
                />
              </Field.Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Engineering monthly $1k cap"
                autoFocus
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Description</Field.Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional. Who owns this? What's the policy?"
              />
            </Field.Root>

            <Field.Root required>
              <Field.Label>
                Applies to
                <FieldInfoTooltip
                  description="What the budget covers. Budgets stack: a request is checked against every budget that applies to it (organization + group + team + project + member + virtual key), and any one in breach blocks or warns per its on-breach action. A group budget gives each member their own allowance rather than one shared pot."
                  docHref="/ai-gateway/budgets#scopes"
                  testId="budget-applies-to-info"
                />
              </Field.Label>
              <Wrap gap={2} role="group" aria-label="Budget target kind">
                {KIND_OPTIONS.map((o) => {
                  const active = scopeKind === o.kind;
                  return (
                    <Button
                      key={o.kind}
                      type="button"
                      size="xs"
                      variant={active ? "solid" : "outline"}
                      aria-pressed={active}
                      onClick={() => pickKind(o.kind)}
                      data-testid={`budget-kind-${o.kind.toLowerCase()}`}
                    >
                      <HStack gap={1}>
                        {o.icon}
                        <Text>{o.label}</Text>
                      </HStack>
                    </Button>
                  );
                })}
              </Wrap>
              {scopeKind === "ORGANIZATION" ? (
                <Text fontSize="xs" color="fg.muted" marginTop={1}>
                  All AI spend in {organization?.name ?? "the organization"}.
                </Text>
              ) : (
                <NativeSelect.Root size="sm" marginTop={1} disabled={targetsLoading}>
                  <NativeSelect.Field
                    value={targetId}
                    aria-label="Budget target"
                    data-testid="budget-target"
                    onChange={(e) => pickTarget(e.target.value)}
                  >
                    <option value="">
                      {targetsLoading
                        ? "Loading…"
                        : `Pick a ${
                            KIND_OPTIONS.find(
                              (o) => o.kind === scopeKind,
                            )?.label.toLowerCase() ?? "target"
                          }`}
                    </option>
                    {(targetOptions ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </NativeSelect.Field>
                </NativeSelect.Root>
              )}
              {scopeKind === "GROUP" && (
                <Text fontSize="xs" color="fg.muted" marginTop={1}>
                  Each member of the group gets this limit individually.
                </Text>
              )}
              {scopeKind === "GROUP" && groupsQuery.isError && (
                <Text fontSize="xs" color="red.600" marginTop={1}>
                  Groups could not be loaded.
                </Text>
              )}
            </Field.Root>

            <Field.Root>
              <Field.Label>
                Provider
                <FieldInfoTooltip
                  description="Count and constrain spend on one provider only, e.g. 'OpenAI $200/month for this team'. With a provider set, only requests dispatched to that provider debit this budget, and on breach only that provider is withheld; others keep serving."
                  docHref="/ai-gateway/budgets#provider-filter"
                  testId="budget-provider-info"
                />
              </Field.Label>
              <NativeSelect.Root size="sm">
                <NativeSelect.Field
                  value={providerKey}
                  aria-label="Provider filter"
                  data-testid="budget-provider"
                  onChange={(e) => setProviderKey(e.target.value)}
                >
                  <option value="">All providers</option>
                  {providerOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} only
                    </option>
                  ))}
                </NativeSelect.Field>
              </NativeSelect.Root>
            </Field.Root>

            {submitError && (
              <Field.Root invalid>
                <Field.ErrorText data-testid="budget-submit-error">
                  {submitError}
                </Field.ErrorText>
                {scopeUnreachable && (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    alignSelf="flex-start"
                    mt={2}
                    loading={createMutation.isPending}
                    onClick={() => void submit({ allowUnreachable: true })}
                    data-testid="budget-create-anyway"
                  >
                    Create it anyway
                  </Button>
                )}
              </Field.Root>
            )}
            <HStack gap={4} align="flex-start">
              <Field.Root required flex={1}>
                <Field.Label>
                  Window
                  <FieldInfoTooltip
                    description="Time window the limit applies to. Minute / hour / day / week / month reset on a rolling schedule, calendar aligned in UTC unless you set a cycle start below. 'total' never resets, which suits burn-down budgets on a fixed-fund project. 'manual' accrues until someone resets it."
                    docHref="/ai-gateway/budgets#windows"
                  />
                </Field.Label>
                <NativeSelect.Root size="sm">
                  <NativeSelect.Field
                    value={window}
                    onChange={(e) => setWindow((e.target.value as Window) ?? "MONTH")}
                  >
                    <option value="MINUTE">Per minute</option>
                    <option value="HOUR">Per hour</option>
                    <option value="DAY">Per day</option>
                    <option value="WEEK">Per week</option>
                    <option value="MONTH">Per calendar month</option>
                    <option value="TOTAL">Total (no reset)</option>
                    <option value="MANUAL">Manual (reset on request)</option>
                  </NativeSelect.Field>
                </NativeSelect.Root>
              </Field.Root>
              <Field.Root required flex={1}>
                <Field.Label>
                  Limit (USD)
                  <FieldInfoTooltip
                    description="Spend ceiling per window in USD, tracked against the cost each provider reports for the request. Responses carry a warning from 80% of the cap, and past it the on-breach action applies."
                    docHref="/ai-gateway/budgets#creating-a-budget"
                  />
                </Field.Label>
                <Input
                  value={limitUsd}
                  onChange={(e) => setLimitUsd(e.target.value)}
                  placeholder="1000.00"
                  inputMode="decimal"
                />
              </Field.Root>
            </HStack>
            {isScheduledWindow && (
              <Field.Root>
                <Field.Label>
                  Start cycle on
                  <FieldInfoTooltip
                    description="Optional. Leave empty and the window is calendar aligned, so a monthly budget rolls on the 1st. Set it and the window rolls from this moment instead, which is how you line a budget up with a billing date: anchored on the 17th at 09:00, every period starts on the 17th at 09:00. A monthly cycle anchored past the 28th clamps into shorter months and springs back, so the 31st gives Feb 28 and then Mar 31. This cannot be changed later."
                    docHref="/ai-gateway/budgets#windows"
                    testId="budget-cycle-anchor-info"
                  />
                </Field.Label>
                <Input
                  type="datetime-local"
                  value={cycleAnchorAt}
                  onChange={(e) => setCycleAnchorAt(e.target.value)}
                  data-testid="budget-cycle-anchor"
                />
              </Field.Root>
            )}
            <Field.Root required>
              <Field.Label>
                On breach
                <FieldInfoTooltip
                  description="BLOCK: reject new requests with 402 budget_exceeded. WARN: trace annotation only, no user-facing error, which suits soft budgets where ops monitors spend without enforcing a hard cap."
                  docHref="/ai-gateway/budgets#on_breach"
                />
              </Field.Label>
              <NativeSelect.Root size="sm">
                <NativeSelect.Field
                  value={onBreach}
                  onChange={(e) =>
                    setOnBreach((e.target.value as "BLOCK" | "WARN") ?? "BLOCK")
                  }
                >
                  <option value="BLOCK">Block: reject requests at limit</option>
                  <option value="WARN">Warn: tag responses, keep serving</option>
                </NativeSelect.Field>
              </NativeSelect.Root>
            </Field.Root>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button variant="ghost" onClick={close} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button
              colorPalette="orange"
              onClick={() => void submit()}
              loading={createMutation.isPending}
              disabled={!name || !limitUsd}
            >
              Create budget
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
