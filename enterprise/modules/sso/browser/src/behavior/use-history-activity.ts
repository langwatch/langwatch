// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The history panel's own live signal: open because the panel mounted, closed
 * the moment it unmounts — no global listener, no second place in the product
 * that opens this channel (specs/identity/sso-connection-history.feature,
 * "Live updates").
 */
import { useSSESubscription } from "@langwatch/trace-browser-kit";

import { ssoApi } from "./sso-api.ts";

/**
 * A bare "something changed", never rendered and only acted on: the re-read it
 * triggers is still `getHistory`, so it discloses nothing the reader could not
 * already ask for.
 */
export function useHistoryActivity({
  organizationId,
  connectionId,
}: {
  organizationId: string;
  connectionId: string;
}) {
  const utils = ssoApi.useUtils();

  useSSESubscription<{ connectionId: string }, { organizationId: string; connectionId: string }>(
    ssoApi.ssoSetup.onHistoryActivity,
    { organizationId, connectionId },
    {
      onData: () => {
        void utils.ssoSetup.getHistory.invalidate({ organizationId, connectionId });
      },
    },
  );
}
