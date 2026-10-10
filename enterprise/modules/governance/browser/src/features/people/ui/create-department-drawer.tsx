// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { useDrawer } from "@langwatch/browser-host/drawer";
import { Drawer } from "@langwatch/design-system/drawer";
import { Button, Field, HStack, Input, Spacer, VStack } from "@langwatch/design-system/primitives";
import { useRef, useState } from "react";

import { api } from "../../../behavior/governance-api.ts";
import { useGovernanceToaster, useShowErrorToast } from "../../../behavior/governance-feedback.ts";
import { useGovernanceScope } from "../../../behavior/governance-session.ts";
import { PermissionRequiredNotice } from "../../../ui/elements/permission-required-notice.tsx";

/**
 * Creating a department, as the routed drawer `addDepartment`: the People page navigates to it
 * (`?drawer.open=addDepartment`) and mounts nothing itself, so it also opens from a pasted address.
 * A reader without `governance:manage` who lands on it is told which grant it needs.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 */
export function CreateDepartmentDrawer() {
  const { closeDrawer } = useDrawer();
  const { organization, hasAnyPermission } = useGovernanceScope();
  const organizationId = organization?.id ?? "";
  const canManage = hasAnyPermission("governance:manage");
  const showErrorToast = useShowErrorToast();
  const toaster = useGovernanceToaster();
  const utils = api.useUtils();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  const createMutation = api.departments.create.useMutation();

  const close = () => {
    if (createMutation.isPending) return;
    closeDrawer();
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
      await utils.departments.list.invalidate({ organizationId });
      closeDrawer();
    } catch (error) {
      showErrorToast({
        error,
        fallbackTitle: "Couldn't create the department",
      });
    }
  };

  return (
    <Drawer.Root
      open
      onOpenChange={({ open: isOpen }) => {
        if (!isOpen) close();
      }}
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
          {!canManage ? (
            <PermissionRequiredNotice
              permission="governance:manage"
              detail="Creating a department needs this grant."
            />
          ) : (
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
          )}
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full">
            <Spacer />
            <Button variant="ghost" onClick={close} disabled={createMutation.isPending}>
              Cancel
            </Button>
            {canManage ? (
              <Button
                colorPalette="orange"
                onClick={() => void submit()}
                loading={createMutation.isPending}
              >
                Create
              </Button>
            ) : null}
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
