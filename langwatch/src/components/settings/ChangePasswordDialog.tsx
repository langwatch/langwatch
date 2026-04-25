import { Button, Field, HStack, Input, Stack, Text } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Dialog } from "../ui/dialog";
import { toaster } from "../ui/toaster";
import { api } from "../../utils/api";

const buildSchema = (requireCurrent: boolean) =>
  z
    .object({
      currentPassword: requireCurrent
        ? z.string().min(1, "Current password is required")
        : z.string().optional(),
      newPassword: z.string().min(8, "Password must be at least 8 characters"),
      confirmPassword: z
        .string()
        .min(8, "Password must be at least 8 characters"),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: "Passwords don't match",
      path: ["confirmPassword"],
    });

type ChangePasswordFormValues = z.infer<ReturnType<typeof buildSchema>>;

interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * When true, the dialog asks for the current password and sends it to the
   * server. When false (e.g. Auth0 mode), the current-password field is
   * hidden and the server trusts the authenticated session.
   */
  requireCurrentPassword: boolean;
}

export function ChangePasswordDialog({
  open,
  onClose,
  requireCurrentPassword,
}: ChangePasswordDialogProps) {
  const changePasswordMutation = api.user.changePassword.useMutation();
  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(buildSchema(requireCurrentPassword)),
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
      // Only forward `currentPassword` when the server actually needs it
      // (email/credential mode). In Auth0 mode the dialog doesn't render
      // the field; sending an empty string would obscure that and could
      // bite us if the server-side schema is later tightened.
      await changePasswordMutation.mutateAsync({
        ...(requireCurrentPassword
          ? { currentPassword: values.currentPassword }
          : {}),
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
              {requireCurrentPassword && (
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
              )}
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
