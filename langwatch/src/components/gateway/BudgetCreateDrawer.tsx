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
import { X } from "lucide-react";
import { useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

type BudgetCreateDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
};

type ScopeKind = "ORGANIZATION" | "TEAM" | "PROJECT";
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
  const [window, setWindow] = useState<Window>("MONTH");
  const [limitUsd, setLimitUsd] = useState("");
  const [onBreach, setOnBreach] = useState<"BLOCK" | "WARN">("BLOCK");

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
    setWindow("MONTH");
    setLimitUsd("");
    setOnBreach("BLOCK");
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
    try {
      const scope =
        scopeKind === "ORGANIZATION"
          ? { kind: "ORGANIZATION" as const, organizationId: organization.id }
          : scopeKind === "TEAM"
          ? { kind: "TEAM" as const, teamId: team?.id ?? "" }
          : { kind: "PROJECT" as const, projectId: project?.id ?? "" };
      if (scopeKind === "TEAM" && !team?.id) {
        toaster.create({ title: "Team scope requires a team", type: "error" });
        return;
      }
      if (scopeKind === "PROJECT" && !project?.id) {
        toaster.create({ title: "Project scope requires a project", type: "error" });
        return;
      }
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
      toaster.create({
        title: error instanceof Error ? error.message : "Failed to create budget",
        type: "error",
      });
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
          <HStack width="full">
            <Drawer.Title>New budget</Drawer.Title>
            <Spacer />
            <Button
              variant="ghost"
              size="sm"
              onClick={close}
              disabled={createMutation.isPending}
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
              <Field.Label>Scope</Field.Label>
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
                </NativeSelect.Field>
              </NativeSelect.Root>
              <Field.HelperText>
                Tighter scopes (virtual key, principal) are configured from
                their own detail pages.
              </Field.HelperText>
            </Field.Root>
            <HStack gap={4} align="flex-start">
              <Field.Root required flex={1}>
                <Field.Label>Window</Field.Label>
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
                <Field.Label>Limit (USD)</Field.Label>
                <Input
                  value={limitUsd}
                  onChange={(e) => setLimitUsd(e.target.value)}
                  placeholder="1000.00"
                  inputMode="decimal"
                />
              </Field.Root>
            </HStack>
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
