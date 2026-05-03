import {
  Button,
  Field,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

import { FieldInfoTooltip } from "./FieldInfoTooltip";
import { api } from "~/utils/api";

type BudgetCreateDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

type ScopeKind = "ORGANIZATION" | "TEAM" | "PROJECT" | "PRINCIPAL";
type Window = "MINUTE" | "HOUR" | "DAY" | "WEEK" | "MONTH" | "TOTAL";

export function BudgetCreateDrawer({
  open,
  onOpenChange,
  onCreated,
}: BudgetCreateDrawerProps) {
  const { project, team, organization } = useOrganizationTeamProject();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scopeKind, setScopeKind] = useState<ScopeKind>("PROJECT");
  const [principalUserId, setPrincipalUserId] = useState("");
  const [window, setWindow] = useState<Window>("MONTH");
  const [limitUsd, setLimitUsd] = useState("");
  const [onBreach, setOnBreach] = useState<"BLOCK" | "WARN">("BLOCK");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const membersQuery = api.organization.getAllOrganizationMembers.useQuery(
    { organizationId: organization?.id ?? "" },
    {
      enabled: !!organization?.id && scopeKind === "PRINCIPAL",
      refetchOnWindowFocus: false,
    },
  );

  const utils = api.useContext();
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
    setPrincipalUserId("");
    setWindow("MONTH");
    setLimitUsd("");
    setOnBreach("BLOCK");
    setSubmitError(null);
  };

  const close = () => {
    if (createMutation.isPending) return;
    reset();
    onOpenChange(false);
  };

  const submit = async () => {
    if (!organization) return;
    if (!name || !limitUsd) {
      toaster.create({ title: "Name and limit are required", type: "error" });
      return;
    }
    const parsed = Number.parseFloat(limitUsd);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toaster.create({ title: "Limit must be a positive number", type: "error" });
      return;
    }
    setSubmitError(null);
    try {
      if (scopeKind === "TEAM" && !team?.id) {
        toaster.create({ title: "Team scope requires a team", type: "error" });
        return;
      }
      if (scopeKind === "PROJECT" && !project?.id) {
        toaster.create({ title: "Project scope requires a project", type: "error" });
        return;
      }
      if (scopeKind === "PRINCIPAL" && !principalUserId) {
        setSubmitError("Pick a member to bind this principal-scope budget to.");
        return;
      }
      const scope =
        scopeKind === "ORGANIZATION"
          ? { kind: "ORGANIZATION" as const, organizationId: organization.id }
          : scopeKind === "TEAM"
          ? { kind: "TEAM" as const, teamId: team?.id ?? "" }
          : scopeKind === "PROJECT"
          ? { kind: "PROJECT" as const, projectId: project?.id ?? "" }
          : { kind: "PRINCIPAL" as const, principalUserId };
      await createMutation.mutateAsync({
        organizationId: organization.id,
        name,
        description: description || undefined,
        scope,
        window,
        limitUsd,
        onBreach,
      });
      onCreated();
      reset();
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create budget";
      // Cross-org guard + missing-member errors are inline-actionable; other
      // failures get a toast so the user knows something happened.
      if (scopeKind === "PRINCIPAL") {
        setSubmitError(message);
      } else {
        toaster.create({ title: message, type: "error" });
      }
    }
  };

  return (
    <Drawer.Root
      open={open}
      onOpenChange={() => close()}
      placement="end"
      size="md"
    >
      <Drawer.Content>
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
                placeholder="e.g. Engineering — monthly $1k cap"
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
                Scope
                <FieldInfoTooltip
                  description="Which resource the budget covers. Budgets are hierarchical — a request is checked against every budget that applies (org + team + project + virtual-key + principal). Any scope in breach blocks or warns per the on_breach action."
                  docHref="/ai-gateway/budgets#scopes"
                />
              </Field.Label>
              <NativeSelect.Root size="sm">
                <NativeSelect.Field
                  value={scopeKind}
                  onChange={(e) =>
                    setScopeKind((e.target.value as ScopeKind) ?? "PROJECT")
                  }
                >
                  <option value="ORGANIZATION">
                    Organization — all AI spend
                  </option>
                  <option value="TEAM">Team — {team?.name ?? "current"}</option>
                  <option value="PROJECT">
                    Project — {project?.name ?? "current"}
                  </option>
                  <option value="PRINCIPAL">
                    Principal — single org member
                  </option>
                </NativeSelect.Field>
              </NativeSelect.Root>
              <Field.HelperText>
                Virtual-key scope is configured from each VK's detail page.
              </Field.HelperText>
            </Field.Root>
            {scopeKind === "PRINCIPAL" && (
              <Field.Root required>
                <Field.Label>
                  Member
                  <FieldInfoTooltip
                    description="Bind the budget to one organization member. Their AI spend across every project + virtual key in this org counts toward this cap. Cross-org users are rejected by the backend guard."
                    docHref="/ai-gateway/budgets#principal-scope"
                  />
                </Field.Label>
                <NativeSelect.Root
                  size="sm"
                  disabled={membersQuery.isLoading}
                >
                  <NativeSelect.Field
                    value={principalUserId}
                    onChange={(e) => setPrincipalUserId(e.target.value)}
                  >
                    <option value="">
                      {membersQuery.isLoading
                        ? "Loading members…"
                        : "Pick a member"}
                    </option>
                    {(membersQuery.data ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name ?? m.email ?? m.id}
                      </option>
                    ))}
                  </NativeSelect.Field>
                </NativeSelect.Root>
              </Field.Root>
            )}
            {submitError && (
              <Field.Root invalid>
                <Field.ErrorText>{submitError}</Field.ErrorText>
              </Field.Root>
            )}
            <HStack gap={4} align="flex-start">
              <Field.Root required flex={1}>
                <Field.Label>
                  Window
                  <FieldInfoTooltip
                    description="Time window the limit applies to. Minute / hour / day / week / month reset on a rolling schedule in the budget's timezone. 'total' never resets — useful for burn-down budgets on a fixed-fund project."
                    docHref="/ai-gateway/budgets#windows"
                  />
                </Field.Label>
                <NativeSelect.Root size="sm">
                  <NativeSelect.Field
                    value={window}
                    onChange={(e) =>
                      setWindow((e.target.value as Window) ?? "MONTH")
                    }
                  >
                    <option value="MINUTE">Per minute</option>
                    <option value="HOUR">Per hour</option>
                    <option value="DAY">Per day</option>
                    <option value="WEEK">Per week</option>
                    <option value="MONTH">Per calendar month</option>
                    <option value="TOTAL">Total (no reset)</option>
                  </NativeSelect.Field>
                </NativeSelect.Root>
              </Field.Root>
              <Field.Root required flex={1}>
                <Field.Label>
                  Limit (USD)
                  <FieldInfoTooltip
                    description="Spend ceiling per window in USD. Tracked against provider-computed token costs (summed post-response). Near-limit requests (≥90% of cap) trigger a live reconciliation on the gateway with a 200ms fail-open."
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
            <Field.Root required>
              <Field.Label>
                On breach
                <FieldInfoTooltip
                  description="BLOCK: reject new requests with 402 budget_exceeded. WARN: trace annotation only, no user-facing error — useful for soft budgets where ops monitors spend without enforcing a hard cap."
                  docHref="/ai-gateway/budgets#on_breach"
                />
              </Field.Label>
              <NativeSelect.Root size="sm">
                <NativeSelect.Field
                  value={onBreach}
                  onChange={(e) =>
                    setOnBreach(
                      (e.target.value as "BLOCK" | "WARN") ?? "BLOCK",
                    )
                  }
                >
                  <option value="BLOCK">Block — reject requests at limit</option>
                  <option value="WARN">Warn — tag responses, keep serving</option>
                </NativeSelect.Field>
              </NativeSelect.Root>
            </Field.Root>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button
              variant="ghost"
              onClick={close}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              colorPalette="orange"
              onClick={submit}
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
