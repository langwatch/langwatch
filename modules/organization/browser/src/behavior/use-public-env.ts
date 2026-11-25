/** Public environment: whether deployment can send email for invitations. */

import { useMemo } from "react";

import { useOrganizationHost } from "../model/organization-host.ts";

export type OrganizationPublicEnvReading = {
  data: { HAS_EMAIL_PROVIDER_KEY: boolean };
};

export function usePublicEnv(): OrganizationPublicEnvReading {
  const host = useOrganizationHost();
  const hasEmailProvider = host.hasEmailProvider();
  return useMemo(
    () => ({ data: { HAS_EMAIL_PROVIDER_KEY: hasEmailProvider } }),
    [hasEmailProvider],
  );
}
