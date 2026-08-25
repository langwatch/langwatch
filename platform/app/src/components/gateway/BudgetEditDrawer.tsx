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
} from "@chakra-ui/react";
import { useEffect, useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

type BudgetRow = {
  id: string;
  name: string;
  description: string | null;
  scopeType: string;
  scopeTarget?: { name: string } | null;
  providerLabel?: string | null;
  window: string;
  limitUsd: string;
  onBreach: "BLOCK" | "WARN";
};

type BudgetEditDrawerProps = {
  budget: BudgetRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

export function BudgetEditDrawer({
  budget,
  onOpenChange,
  onSaved,
}: BudgetEditDrawerProps) {
  const { organization } = useOrganizationTeamProject();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [limitUsd, setLimitUsd] = useState("");
  const [onBreach, setOnBreach] = useState<"BLOCK" | "WARN">("BLOCK");
  // Names one input, so it lives on that input. See BudgetCreateDrawer.
  const [limitError, setLimitError] = useState<string | null>(null);

  useEffect(() => {
    if (budget) {
      setName(budget.name);
      setDescription(budget.description ?? "");
      setLimitUsd(budget.limitUsd);
      setOnBreach(budget.onBreach);
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
    setLimitError(null);
    const parsed = Number.parseFloat(limitUsd);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setLimitError("Enter a positive amount, like 1000.00.");
      return;
    }
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
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field.Root>
            <Field.Root>
              <Field.Label>Description</Field.Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Applies to</Field.Label>
              <Text fontSize="sm" color="fg.muted">
                {budget?.scopeType === "GROUP"
                  ? "group"
                  : budget?.scopeType.toLowerCase().replace("_", " ")}
                {budget?.scopeTarget?.name ? `, ${budget.scopeTarget.name}` : ""}
                {budget?.providerLabel ? `, ${budget.providerLabel} only` : ""} (immutable
                after create)
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
                value={limitUsd}
                onChange={(e) => {
                  setLimitUsd(e.target.value);
                  setLimitError(null);
                }}
                inputMode="decimal"
              />
              {limitError && <Field.ErrorText>{limitError}</Field.ErrorText>}
              <Field.HelperText>
                Raising the limit does not reset the window. Lowering it may cause the
                budget to enter breach immediately if current spend already exceeds the
                new value.
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
            <Button variant="ghost" onClick={close} disabled={updateMutation.isPending}>
              Cancel
            </Button>
            <Button
              colorPalette="orange"
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
