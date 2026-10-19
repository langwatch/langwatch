import { useCallback, useState } from "react";

import { usePersonalWorkspaceHost } from "../../../model/personal-workspace-host.ts";

/** The three steps of a setup: confirm who you are, scan, save the codes. */
export type TwoStepSetupStep = "password" | "scan" | "codes";

type TwoStepSetupState = {
  step: TwoStepSetupStep;
  setupUri: string;
  /** Held until the setup is confirmed: codes for a factor nobody finished do not exist. */
  backupCodes: readonly string[];
  isStarting: boolean;
  isConfirming: boolean;
};

const EMPTY: TwoStepSetupState = {
  step: "password",
  setupUri: "",
  backupCodes: [],
  isStarting: false,
  isConfirming: false,
};

/**
 * Setting two-step verification up, as three steps and the moves between them:
 * state and callbacks, never layout. Refusals reach the reader as registry words.
 * Spec: specs/identity/mfa-and-session-shape.feature
 */
export function useTwoStepSetup({ onFinished }: { onFinished: () => void }) {
  const host = usePersonalWorkspaceHost();
  const [state, setState] = useState<TwoStepSetupState>(EMPTY);

  const reset = useCallback(() => setState(EMPTY), []);

  const start = useCallback(
    async (password?: string) => {
      setState((current) => ({ ...current, isStarting: true }));
      const answer = await host.startTwoStepSetup({ password });
      if (!answer.ok) {
        host.failed({ error: answer.error, fallbackTitle: "That setup didn't start" });
        setState((current) => ({ ...current, isStarting: false }));
        return;
      }
      setState({
        step: "scan",
        setupUri: answer.value.setupUri,
        backupCodes: answer.value.backupCodes,
        isStarting: false,
        isConfirming: false,
      });
    },
    [host],
  );

  const confirm = useCallback(
    async (code: string) => {
      setState((current) => ({ ...current, isConfirming: true }));
      const answer = await host.confirmTwoStepSetup({ code });
      if (!answer.ok) {
        host.failed({ error: answer.error, fallbackTitle: "That code didn't work" });
        setState((current) => ({ ...current, isConfirming: false }));
        return;
      }
      setState((current) => ({ ...current, step: "codes", isConfirming: false }));
    },
    [host],
  );

  /** The reader has saved their codes; the ceremony is over. */
  const finish = useCallback(() => {
    reset();
    onFinished();
  }, [onFinished, reset]);

  return { ...state, start, confirm, finish, reset };
}
