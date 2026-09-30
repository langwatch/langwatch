// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Button, Field, HStack, Input, Spacer, VStack } from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/drawer";
import { useRef, useState } from "react";

import { api } from "../../../behavior/governance-api.ts";
import { useGovernanceToaster, useShowErrorToast } from "../../../behavior/governance-feedback.ts";

/**
 * Creating a department from the People page's header button.
 *
 * Main's People page opened this from a URL-routed drawer singleton
 * (`openDrawer("addDepartment")` plus a `?add=1` deep link) that this branch
 * has no host for — see the merge handoff. Local open/close state instead,
 * matching `DepartmentEditDrawer`'s own pattern.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 */
export function CreateDepartmentDrawer({
  organizationId,
  open,
  onOpenChange,
  onCreated,
}: {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
}) {
  const showErrorToast = useShowErrorToast();
  const toaster = useGovernanceToaster();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  const createMutation = api.departments.create.useMutation();

  const close = () => {
    if (createMutation.isPending) return;
    onOpenChange(false);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Give the department a name.");
      return;
    }
    try {
      await createMutation.mutateAsync({ organizationId, name: trimmed });
      toaster.create({ title: "Department created", type: "success" });
      setName("");
      await onCreated();
      onOpenChange(false);
    } catch (error) {
      showErrorToast({
        error,
        fallbackTitle: "Couldn't create the department",
      });
    }
  };

  return (
    <Drawer.Root
      open={open}
      onOpenChange={() => close()}
      placement="end"
      size="md"
      initialFocusEl={() => nameInputRef.current}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Drawer.Title>Add department</Drawer.Title>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={4}>
            <Field.Root invalid={nameError !== null} required>
              <Field.Label>Department name</Field.Label>
              <Input
                ref={nameInputRef}
                aria-label="Department name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
                placeholder="Engineering"
              />
              <Field.HelperText>
                Spend rolls up by department, including personal AI use.
              </Field.HelperText>
              <Field.ErrorText>{nameError}</Field.ErrorText>
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
            >
              Create
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
