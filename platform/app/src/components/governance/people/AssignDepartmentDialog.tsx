import { Button, createListCollection, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";

import { Dialog } from "~/components/ui/dialog";
import { Select } from "~/components/ui/select";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";

const UNASSIGNED = "__unassigned__";

/**
 * Assigning a department to the member behind a row, without leaving the page.
 *
 * The picker is the app's own select rather than a `FilterChip`, and that is
 * the rulebook's own carve-out: a department list is unbounded — a tenant can
 * have a hundred — and a menu pill reading "Department · …" cannot hold them.
 * It is still not a native `<select>`; Ark's select renders a button and a
 * listbox, styled by us, in both themes.
 *
 * Only offered for a row whose account we know: assignment writes against a
 * member, and a discovered person nothing has linked has no member to write to.
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
