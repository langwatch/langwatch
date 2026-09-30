import { useCallback } from "react";

import { enrollmentGateOf } from "../model/enrollment-gate.ts";
import { twoStepVerificationApi } from "./two-step-verification-api.ts";

/**
 * Asked per organization on the way into its data, never once per session, so
 * the answer for one organization never holds anyone out of another. `refresh`
 * re-asks on the same session once a setup finishes; nobody signs in again.
 */
export function useOrganizationMfaGate({
  organizationId,
  isPersonalScope,
}: {
  organizationId: string | undefined;
  isPersonalScope: boolean;
}) {
  const standing = twoStepVerificationApi.twoStepVerification.standing.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId && !isPersonalScope },
  );
  const refetch = standing.refetch;
  const refresh = useCallback(() => void refetch(), [refetch]);

  return { gate: enrollmentGateOf({ standing: standing.data, isPersonalScope }), refresh };
}
