// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Saving who a connection admits. No toast: the refusal is rendered beside the
 * control that caused it, where the reader is still mid-step.
 */
import type { SsoArrivalPolicy } from "@langwatch/identity-contract";

import { ssoApi } from "./sso-api.ts";

export function useArrivalPolicy({
  organizationId,
  connectionId,
  onChanged,
}: {
  organizationId: string;
  connectionId: string;
  onChanged: () => void;
}) {
  const setArrivals = ssoApi.ssoSetup.setArrivals.useMutation();

  return {
    save: (policy: SsoArrivalPolicy) =>
      setArrivals.mutate({ organizationId, connectionId, policy }, { onSuccess: onChanged }),
    saving: setArrivals.isPending,
    refusal: setArrivals.error,
  };
}
