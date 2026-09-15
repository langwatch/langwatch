/**
 * Resolves a legacy `drawer.open=traceDetails` link, which would otherwise resolve to nothing,
 * by swapping the address for the Trace Explorer drawer's equivalent (same trace). Stays on
 * whatever page the link was opened on, since that drawer is mounted everywhere.
 */

import { useEffect } from "react";

import { useDrawer } from "../../behavior/use-drawer.ts";

export interface LegacyTraceDrawerRedirectProps {
  traceId?: string;
  /** Partition-pruning timestamp hint the Trace Explorer uses to skip a lookup. */
  t?: string;
  span?: string;
}

export const LegacyTraceDrawerRedirect = ({ traceId, t, span }: LegacyTraceDrawerRedirectProps) => {
  const { openDrawer, closeDrawer } = useDrawer();

  useEffect(() => {
    // A link with no trace id names nothing to show, so dismiss it rather than
    // leave an empty shell for the reader to close.
    if (!traceId) {
      closeDrawer();
      return;
    }

    openDrawer(
      "traceV2Details",
      {
        traceId,
        ...(t ? { t } : {}),
        ...(span ? { span } : {}),
      },
      // `replace` keeps the legacy address out of history — pushed, going back
      // would land on it and be redirected forward again, trapping the reader.
      // `resetStack` because the stack would otherwise seed itself from the
      // address this redirect is leaving, making "back" walk into the legacy
      // name and bounce forward again.
      { replace: true, resetStack: true },
    );
    // Runs on the identity of the link, not of the drawer callbacks, which
    // change with every query change on the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceId, t, span]);

  return null;
};
