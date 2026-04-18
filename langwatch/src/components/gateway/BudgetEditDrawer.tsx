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
import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

type BudgetRow = {
  id: string;
  name: string;
  description: string | null;
  scopeType: string;
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

  useEffect(() => {
    if (budget) {
      setName(budget.name);
      setDescription(budget.description ?? "");
      setLimitUsd(budget.limitUsd);
      setOnBreach(budget.onBreach);
    }
  }, [budget]);

  const utils = api.useContext();
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
    const parsed = Number.parseFloat(limitUsd);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toaster.create({ title: "Limit must be a positive number", type: "error" });
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
      toaster.create({
        title: error instanceof Error ? error.message : "Failed to update budget",
        type: "error",
      });
    }
  };

  return (
    <Drawer.Root
      open={!!budget}
      onOpenChange={() => close()}
      placement="end"
      size="md"
    >
      <Drawer.Content>
        <Drawer.Header>
          <HStack width="full">
            <Drawer.Title>Edit budget</Drawer.Title>
            <Spacer />
            <Button
              variant="ghost"
              size="sm"
              onClick={close}
              disabled={updateMutation.isPending}
              aria-label="Close"
            >
              <X size={16} />
            </Button>
          </HStack>
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={4}>
            <Field.Root required>
              <Field.Label>Name</Field.Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Description</Field.Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Scope</Field.Label>
              <Text fontSize="sm" color="fg.muted">
                {budget?.scopeType.toLowerCase()} (immutable after create)
              </Text>
            </Field.Root>
            <Field.Root>
              <Field.Label>Window</Field.Label>
              <Text fontSize="sm" color="fg.muted">
                {budget?.window.toLowerCase()} (immutable after create)
              </Text>
            </Field.Root>
            <Field.Root required>
              <Field.Label>Limit (USD)</Field.Label>
              <Input
                value={limitUsd}
                onChange={(e) => setLimitUsd(e.target.value)}
                inputMode="decimal"
              />
              <Field.HelperText>
                Raising the limit does not reset the window. Lowering it may
                cause the budget to enter breach immediately if current spend
                already exceeds the new value.
              </Field.HelperText>
            </Field.Root>
            <Field.Root required>
              <Field.Label>On breach</Field.Label>
              <NativeSelect.Root size="sm">
                <NativeSelect.Field
                  value={onBreach}
                  onChange={(e) =>
                    setOnBreach(
                      (e.target.value as "BLOCK" | "WARN") ?? "BLOCK",
                    )
                  }
                >
                  <option value="BLOCK">
                    Block — reject requests at limit
                  </option>
                  <option value="WARN">
                    Warn — tag responses, keep serving
                  </option>
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
              disabled={updateMutation.isPending}
            >
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
