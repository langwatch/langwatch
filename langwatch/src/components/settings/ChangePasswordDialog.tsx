import { Button, Field, HStack, Input, Stack, Text } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Dialog } from "../ui/dialog";
import { toaster } from "../ui/toaster";
import { api } from "../../utils/api";

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z
      .string()
      .min(8, "Password must be at least 8 characters"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;

interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ChangePasswordDialog({
  open,
  onClose,
}: ChangePasswordDialogProps) {
  const changePasswordMutation = api.user.changePassword.useMutation();
  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  // Reset the form whenever the dialog is opened so old values from a
  // previous session don't linger.
  useEffect(() => {
    if (open) {
      form.reset({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
    }
  }, [open, form]);

  const onSubmit = async (values: ChangePasswordFormValues) => {
    try {
      await changePasswordMutation.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toaster.create({
        title: "Password changed successfully",
        type: "success",
        meta: { closable: true },
      });
      onClose();
    } catch (error) {
      toaster.create({
        title: "Failed to change password",
        description:
          error instanceof Error ? error.message : "Please try again",
        type: "error",
        meta: { closable: true },
      });
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(details) => {
        if (!details.open) onClose();
      }}
      placement="center"
    >
      <Dialog.Content>
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            Change Password
          </Dialog.Title>
        </Dialog.Header>
        {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <Dialog.Body>
            <Stack gap={4}>
              <Text fontSize="sm" color="fg.muted">
                Password must be at least 8 characters long.
              </Text>
              <Field.Root
                invalid={!!form.formState.errors.currentPassword}
              >
                <Field.Label>Current Password</Field.Label>
                <Input
                  type="password"
                  autoComplete="current-password"
                  {...form.register("currentPassword")}
                />
                {form.formState.errors.currentPassword && (
                  <Field.ErrorText>
                    {form.formState.errors.currentPassword.message}
                  </Field.ErrorText>
                )}
              </Field.Root>
              <Field.Root invalid={!!form.formState.errors.newPassword}>
                <Field.Label>New Password</Field.Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  {...form.register("newPassword")}
                />
                {form.formState.errors.newPassword && (
                  <Field.ErrorText>
                    {form.formState.errors.newPassword.message}
                  </Field.ErrorText>
                )}
              </Field.Root>
              <Field.Root invalid={!!form.formState.errors.confirmPassword}>
                <Field.Label>Confirm New Password</Field.Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  {...form.register("confirmPassword")}
                />
                {form.formState.errors.confirmPassword && (
                  <Field.ErrorText>
                    {form.formState.errors.confirmPassword.message}
                  </Field.ErrorText>
                )}
              </Field.Root>
            </Stack>
          </Dialog.Body>
          <Dialog.Footer>
            <HStack gap={3} justify="end" width="full">
              <Button
                variant="outline"
                onClick={onClose}
                disabled={changePasswordMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                colorPalette="orange"
                disabled={changePasswordMutation.isPending}
                loading={changePasswordMutation.isPending}
              >
                Change Password
              </Button>
            </HStack>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
