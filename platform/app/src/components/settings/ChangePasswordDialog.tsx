import { Button, Field, HStack, Input, Stack, Text } from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  PASSWORD_REQUIREMENTS_HINT,
  passwordProblem,
} from "@langwatch/identity";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  applyHandledErrorToForm,
  FormServerError,
  showErrorToast,
} from "~/features/errors";
import { api } from "../../utils/api";
import { Dialog } from "../ui/dialog";
import { toaster } from "../ui/toaster";

/**
 * The rules come from `@langwatch/identity`, which both mutations behind this
 * dialog read too, so the form cannot accept what the server refuses. Asked as
 * a refinement rather than restated as a `min(8)` for the same reason:
 * restating them is how they drift, and this dialog had drifted — it enforced
 * eight characters of its own while the auth screens enforced the shared policy.
 */
const newPassword = z.string().superRefine((value, ctx) => {
  const problem = passwordProblem(value);
  if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});

const changePasswordSchema = z
  .object({
    // Empty in "set" mode, where there is no current password to prove. The
    // schema stays one shape so the form does; the field is what changes.
    currentPassword: z.string(),
    newPassword,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;

interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * `"set"` for an account that has no password at all — a passkey sign-up or
   * an SSO-only user. There is no current password to ask for, so the field
   * is not shown and the first one is set instead of changed.
   */
  mode?: "change" | "set";
}

export function ChangePasswordDialog({
  open,
  onClose,
  mode = "change",
}: ChangePasswordDialogProps) {
  const isSetting = mode === "set";
  const changePasswordMutation = api.user.changePassword.useMutation();
  const setPasswordMutation = api.user.setPassword.useMutation();
  const apiContext = api.useUtils();
  const pending = isSetting
    ? setPasswordMutation.isPending
    : changePasswordMutation.isPending;

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
      if (isSetting) {
        await setPasswordMutation.mutateAsync({ password: values.newPassword });
        // The page offered "Set a password" off this answer, so it has to be
        // asked again — otherwise the button stays, for something now done.
        await apiContext.user.hasPassword.invalidate();
      } else {
        if (!values.currentPassword) {
          form.setError("currentPassword", {
            message: "Current password is required",
          });
          return;
        }
        await changePasswordMutation.mutateAsync({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        });
      }
      toaster.create({
        title: isSetting ? "Password set" : "Password changed successfully",
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
      showErrorToast({
        error,
        fallbackTitle: isSetting
          ? "Couldn't set your password"
          : "Couldn't change your password",
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
      <Dialog.Content bg="bg">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title fontSize="md" fontWeight="500">
            {isSetting ? "Set a password" : "Change Password"}
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
              {isSetting && (
                <Text fontSize="sm" color="fg.muted">
                  You sign in without a password today. Setting one gives you a
                  second way in, for a browser or a device your passkey provider
                  does not reach.
                </Text>
              )}
              <Text fontSize="sm" color="fg.muted">
                {PASSWORD_REQUIREMENTS_HINT}.
              </Text>
              {!isSetting && (
                <Field.Root invalid={!!form.formState.errors.currentPassword}>
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
                <Field.Label>
                  {isSetting ? "Password" : "New Password"}
                </Field.Label>
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
                <Field.Label>
                  {isSetting ? "Confirm password" : "Confirm New Password"}
                </Field.Label>
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
              <Button variant="outline" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button
                type="submit"
                colorPalette="orange"
                disabled={pending}
                loading={pending}
              >
                {isSetting ? "Set password" : "Change Password"}
              </Button>
            </HStack>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
