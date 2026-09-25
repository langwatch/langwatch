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
import { Drawer } from "@langwatch/design-system/drawer";
import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import { type Instant, Temporal, currentTimeZone } from "@langwatch/time";
import { Boxes, Building2, Folder, KeyRound, User, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../../../../behavior/gateway-api.ts";
import { useGatewayToaster } from "../../../../behavior/gateway-feedback.ts";
import { useOrganizationTeamProject } from "../../../../behavior/gateway-session.ts";
import { describeError } from "../../../../model/describe-error.ts";
import { humanizeGatewayError } from "../../../../model/gateway-error-copy.ts";
import type { GatewayTeam } from "../../../../model/gateway-host.ts";
import { readHandledError } from "../../../../model/handled-error.ts";

/**
 * A budget on an unreachable scope is refused: it would never spend or
 * block. Provisioning ahead of the keys that will use it is legitimate,
 * so the refusal offers a way through instead of a dead end.
 */
const UNREACHABLE_SCOPE_CODE = "gateway_budget_scope_unreachable";

type BudgetCreateDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

type ScopeKind = "ORGANIZATION" | "GROUP" | "TEAM" | "PROJECT" | "PRINCIPAL" | "VIRTUAL_KEY";
type Window = "MINUTE" | "HOUR" | "DAY" | "WEEK" | "MONTH" | "TOTAL" | "MANUAL";

const KIND_OPTIONS: {
  kind: ScopeKind;
  label: string;
  icon: React.ReactElement;
}[] = [
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

type TargetOption = { id: string; name: string };

function targetOptionsFor({
  scopeKind,
  groups,
  teams,
  projects,
  members,
  keys,
}: {
  scopeKind: Exclude<ScopeKind, "ORGANIZATION">;
  groups: readonly { id: string; name: string; memberCount: number }[];
  teams: TargetOption[];
  projects: TargetOption[];
  members: readonly { id: string; name?: string | null; email?: string | null }[];
  keys: TargetOption[];
}): TargetOption[] {
  switch (scopeKind) {
    case "GROUP":
      return groups.map((g) => ({
        id: g.id,
        name: g.memberCount === 1 ? `${g.name} (1 member)` : `${g.name} (${g.memberCount} members)`,
      }));
    case "TEAM":
      return teams;
    case "PROJECT":
      return projects;
    case "PRINCIPAL":
      return members.map((m) => ({
        id: m.id,
        name: m.name ?? m.email ?? m.id,
      }));
    case "VIRTUAL_KEY":
      return keys.map((k) => ({ id: k.id, name: k.name }));
  }
}

function budgetScope({
  scopeKind,
  organizationId,
  targetId,
}: {
  scopeKind: ScopeKind;
  organizationId: string;
  targetId: string;
}) {
  switch (scopeKind) {
    case "ORGANIZATION":
      return { kind: "ORGANIZATION" as const, organizationId };
    case "GROUP":
      return { kind: "GROUP" as const, groupId: targetId };
    case "TEAM":
      return { kind: "TEAM" as const, teamId: targetId };
    case "PROJECT":
      return { kind: "PROJECT" as const, projectId: targetId };
    case "PRINCIPAL":
      return { kind: "PRINCIPAL" as const, principalUserId: targetId };
    case "VIRTUAL_KEY":
      return { kind: "VIRTUAL_KEY" as const, virtualKeyId: targetId };
  }
}

function projectOptionsOf(teams: readonly GatewayTeam[]): { id: string; name: string }[] {
  return teams.flatMap((t) => t.projects.map((p) => ({ id: p.id, name: `${p.name} · ${t.name}` })));
}

function providerOptionsOf(
  providers: readonly { id?: string | null; name?: string | null; provider: string }[],
): { id: string; name: string }[] {
  return providers.filter((p) => p.id).map((p) => ({ id: p.id!, name: p.name ?? p.provider }));
}

function targetsLoadingFor(input: {
  scopeKind: ScopeKind;
  groupsLoading: boolean;
  membersLoading: boolean;
  keysLoading: boolean;
}): boolean {
  return (
    (input.scopeKind === "GROUP" && input.groupsLoading) ||
    (input.scopeKind === "PRINCIPAL" && input.membersLoading) ||
    (input.scopeKind === "VIRTUAL_KEY" && input.keysLoading)
  );
}

/** Why the name and limit cannot be sent yet, as the toast says it, or null when they can. */
function limitRefusal({ name, limitUsd }: { name: string; limitUsd: string }): string | null {
  if (!name || !limitUsd) return "Name and limit are required";
  const parsed = Number.parseFloat(limitUsd);
  if (!Number.isFinite(parsed) || parsed <= 0) return "Limit must be a positive number";
  return null;
}

/** The picker's zoneless wall-clock time, read in the browser's zone the admin typed it in. */
function cycleAnchorInstant(input: {
  isScheduledWindow: boolean;
  cycleAnchorAt: string;
}): Instant | null {
  if (!input.isScheduledWindow || !input.cycleAnchorAt) return null;
  return Temporal.PlainDateTime.from(input.cycleAnchorAt)
    .toZonedDateTime(currentTimeZone())
    .toInstant();
}

/** A refused create: an unreachable scope offers the retry, anything else reads as a failure. */
function createFailure(error: unknown): { unreachable: boolean; message: string } {
  if (readHandledError(error)?.code === UNREACHABLE_SCOPE_CODE) {
    return { unreachable: true, message: describeError({ error }) };
  }
  return { unreachable: false, message: humanizeGatewayError(error, "Failed to create budget") };
}

export function BudgetCreateDrawer({ open, onOpenChange, onCreated }: BudgetCreateDrawerProps) {
  const toaster = useGatewayToaster();
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
    () => projectOptionsOf(organization?.teams ?? []),
    [organization?.teams],
  );
  const activeKeys = useMemo(
    () => (keysQuery.data ?? []).filter((k) => k.status === "active"),
    [keysQuery.data],
  );
  const providerOptions = useMemo(
    () => providerOptionsOf(providersQuery.data ?? []),
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
   * The refusal was about the scope that was picked; the retry beside it
   * resubmits with `allowUnreachable` set. Cleared on a scope change, or the
   * button would wave through a scope the server never refused.
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

  const targetOptions: { id: string; name: string }[] | null =
    scopeKind === "ORGANIZATION"
      ? null
      : targetOptionsFor({
          scopeKind,
          groups: groupsQuery.data ?? [],
          teams,
          projects,
          members: membersQuery.data ?? [],
          keys: activeKeys,
        });

  const targetsLoading = targetsLoadingFor({
    scopeKind,
    groupsLoading: groupsQuery.isLoading,
    membersLoading: membersQuery.isLoading,
    keysLoading: keysQuery.isLoading,
  });

  const submit = async ({ allowUnreachable = false } = {}) => {
    if (!organization) return;
    const refusal = limitRefusal({ name, limitUsd });
    if (refusal) {
      toaster.create({ title: refusal, type: "error" });
      return;
    }
    if (scopeKind !== "ORGANIZATION" && !targetId) {
      setSubmitError("Pick what this budget applies to.");
      return;
    }
    setSubmitError(null);
    try {
      const scope = budgetScope({ scopeKind, organizationId: organization.id, targetId });
      await createMutation.mutateAsync({
        organizationId: organization.id,
        name,
        description: description || undefined,
        scope,
        window,
        limitUsd,
        onBreach,
        providerKey: providerKey || null,
        // The picker gives a local wall-clock string with no zone, read in
        // the browser's zone, which is the one the admin typed it in.
        cycleAnchorAt: cycleAnchorInstant({ isScheduledWindow, cycleAnchorAt }),
        allowUnreachable: allowUnreachable || undefined,
      });
      onCreated();
      reset();
      onOpenChange(false);
    } catch (error) {
      const failure = createFailure(error);
      setScopeUnreachable(failure.unreachable);
      setSubmitError(failure.message);
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
              <Wrap
                as="fieldset"
                gap={2}
                border={0}
                margin={0}
                padding={0}
                minWidth={0}
                aria-label="Budget target kind"
              >
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
                            KIND_OPTIONS.find((o) => o.kind === scopeKind)?.label.toLowerCase() ??
                            "target"
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
                <Field.ErrorText data-testid="budget-submit-error">{submitError}</Field.ErrorText>
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
                  onChange={(e) => setOnBreach((e.target.value as "BLOCK" | "WARN") ?? "BLOCK")}
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
