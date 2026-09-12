// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Button, createListCollection, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";

import { Dialog } from "@langwatch/design-system/dialog";
import { Select } from "@langwatch/design-system/select";

import {
  useGovernanceToaster,
  useShowErrorToast,
} from "../../../behavior/governance-feedback.ts";
import { api } from "../../../behavior/governance-api.ts";

const UNASSIGNED = "__unassigned__";

/**
 * Assigning a department to the member behind a row, without leaving the
 * page. The picker is a plain `Select` rather than a `FilterChip` — a
 * department list is unbounded, and a menu pill cannot hold a hundred of them
 * (the rulebook's own carve-out).
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 * Spec: specs/ai-governance/dashboard/governance-ui-controls.feature
 */
export function AssignDepartmentDialog({
  orgId,
  personName,
  userId,
  currentDepartmentId,
  departments,
  open,
  onClose,
  onAssigned,
}: {
  orgId: string;
  personName: string;
  /** `null` closes the dialog: there is no member to assign. */
  userId: string | null;
  currentDepartmentId: string | null;
  departments: ReadonlyArray<{ id: string; name: string }>;
  open: boolean;
  onClose: () => void;
  onAssigned: () => Promise<void>;
}) {
  const showErrorToast = useShowErrorToast();
  const toaster = useGovernanceToaster();
  const [selected, setSelected] = useState<string | null>(currentDepartmentId);

  const assignMutation = api.departments.assignUser.useMutation({
    onSuccess: async () => {
      toaster.create({ title: "Department assigned", type: "success" });
      onClose();
      await onAssigned();
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't assign the department",
      }),
  });

  const collection = createListCollection({
    items: [
      { label: "Unassigned", value: UNASSIGNED },
      ...departments.map((department) => ({
        label: department.name,
        value: department.id,
      })),
    ],
  });

  return (
    <Dialog.Root
      open={open && userId !== null}
      onOpenChange={(event) => {
        if (!event.open) onClose();
      }}
      size="sm"
    >
      <Dialog.Content bg="bg">
        <Dialog.Header>
          <Dialog.Title>Assign department</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body paddingBottom={6}>
          <VStack align="stretch" gap={3}>
            <Text fontSize="sm" color="fg.muted">
              {personName}'s spend, including personal AI use, rolls up to the
              department you pick.
            </Text>
            <Select.Root
              collection={collection}
              value={[selected ?? UNASSIGNED]}
              onValueChange={(event) => {
                const next = event.value[0];
                setSelected(next === UNASSIGNED ? null : (next ?? null));
              }}
              size="sm"
            >
              <Select.Trigger aria-label="Department">
                <Select.ValueText placeholder="Unassigned" />
              </Select.Trigger>
              <Select.Content>
                {collection.items.map((item) => (
                  <Select.Item key={item.value} item={item}>
                    {item.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            size="sm"
            loading={assignMutation.isPending}
            onClick={() => {
              if (!userId) return;
              assignMutation.mutate({
                organizationId: orgId,
                userId,
                departmentId: selected,
              });
            }}
          >
            Save
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
