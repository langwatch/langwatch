// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Read the setup again, and keep reading, while a command the server accepted
 * has not reached the view yet. One observer of the read the page already
 * holds, so the whole page moves when it settles — and the moment nothing is
 * waiting it stops, rather than polling a settled page forever.
 */
import { ssoApi } from "./sso-api.ts";

/** How often a projection that has not caught up is asked again. */
const SETTLING_POLL_MS = 1_000;

export function useSettlingSetup({
  organizationId,
  waiting,
}: {
  organizationId: string;
  waiting: boolean;
}): void {
  ssoApi.ssoSetup.getSetup.useQuery(
    { organizationId },
    { enabled: waiting, refetchInterval: waiting ? SETTLING_POLL_MS : false },
  );
}
