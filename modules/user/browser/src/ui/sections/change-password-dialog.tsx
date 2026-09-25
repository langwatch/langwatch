/**
 * Password change dialog (current + new password validation).
 * Rules from identity-contract; field errors on fields.
 */

import { Button, Field, HStack, Input, Stack, Text } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { PASSWORD_REQUIREMENTS_HINT, describePasswordProblem } from "@langwatch/identity-contract";
import { useEffect, useState } from "react";

import { api } from "../../behavior/personal-workspace-api.ts";
import { authoredMessage, fieldProblems, formProblems } from "../../model/handled-error.ts";
import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";

type PasswordFields = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

const EMPTY: PasswordFields = { currentPassword: "", newPassword: "", confirmPassword: "" };

/**
 * What the form itself refuses, before anything is sent: that a current
 * password is present when one is changing, and the two new ones agree —
 * plus `describePasswordProblem`, the server's own rule, called rather than restated.
 */
export function validatePasswordForm(
  values: PasswordFields,
  { isSetting }: { isSetting: boolean },
): Partial<Record<keyof PasswordFields, string>> {
  const problems: Partial<Record<keyof PasswordFields, string>> = {};
  if (!isSetting && !values.currentPassword) {
    problems.currentPassword = "Current password is required";
  }
  const newProblem = describePasswordProblem(values.newPassword);
  if (newProblem) problems.newPassword = newProblem;
  const confirmProblem = describePasswordProblem(values.confirmPassword);
  if (confirmProblem) {
    problems.confirmPassword = confirmProblem;
  } else if (values.newPassword !== values.confirmPassword) {
    problems.confirmPassword = "Passwords don't match";
  }
  return problems;
}

const DIALOG_COPY = {
  set: {
    title: "Set a password",
    newPasswordLabel: "Password",
    confirmLabel: "Confirm password",
    submit: "Set password",
    succeeded: "Password set",
    failed: "Couldn't set your password",
  },
  change: {
    title: "Change Password",
    newPasswordLabel: "New Password",
    confirmLabel: "Confirm New Password",
    submit: "Change Password",
    succeeded: "Password changed successfully",
    failed: "Couldn't change your password",
  },
} as const;

export function ChangePasswordDialog({
  open,
  onClose,
  mode = "change",
}: {
  open: boolean;
  onClose: () => void;
  /**
   * `"set"` for an account that has no password at all — a passkey sign-up or
   * an SSO-only user. There is no current password to ask for, so the field is
   * not shown and the first one is set instead of changed.
   */
  mode?: "change" | "set";
}) {
  const host = usePersonalWorkspaceHost();
  const isSetting = mode === "set";
  const copy = DIALOG_COPY[mode];
  const changePassword = api.user.changePassword.useMutation();
  const setPassword = api.user.setPassword.useMutation();
  const utils = api.useUtils();

  const [values, setValues] = useState<PasswordFields>(EMPTY);
  const [problems, setProblems] = useState<Partial<Record<keyof PasswordFields, string>>>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const pending = isSetting ? setPassword.isPending : changePassword.isPending;

  // Reset whenever the dialog opens, so values typed in a previous attempt do
  // not linger behind a fresh one.
  useEffect(() => {
    if (open) {
      setValues(EMPTY);
      setProblems({});
      setFormErrors([]);
    }
  }, [open]);

  const savePassword = async () => {
    if (!isSetting) {
      await changePassword.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      return;
    }
    await setPassword.mutateAsync({ password: values.newPassword });
    // The section offered "Set a password" off this answer, so it has to be
    // asked again — otherwise the button stays, for something now done.
    await utils.user.hasPassword.invalidate();
  };

  const submit = async () => {
    const found = validatePasswordForm(values, { isSetting });
    setProblems(found);
    setFormErrors([]);
    if (Object.keys(found).length > 0) return;

    try {
      await savePassword();
      host.succeeded({
        title: copy.succeeded,
      });
      onClose();
    } catch (error) {
      // A rejection that names `currentPassword` or `newPassword` belongs on
      // that input, not in a notice the reader sees after they have already
      // looked away. Everything else this mutation raises — the wrong current
      // password, a provider that has no password to change, the attempt
      // throttle — is about the submission as a whole.
      const fields = fieldProblems(error);
      const form = formProblems(error);
      if (Object.keys(fields).length > 0 || form.length > 0) {
        setProblems(fields as Partial<Record<keyof PasswordFields, string>>);
        setFormErrors(form);
        return;
      }
      host.failed({
        error,
        fallbackTitle: copy.failed,
        // The one sentence this dialog cannot afford to lose: a 401 from
        // `changePassword` says WHICH password was wrong, and without it the
        // reader is told to try again in a moment for something that will never
        // change on its own. See `authoredMessage` for why the screen reads it.
        description: authoredMessage(error),
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
            {copy.title}
          </Dialog.Title>
        </Dialog.Header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Dialog.Body>
            <Stack gap={4}>
              {/* The slot a form-level rejection lands in. The two ship
                  together: claiming one without somewhere to render it shows
                  nothing at all, and Save appears to do nothing (#3785). */}
              {formErrors.length > 0 && (
                <Stack gap={1} role="alert">
                  {formErrors.map((message) => (
                    <Text key={message} fontSize="sm" color="red.500">
                      {message}
                    </Text>
                  ))}
                </Stack>
              )}
              {isSetting && (
                <Text fontSize="sm" color="fg.muted">
                  You sign in without a password today. Setting one gives you a way in from a device
                  that does not hold your passkey.
                </Text>
              )}
              <Text fontSize="sm" color="fg.muted">
                {PASSWORD_REQUIREMENTS_HINT}.
              </Text>
              {!isSetting && (
                <Field.Root invalid={!!problems.currentPassword}>
                  <Field.Label>Current Password</Field.Label>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={values.currentPassword}
                    onChange={(event) =>
                      setValues((previous) => ({
                        ...previous,
                        currentPassword: event.target.value,
                      }))
                    }
                  />
                  {problems.currentPassword && (
                    <Field.ErrorText>{problems.currentPassword}</Field.ErrorText>
                  )}
                </Field.Root>
              )}
              <Field.Root invalid={!!problems.newPassword}>
                <Field.Label>{copy.newPasswordLabel}</Field.Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={values.newPassword}
                  onChange={(event) =>
                    setValues((previous) => ({ ...previous, newPassword: event.target.value }))
                  }
                />
                {problems.newPassword && <Field.ErrorText>{problems.newPassword}</Field.ErrorText>}
              </Field.Root>
              <Field.Root invalid={!!problems.confirmPassword}>
                <Field.Label>{copy.confirmLabel}</Field.Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={values.confirmPassword}
                  onChange={(event) =>
                    setValues((previous) => ({
                      ...previous,
                      confirmPassword: event.target.value,
                    }))
                  }
                />
                {problems.confirmPassword && (
                  <Field.ErrorText>{problems.confirmPassword}</Field.ErrorText>
                )}
              </Field.Root>
            </Stack>
          </Dialog.Body>
          <Dialog.Footer>
            <HStack gap={3} justify="end" width="full">
              <Button variant="outline" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" colorPalette="orange" disabled={pending} loading={pending}>
                {copy.submit}
              </Button>
            </HStack>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
