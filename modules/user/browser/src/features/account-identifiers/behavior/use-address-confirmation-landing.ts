/**
 * The emailed link landing back on /settings/security: completes only with the
 * verifier this tab kept, and says so rather than failing when it kept none.
 * Spec: specs/identity/authentication-settings.feature
 */

import { useEffect, useRef, useState } from "react";

import { api } from "../../../behavior/personal-workspace-api.ts";
import { usePersonalWorkspaceHost } from "../../../model/personal-workspace-host.ts";
import { findAddressVerifiers, forgetAddressVerifier } from "./address-ceremony.ts";

export type AddressConfirmationOutcome = "confirmed" | "wrong-browser" | "idle";

export function useAddressConfirmationLanding({
  onConfirmed,
}: {
  onConfirmed: () => Promise<void>;
}): AddressConfirmationOutcome {
  const host = usePersonalWorkspaceHost();
  const { query } = host.route();
  const identifierId = query.confirm;
  const verificationId = query.verification;
  const token = query.token;
  const complete = api.identity.completeVerification.useMutation();
  const [outcome, setOutcome] = useState<AddressConfirmationOutcome>("idle");
  const spent = useRef(false);

  useEffect(() => {
    if (!identifierId || !verificationId || !token || spent.current) return;
    spent.current = true;

    const [codeVerifier] = findAddressVerifiers({ identifierId });
    if (!codeVerifier) {
      setOutcome("wrong-browser");
      return;
    }

    complete
      .mutateAsync({ identifierId, verificationId, token, codeVerifier })
      .then(async () => {
        forgetAddressVerifier({ identifierId });
        setOutcome("confirmed");
        await onConfirmed();
      })
      .catch((error: unknown) => {
        host.failed({ error, fallbackTitle: "Couldn't confirm that address" });
      });
  }, [identifierId, verificationId, token, complete, onConfirmed, host]);

  return outcome;
}
