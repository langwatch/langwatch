import { Button, Field, HStack, Input, Stack, Text } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { Controller, type UseFormReturn, useForm } from "react-hook-form";
import { z } from "zod";
import {
  applyHandledErrorToForm,
  FormServerError,
  showErrorToast,
} from "~/features/errors";
import { api } from "../../utils/api";
import { Dialog } from "../ui/dialog";
import { toaster } from "../ui/toaster";

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

/**
 * Binds through `Controller` rather than `{...register(name)}`. `register` is a
 * stable reference, so the React Compiler memoizes the call and the field is
 * never re-registered after a `reset()` — typing then stops reaching form state
 * while the input still shows it. See specs/setup/react-compiler.feature.
 */
function PasswordField({
  form,
  name,
  label,
  autoComplete,
}: {
  form: UseFormReturn<ChangePasswordFormValues>;
  name: keyof ChangePasswordFormValues;
  label: string;
  autoComplete: "current-password" | "new-password";
}) {
  return (
    <Field.Root invalid={!!form.formState.errors[name]}>
      <Field.Label>{label}</Field.Label>
      <Controller
        name={name}
        control={form.control}
        render={({ field }) => (
          <Input
            {...field}
            value={field.value ?? ""}
            type="password"
            autoComplete={autoComplete}
          />
        )}
      />
      {form.formState.errors[name] && (
        <Field.ErrorText>{form.formState.errors[name].message}</Field.ErrorText>
      )}
    </Field.Root>
  );
}

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
      });
      onClose();
    } catch (error) {
      // A rejection that names `currentPassword` or `newPassword` belongs on
      // that input, not in a toast the user reads after they have already
      // looked away. Everything else this mutation raises — the wrong current
      // password, a provider that has no password to change, the attempt
      // throttle — is about the submission as a whole and has no field to
      // land on, so it keeps the toast.
      if (applyHandledErrorToForm({ error, form, hasFormErrorSlot: true })) {
        return;
      }
      showErrorToast({ error, fallbackTitle: "Couldn't change your password" });
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
      <Dialog.Content bg="bg">
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
              {/* The slot `hasFormErrorSlot: true` promises. The two ship
                  together: claiming a form-level rejection without somewhere
                  to render it suppresses the toast and shows nothing, and
                  Save appears to do nothing at all (#3785). */}
              <FormServerError form={form} />
              <Text fontSize="sm" color="fg.muted">
                Password must be at least 8 characters long.
              </Text>
              <PasswordField
                form={form}
                name="currentPassword"
                label="Current Password"
                autoComplete="current-password"
              />
              <PasswordField
                form={form}
                name="newPassword"
                label="New Password"
                autoComplete="new-password"
              />
              <PasswordField
                form={form}
                name="confirmPassword"
                label="Confirm New Password"
                autoComplete="new-password"
              />
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
