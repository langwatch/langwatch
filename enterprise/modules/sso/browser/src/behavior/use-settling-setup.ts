// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Holds the setup read open while a command the server accepted has not reached
 * the view yet. It is one more observer of the read the page already holds and
 * fetches nothing itself: the page moves when the read hint says the projection
 * caught up, and with nothing waiting the observer is disabled.
 */
import { ssoApi } from "./sso-api.ts";

export function useSettlingSetup({
  organizationId,
  waiting,
}: {
  organizationId: string;
  waiting: boolean;
}): void {
  ssoApi.ssoSetup.getSetup.useQuery(
    { organizationId },
    // needs a read hint: sso setup projection caught up (identity provider and admin role exist)
    { enabled: waiting },
  );
}
