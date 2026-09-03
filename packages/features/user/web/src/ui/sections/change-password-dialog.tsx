/**
 * Changing, or setting for the first time, the password this account signs in
 * with.
 *
 * Moved from `platform/app/src/components/settings/ChangePasswordDialog.tsx`
 * with its rules intact and one import replaced: `applyHandledErrorToForm` and
 * `FormServerError` were `platform/app`'s, and the reading they do arrives here
 * as `model/handled-error.ts` — a rejection that names a field lands ON that
 * field, and one that does not is said above the form. A toast the reader has
 * already looked away from is not where a rejected submit belongs.
 *
 * THE RULES COME FROM `@langwatch/identity-contract`, which both mutations
 * behind this dialog read too, so the form cannot accept what the server
 * refuses. Asked as a refinement rather than restated as a `min(8)` for the
 * reason the platform file records: restating them is how they drift, and this
 * dialog HAD drifted — it enforced eight characters of its own while the front
 * door enforced the shared policy, so it accepted a password over the 72-byte
 * bcrypt limit and one made entirely of spaces.
 *
 * EVERY PASSWORD INPUT IS `type="password"`. Three of them, and the property is
 * asserted in `change-password-dialog.test.tsx` rather than assumed: a
 * credential typed into a text input is one over-the-shoulder glance and one
 * screen recording away from being somebody else's.
 */

import { Button, Field, HStack, Input, Stack, Text } from "@chakra-ui/react";
import { Dialog } from "@langwatch/design-system/dialog";
import { PASSWORD_REQUIREMENTS_HINT, passwordProblem } from "@langwatch/identity-contract";
import { useEffect, useState } from "react";
import { api } from "../../behavior/personal-workspace-api";
import { authoredMessage, fieldProblems, formProblems } from "../../model/handled-error";
import { usePersonalWorkspaceHost } from "../../model/personal-workspace-host";

type PasswordFields = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

const EMPTY: PasswordFields = { currentPassword: "", newPassword: "", confirmPassword: "" };

/**
 * What the form itself refuses, before anything is sent.
 *
 * The two rules the server cannot state for us — that a current password is
 * present when one is being changed, and that the two new ones agree — plus
 * `passwordProblem`, which IS the server's rule and is called rather than
 * restated.
 */
export function validatePasswordForm(
  values: PasswordFields,
  { isSetting }: { isSetting: boolean },
): Partial<Record<keyof PasswordFields, string>> {
  const problems: Partial<Record<keyof PasswordFields, string>> = {};
  if (!isSetting && !values.currentPassword) {
    problems.currentPassword = "Current password is required";
  }
  const newProblem = passwordProblem(values.newPassword);
  if (newProblem) problems.newPassword = newProblem;
  const confirmProblem = passwordProblem(values.confirmPassword);
  if (confirmProblem) {
    problems.confirmPassword = confirmProblem;
  } else if (values.newPassword !== values.confirmPassword) {
    problems.confirmPassword = "Passwords don't match";
  }
  return problems;
}

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

  const submit = async () => {
    const found = validatePasswordForm(values, { isSetting });
    setProblems(found);
    setFormErrors([]);
    if (Object.keys(found).length > 0) return;

    try {
      if (isSetting) {
        await setPassword.mutateAsync({ password: values.newPassword });
        // The section offered "Set a password" off this answer, so it has to be
        // asked again — otherwise the button stays, for something now done.
        await utils.user.hasPassword.invalidate();
      } else {
        await changePassword.mutateAsync({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        });
      }
      host.succeeded({
        title: isSetting ? "Password set" : "Password changed successfully",
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
        fallbackTitle: isSetting ? "Couldn't set your password" : "Couldn't change your password",
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
            {isSetting ? "Set a password" : "Change Password"}
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
                <Field.Label>{isSetting ? "Password" : "New Password"}</Field.Label>
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
                <Field.Label>{isSetting ? "Confirm password" : "Confirm New Password"}</Field.Label>
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
                {isSetting ? "Set password" : "Change Password"}
              </Button>
            </HStack>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
