/**
 * Password change dialog (current + new password validation).
 * Rules from identity-contract; field errors on fields.
 */

import { Dialog } from "@langwatch/design-system/dialog";
import { Field, Input, Stack, Text } from "@langwatch/design-system/primitives";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { PASSWORD_REQUIREMENTS_HINT, describePasswordProblem } from "@langwatch/identity-contract";
import { useEffect, useRef, useState } from "react";

import { api } from "../../behavior/personal-workspace-api.ts";
import { authoredMessage, fieldProblems, formProblems } from "../../model/handled-error.ts";
import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host.ts";

type PasswordFields = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

const FIELD_ORDER: (keyof PasswordFields)[] = ["currentPassword", "newPassword", "confirmPassword"];

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

/** Main's wording for a wrong current password (`user.changePassword`). */
const WRONG_CURRENT_PASSWORD = "Current password is incorrect";

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
  const changePassword = api.auth.changePassword.useMutation();
  const setPassword = api.auth.setPassword.useMutation();
  const utils = api.useUtils();

  const [values, setValues] = useState<PasswordFields>(EMPTY);
  const [problems, setProblems] = useState<Partial<Record<keyof PasswordFields, string>>>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
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
    const firstInvalid = FIELD_ORDER.find((field) => found[field] !== void 0);
    if (firstInvalid) {
      const target = {
        currentPassword: currentPasswordRef,
        newPassword: newPasswordRef,
        confirmPassword: confirmPasswordRef,
      }[firstInvalid];
      target.current?.focus();
      return;
    }

    try {
      await savePassword();
      host.succeeded({
        title: copy.succeeded,
      });
      onClose();
    } catch (error) {
      // A wrong current password arrives as `invalid_credentials`, which the registry explains as
      // a refused API key; here it can only mean the first field.
      if (!isSetting && readHandledError(error)?.code === "invalid_credentials") {
        setProblems({ currentPassword: WRONG_CURRENT_PASSWORD });
        return;
      }
      // A rejection naming a field lands on it; the provider and the throttle are form-wide.
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
    <Dialog
      open={open}
      onClose={onClose}
      title={copy.title}
      placement="center"
      busy={pending}
      onSubmit={() => void submit()}
      primaryAction={{ label: copy.submit, type: "submit", loading: pending }}
    >
      <Stack gap={4}>
        {/* The slot a form-level rejection lands in. The two ship
            together: claiming one without somewhere to render it shows
            nothing at all, and Save appears to do nothing (#3785). */}
        {formErrors.length > 0 && (
          <Stack gap={1} role="alert">
            {formErrors.map((message) => (
              <Text key={message} fontSize="sm" color="red.fg">
                {message}
              </Text>
            ))}
          </Stack>
        )}
        {isSetting && (
          <Text fontSize="sm" color="fg.muted">
            You sign in without a password today. Setting one gives you a way in from a device that
            does not hold your passkey.
          </Text>
        )}
        <Text fontSize="sm" color="fg.muted">
          {PASSWORD_REQUIREMENTS_HINT}.
        </Text>
        {!isSetting && (
          <Field.Root invalid={!!problems.currentPassword}>
            <Field.Label>Current Password</Field.Label>
            <Input
              ref={currentPasswordRef}
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
            ref={newPasswordRef}
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
            ref={confirmPasswordRef}
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
    </Dialog>
  );
}
