import { useCallback } from "react";

import { personalWorkspaceApi } from "../../../behavior/personal-workspace-api.ts";
import { usePersonalWorkspaceHost } from "../../../model/personal-workspace-host.ts";
import { twoStepVerificationApi } from "./two-step-verification-api.ts";

/**
 * The reader's own two-step verification: where it stands, and turning it off.
 * Refusals reach them as registry words, never the wire's code slug.
 * Spec: specs/identity/mfa-and-session-shape.feature
 */
export function useTwoStepAccount() {
  const host = usePersonalWorkspaceHost();
  const utils = twoStepVerificationApi.useUtils();
  const account = twoStepVerificationApi.twoStepVerification.account.useQuery({});
  const passwordStatus = personalWorkspaceApi.user.hasPassword.useQuery({});
  const disableMutation = twoStepVerificationApi.twoStepVerification.disable.useMutation();

  /** Only an account that holds a password is asked for one; the server agrees. */
  const holdsPassword = passwordStatus.data?.hasPassword ?? true;

  const turnOff = useCallback(
    ({ password, code }: { password: string; code: string }, onTurnedOff: () => void) => {
      disableMutation.mutate(holdsPassword ? { password, code } : { code }, {
        onSuccess: () => {
          host.succeeded({ title: "Two-step verification is off" });
          void utils.twoStepVerification.account.invalidate();
          onTurnedOff();
        },
        onError: (error) => host.failed({ error, fallbackTitle: "That wasn't turned off" }),
      });
    },
    [disableMutation, holdsPassword, host, utils],
  );

  return {
    /** Whether this deployment offers two-step verification at all. */
    offered: account.data?.offered === true,
    loading: account.isPending,
    enabled: account.data?.enabled === true,
    requiringOrganizations: account.data?.requiringOrganizations ?? [],
    holdsPassword,
    turningOff: disableMutation.isPending,
    turnOff,
  };
}
