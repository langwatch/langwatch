import { Button, Field, Input, VStack } from "@chakra-ui/react";
import { useState } from "react";

import { Dialog } from "~/components/ui/dialog";
import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";

/**
 * Creating a department, as a dialog reached from the header's Add department
 * action.
 *
 * It used to be a bare text box wedged into the tab header beside a solid
 * button, which read as a search field until you typed in it and made a
 * department. A named action opening a dialog with a labelled field says what
 * is about to happen before it happens.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 */
export function AddDepartmentDialog({
  orgId,
  open,
  onClose,
  onCreated,
}: {
  orgId: string;
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");

  const createMutation = api.departments.create.useMutation({
    onSuccess: async () => {
      setName("");
      toaster.create({ title: "Department created", type: "success" });
      onClose();
      await onCreated();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't create department" }),
  });

  const trimmed = name.trim();
  const submit = () => {
    if (!trimmed) return;
    createMutation.mutate({ organizationId: orgId, name: trimmed });
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(event) => {
        if (!event.open) {
          setName("");
          onClose();
        }
      }}
      size="sm"
    >
      <Dialog.Content bg="bg">
        <Dialog.Header>
          <Dialog.Title>Add department</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body paddingBottom={6}>
          <VStack align="stretch" gap={3}>
            <Field.Root>
              <Field.Label>Department name</Field.Label>
              <Input
                autoFocus
                aria-label="Department name"
                placeholder="Engineering"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submit();
                }}
              />
              <Field.HelperText>
                Spend rolls up by department, including personal AI use.
              </Field.HelperText>
            </Field.Root>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            size="sm"
            disabled={!trimmed}
            loading={createMutation.isPending}
            onClick={submit}
          >
            Create
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
