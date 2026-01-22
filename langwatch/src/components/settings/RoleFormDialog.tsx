import {
  Button,
  Field,
  Heading,
  Input,
  Separator,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import type { Permission } from "../../server/api/rbac";
import { Dialog } from "../ui/dialog";
import { PermissionSelector } from "./PermissionSelector";

type RoleFormData = {
  name: string;
  description: string;
  permissions: Permission[];
};

/**
 * RoleFormDialog component
 *
 * Single Responsibility: Provides a reusable form dialog for creating and editing roles
 */
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
  initialData?: {
    name: string;
    description: string;
    permissions: Permission[];
  };
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

  const selectedPermissions = watch("permissions") || [];

  // Update form when initialData changes
  useEffect(() => {
    if (initialData) {
      setValue("name", initialData.name);
      setValue("description", initialData.description);
      setValue("permissions", initialData.permissions);
    } else {
      reset({
        name: "",
        description: "",
        permissions: [],
      });
    }
  }, [initialData, setValue, reset]);

  const handleFormSubmit = handleSubmit(async (data) => {
    await onSubmit(data);
    if (!initialData) {
      reset();
    }
  });

  return (
    <Dialog.Root open={open} onOpenChange={({ open }) => !open && onClose()}>
      <Dialog.Content maxWidth="900px" maxHeight="90vh" overflowY="auto">
        <Dialog.Header>
          <Dialog.Title>{title}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <form id="role-form" onSubmit={(e) => void handleFormSubmit(e)}>
            <VStack gap={6} align="start">
              <Field.Root invalid={!!errors.name}>
                <Field.Label>
                  Role Name{" "}
                  <Text as="span" color="red.500">
                    *
                  </Text>
                </Field.Label>
                <Input
                  {...register("name", {
                    required: "Role name is required",
                  })}
                  placeholder="e.g., Data Analyst"
                />
                {errors.name && (
                  <Field.ErrorText>{errors.name.message}</Field.ErrorText>
                )}
              </Field.Root>

              <Field.Root>
                <Field.Label>Description</Field.Label>
                <Field.HelperText>
                  Describe what this role is for
                </Field.HelperText>
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
                  onChange={(permissions) =>
                    setValue("permissions", permissions)
                  }
                />
              </VStack>
            </VStack>
          </form>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="role-form"
            colorPalette="orange"
            loading={isSubmitting}
          >
            {submitLabel}
          </Button>
        </Dialog.Footer>
        <Dialog.CloseTrigger />
      </Dialog.Content>
    </Dialog.Root>
  );
}
