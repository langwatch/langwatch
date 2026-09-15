import { useCallback } from "react";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { api } from "~/utils/api";
import {
  type EnrollmentGateOutcome,
  resolveEnrollmentGate,
} from "../logic/enrollmentGate";

/**
 * Whether this organization's requirement is holding the person looking at
 * the screen, and how to ask again once they have set one up.
 *
 * Asked per organization, on the way into that organization's data — never at
 * sign-in and never once for the whole session. That is what makes "held out
 * of THAT organization alone" true rather than merely intended: switching to
 * another organization asks a different question and gets a different answer,
 * with nothing cached across them beyond the query key.
 *
 * `refresh` is the whole of "setting it up opens the gate on the session they
 * already hold": finishing the setup re-asks the same question on the same
 * session, and the answer changes. Nothing signs anybody in again.
 */
export function useOrganizationMfaGate({
  organizationId,
  isPersonalScope = false,
}: {
  organizationId: string | undefined;
  isPersonalScope?: boolean;
}): { outcome: EnrollmentGateOutcome; refresh: () => void } {
  const publicEnv = usePublicEnv();
  // With the flag off nothing about two-step verification exists, so nothing
  // asks — a deployment that never mounted it must not spend a request per
  // navigation discovering that.
  const enabled =
    publicEnv.data?.MFA_ENROLLMENT_OPEN === true &&
    !!organizationId &&
    !isPersonalScope;

  const standing = api.twoStepVerification.standing.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled },
  );

  const refresh = useCallback(() => {
    void standing.refetch();
  }, [standing]);

  return {
    outcome: resolveEnrollmentGate({
      standing: standing.data,
      isPersonalScope,
    }),
    refresh,
  };
}
