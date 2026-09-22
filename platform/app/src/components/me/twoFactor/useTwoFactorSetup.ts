import { useCallback, useState } from "react";
import { showErrorToast } from "~/features/errors";
import { authClient } from "~/utils/auth-client";

/**
 * Setting two-step verification up, as three steps and the moves between
 * them.
 *
 * State and callbacks, never JSX: the caller owns the layout, this owns the
 * ceremony. Which matters here because the same ceremony runs in two places —
 * the security settings screen and the enrollment gate an organization holds
 * somebody at — and a hook that returned a dialog would have made the second
 * one a copy of the first.
 *
 * Every refusal is read through the handled-error contract. The two-factor
 * endpoints answer in our own codes now (see
 * `server/better-auth/handled-errors.ts`), so a wrong code reaches the person
 * as the registry's words rather than as `INVALID_CODE`.
 */
export type TwoFactorSetupStep = "password" | "scan" | "codes";

export interface TwoFactorSetupState {
  step: TwoFactorSetupStep;
  /** The setup link the scannable code and the typed key both come from. */
  setupUri: string | null;
  /** Shown once, at the end, and never read back. */
  backupCodes: readonly string[];
  isStarting: boolean;
  isConfirming: boolean;
}

const EMPTY: TwoFactorSetupState = {
  step: "password",
  setupUri: null,
  backupCodes: [],
  isStarting: false,
  isConfirming: false,
};

/**
 * The plugin answers one of two shapes, depending on which second factor it
 * issued. Only the authenticator one carries a setup link, and it is the only
 * one this app asks for — but the type says both, so the arm carrying the link
 * is narrowed out rather than asserted away.
 */
function authenticatorFrom<T>(
  issued: T,
): Extract<T, { totpURI: string }> | null {
  return issued && typeof issued === "object" && "totpURI" in issued
    ? (issued as Extract<T, { totpURI: string }>)
    : null;
}

export function useTwoFactorSetup({ onFinished }: { onFinished: () => void }) {
  const [state, setState] = useState<TwoFactorSetupState>(EMPTY);

  const reset = useCallback(() => setState(EMPTY), []);

  /**
   * Ask for a setup.
   *
   * The password is the plugin's own requirement and a good one where there IS
   * a password: issuing a fresh second factor to whoever is holding an
   * unlocked laptop would defeat the point of having one. An account that
   * holds none passes nothing, and the plugin waives it —
   * `allowPasswordless` in `server/better-auth/index.ts`, whose
   * `shouldRequirePassword` still demands it from every account with a
   * credential row. Sending an empty string instead would be a wrong password,
   * not an absent one.
   */
  const start = useCallback(async (password?: string) => {
    setState((current) => ({ ...current, isStarting: true }));
    try {
      const result = await authClient.twoFactor.enable(
        password ? { password } : {},
      );
      if (result.error) {
        showErrorToast({
          error: result.error,
          fallbackTitle: "That setup didn't start",
        });
        setState((current) => ({ ...current, isStarting: false }));
        return;
      }
      const authenticator = authenticatorFrom(result.data);
      setState({
        step: "scan",
        setupUri: authenticator?.totpURI ?? null,
        // Held until the setup is CONFIRMED. Codes shown beside a setup
        // nobody finished are codes for a factor that does not exist.
        backupCodes: authenticator?.backupCodes ?? [],
        isStarting: false,
        isConfirming: false,
      });
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "That setup didn't start" });
      setState((current) => ({ ...current, isStarting: false }));
    }
  }, []);

  /** Finish it with the first code the app produced. */
  const confirm = useCallback(async (code: string) => {
    setState((current) => ({ ...current, isConfirming: true }));
    try {
      const result = await authClient.twoFactor.verifyTotp({ code });
      if (result.error) {
        showErrorToast({
          error: result.error,
          fallbackTitle: "That code didn't work",
        });
        setState((current) => ({ ...current, isConfirming: false }));
        return;
      }
      setState((current) => ({
        ...current,
        step: "codes",
        isConfirming: false,
      }));
    } catch (error) {
      showErrorToast({ error, fallbackTitle: "That code didn't work" });
      setState((current) => ({ ...current, isConfirming: false }));
    }
  }, []);

  /** The person has saved their codes; the ceremony is over. */
  const finish = useCallback(() => {
    reset();
    onFinished();
  }, [onFinished, reset]);

  return { ...state, start, confirm, finish, reset };
}
