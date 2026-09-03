/**
 * The create/edit form for a custom role.
 *
 * Moved from `platform/app/src/components/settings/RoleFormDialog.tsx`. Two
 * substitutions, both precedented and both worth naming:
 *
 * - `Dialog` is the Design System's, not `~/components/ui/dialog`. The platform
 *   wrapper adds an inline error boundary around the body and stands
 *   `trapFocus` and `preventScroll` down; a package may reach for none of that.
 *   Ten package dialogs already made this substitution, so it is precedent
 *   rather than a decision — but it IS a behaviour difference, and the ops
 *   family's warning to diff before substituting is why it is written here.
 * - The permission type is `AuthzPermission` throughout rather than the
 *   `Permission` alias re-exported from `~/server/api/rbac`. They were the same
 *   type; only one of them is reachable from a browser package.
 */

import { Button, Field, Heading, Input, Separator, Text, Textarea, VStack } from "@chakra-ui/react";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { Dialog } from "@langwatch/design-system/dialog";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { PermissionSelector } from "../blocks/permission-selector";

export type RoleFormData = {
  name: string;
  description: string;
  permissions: AuthzPermission[];
};

export function RoleFormDialog({
  open,
  onClose,
  onSubmit,
  initialData,
  title,
  submitLabel = "Create Role",
  isSubmitting = false,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: RoleFormData) => Promise<void> | void;
  initialData?: RoleFormData;
  title: string;
  submitLabel?: string;
  isSubmitting?: boolean;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
    setValue,
    watch,
  } = useForm<RoleFormData>({
    defaultValues: {
      name: initialData?.name ?? "",
      description: initialData?.description ?? "",
      permissions: initialData?.permissions ?? [],
    },
  });

  const selectedPermissions = watch("permissions") ?? [];

  // The dialog is mounted once and reused, so the form is refilled when the
  // role it is editing changes — and emptied when it is opened to create one.
  useEffect(() => {
    if (initialData) {
      setValue("name", initialData.name);
      setValue("description", initialData.description);
      setValue("permissions", initialData.permissions);
    } else {
      reset({ name: "", description: "", permissions: [] });
    }
  }, [initialData, setValue, reset]);

  const handleFormSubmit = handleSubmit(async (data) => {
    await onSubmit(data);
    if (!initialData) reset();
  });

  return (
    <Dialog.Root open={open} onOpenChange={({ open: isOpen }) => !isOpen && onClose()}>
      <Dialog.Content bg="bg" maxWidth="900px" maxHeight="90vh" overflowY="auto">
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <form id="role-form" onSubmit={(event) => void handleFormSubmit(event)}>
            <VStack gap={6} align="start">
              <Field.Root invalid={!!errors.name}>
                <Field.Label>
                  Role Name{" "}
                  <Text as="span" color="red.500">
                    *
                  </Text>
                </Field.Label>
                <Input
                  {...register("name", { required: "Role name is required" })}
                  placeholder="e.g., Data Analyst"
                />
                {errors.name && <Field.ErrorText>{errors.name.message}</Field.ErrorText>}
              </Field.Root>

              <Field.Root>
                <Field.Label>Description</Field.Label>
                <Field.HelperText>Describe what this role is for</Field.HelperText>
                <Textarea
                  {...register("description")}
                  placeholder="e.g., Can view and analyze data but cannot modify settings"
                  rows={3}
                />
              </Field.Root>

              <Separator />

              <VStack align="start" width="full" gap={4}>
                <Heading size="sm">Permissions</Heading>
                <Text fontSize="sm" color="fg.muted">
                  Select the permissions this role should have
                </Text>

                <PermissionSelector
                  selectedPermissions={selectedPermissions}
                  onChange={(permissions) => setValue("permissions", permissions)}
                />
              </VStack>
            </VStack>
          </form>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="role-form" colorPalette="orange" loading={isSubmitting}>
            {submitLabel}
          </Button>
        </Dialog.Footer>
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}
