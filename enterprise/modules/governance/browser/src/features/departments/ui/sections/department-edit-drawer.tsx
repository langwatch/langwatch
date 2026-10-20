import { Drawer } from "@langwatch/design-system/drawer";
import { Field, Input, VStack } from "@langwatch/design-system/primitives";
import { useEffect, useState } from "react";

import { api } from "../../../../behavior/governance-api.ts";
import {
  useGovernanceToaster,
  useShowErrorToast,
} from "../../../../behavior/governance-feedback.ts";
type DepartmentRow = { id: string; name: string };

export function DepartmentEditDrawer({
  organizationId,
  department,
  onOpenChange,
  onSaved,
}: {
  organizationId: string;
  department: DepartmentRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const showErrorToast = useShowErrorToast();
  const toaster = useGovernanceToaster();
  const [name, setName] = useState("");

  useEffect(() => {
    if (department) {
      setName(department.name);
    }
  }, [department]);

  const renameMutation = api.departments.rename.useMutation();

  const close = () => {
    if (renameMutation.isPending) return;
    onOpenChange(false);
  };

  const submit = async () => {
    if (!department) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toaster.create({ title: "Name is required", type: "error" });
      return;
    }
    try {
      await renameMutation.mutateAsync({
        organizationId,
        id: department.id,
        name: trimmed,
      });
      toaster.create({ title: "Department renamed", type: "success" });
      onSaved();
      onOpenChange(false);
    } catch (error) {
      showErrorToast({
        error,
        fallbackTitle: "Couldn't rename the department",
      });
    }
  };

  let saveBlockedReason: string | undefined;
  if (!name.trim()) saveBlockedReason = "Enter a name";
  else if (name.trim() === department?.name) saveBlockedReason = "Change the name to save";
  return (
    <Drawer
      open={!!department}
      onClose={close}
      size="md"
      title="Edit department"
      busy={renameMutation.isPending}
      onSubmit={() => void submit()}
      footer={{
        cancel: { onClick: close },
        primaryAction: {
          label: "Save changes",
          type: "submit",
          loading: renameMutation.isPending,
          disabledReason: saveBlockedReason,
        },
      }}
    >
      <VStack align="stretch" gap={4}>
        <Field.Root required>
          <Field.Label>Name</Field.Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field.Root>
      </VStack>
    </Drawer>
  );
}
