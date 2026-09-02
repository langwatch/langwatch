/**
 * `usePublicEnv`, narrowed to the one key this family reads.
 *
 * The platform hook was a round trip that answered the whole public
 * environment. Two surfaces here read exactly one field of it — whether the
 * deployment can send email, which decides between "we sent an invitation" and
 * "here is a link to send yourself" — so the host answers that alone, and the
 * `{ data }` shape is kept so neither call site changed.
 */

import { useMemo } from "react";
import { useOrganizationHost } from "../model/organization-host";

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
