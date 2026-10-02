import { Drawer } from "@langwatch/design-system/drawer";
import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
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
} from "@langwatch/design-system/primitives";
import type { GatewayBudgetBreachAction, GatewayBudgetList } from "@langwatch/gateway-contract";
import { useEffect, useState } from "react";

import { api } from "../../../../behavior/gateway-api.ts";
import { useGatewayToaster, useShowErrorToast } from "../../../../behavior/gateway-feedback.ts";
import { useOrganizationTeamProject } from "../../../../behavior/gateway-session.ts";

type BudgetRow = Pick<
  GatewayBudgetList["budgets"][number],
  | "id"
  | "name"
  | "description"
  | "scopeType"
  | "scopeTarget"
  | "providerLabel"
  | "window"
  | "limitUsd"
  | "onBreach"
>;

type BudgetEditDrawerProps = {
  budget: BudgetRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

/** Why the limit is refused, or null when it is a positive amount. */
function limitRefusal(limitUsd: string): string | null {
  const parsed = Number.parseFloat(limitUsd);
  return Number.isFinite(parsed) && parsed > 0 ? null : "Enter a positive amount, like 1000.00.";
}

function scopeSummary(budget: BudgetRow | null): string {
  if (!budget) return "";
  const scope =
    budget.scopeType === "GROUP" ? "group" : budget.scopeType.toLowerCase().replace("_", " ");
  const target = budget.scopeTarget?.name ? `, ${budget.scopeTarget.name}` : "";
  const provider = budget.providerLabel ? `, ${budget.providerLabel} only` : "";
  return `${scope}${target}${provider}`;
}

export function BudgetEditDrawer({ budget, onOpenChange, onSaved }: BudgetEditDrawerProps) {
  const toaster = useGatewayToaster();
  const showErrorToast = useShowErrorToast();
  const { organization } = useOrganizationTeamProject();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [limitUsd, setLimitUsd] = useState("");
  const [onBreach, setOnBreach] = useState<GatewayBudgetBreachAction>("BLOCK");
  // Names one input, so it lives on that input. See BudgetCreateDrawer.
  const [limitError, setLimitError] = useState<string | null>(null);

  useEffect(() => {
    if (budget) {
      setName(budget.name);
      setDescription(budget.description ?? "");
      setLimitUsd(budget.limitUsd);
      setOnBreach(budget.onBreach === "WARN" ? "WARN" : "BLOCK");
      setLimitError(null);
    }
  }, [budget]);

  const utils = api.useUtils();
  const updateMutation = api.gatewayBudgets.update.useMutation({
    onSuccess: async () => {
      if (organization?.id) {
        await utils.gatewayBudgets.list.invalidate({
          organizationId: organization.id,
        });
      }
    },
  });

  const close = () => {
    if (updateMutation.isPending) return;
    onOpenChange(false);
  };

  const submit = async () => {
    if (!budget || !organization) return;
    if (!name || !limitUsd) {
      toaster.create({ title: "Name and limit are required", type: "error" });
      return;
    }
    const refusal = limitRefusal(limitUsd);
    setLimitError(refusal);
    if (refusal) return;
    try {
      await updateMutation.mutateAsync({
        organizationId: organization.id,
        id: budget.id,
        name,
        description: description || null,
        limitUsd,
        onBreach,
      });
      onSaved();
      onOpenChange(false);
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "Couldn't update the budget" });
    }
  };

  return (
    <Drawer.Root open={!!budget} onOpenChange={() => close()} placement="end" size="md">
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.Title>Edit budget</Drawer.Title>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={4}>
            <Field.Root required>
              <Field.Label>
                Name
                <FieldInfoTooltip
                  description="Short identifier shown in /gateway/usage and audit log. Rename is non-breaking; scope and window are immutable below."
                  docHref="/ai-gateway/budgets#creating-a-budget"
                />
              </Field.Label>
              <Input
                data-testid="gateway-budget-edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Description</Field.Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field.Root>
            <Field.Root>
              <Field.Label>Applies to</Field.Label>
              <Text fontSize="sm" color="fg.muted">
                {scopeSummary(budget)} (immutable after create)
              </Text>
              {budget?.scopeType === "GROUP" && (
                <Field.HelperText>
                  Each member of the group gets this limit individually.
                </Field.HelperText>
              )}
            </Field.Root>
            <Field.Root>
              <Field.Label>Window</Field.Label>
              <Text fontSize="sm" color="fg.muted">
                {budget?.window.toLowerCase()} (immutable after create)
              </Text>
            </Field.Root>
            <Field.Root required invalid={!!limitError}>
              <Field.Label>
                Limit (USD)
                <FieldInfoTooltip
                  description="Hard cap for the chosen window. Debits accrue in real time against provider-reported cost. Crossing the cap triggers the on_breach action (BLOCK or WARN)."
                  docHref="/ai-gateway/budgets#creating-a-budget"
                />
              </Field.Label>
              <Input
                data-testid="gateway-budget-edit-limit"
                value={limitUsd}
                onChange={(e) => {
                  setLimitUsd(e.target.value);
                  setLimitError(null);
                }}
                inputMode="decimal"
              />
              {limitError && <Field.ErrorText>{limitError}</Field.ErrorText>}
              <Field.HelperText>
                Raising the limit does not reset the window. Lowering it may cause the budget to
                enter breach immediately if current spend already exceeds the new value.
              </Field.HelperText>
            </Field.Root>
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
                  data-testid="gateway-budget-edit-on-breach"
                  value={onBreach}
                  onChange={(e) => setOnBreach(e.target.value === "WARN" ? "WARN" : "BLOCK")}
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
            <Button variant="ghost" onClick={close} disabled={updateMutation.isPending}>
              Cancel
            </Button>
            <Button
              colorPalette="orange"
              data-testid="gateway-budget-edit-submit"
              onClick={submit}
              loading={updateMutation.isPending}
              disabled={!name || !limitUsd}
            >
              Save changes
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
