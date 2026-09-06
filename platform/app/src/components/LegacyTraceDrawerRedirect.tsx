import { useEffect } from "react";
import { useDrawer } from "~/hooks/useDrawer";

interface LegacyTraceDrawerRedirectProps {
  traceId?: string;
  /** Partition-pruning timestamp hint the v2 drawer uses to skip a lookup. */
  t?: string;
  span?: string;
}

/**
 * Stands in for the removed legacy trace drawer (`drawer.open=traceDetails`).
 *
 * The drawer shell is resolved from the address bar, so a link shared before
 * the legacy drawer was removed names `traceDetails` and would resolve to
 * nothing at all. This resolves instead, and swaps the address for the Trace
 * Explorer drawer's — same trace, current experience.
 *
 * It stays on whatever page the link was opened on. `GlobalTraceV2DrawerMount`
 * mounts the Trace Explorer drawer everywhere, so a legacy link followed from
 * an annotation queue opens the trace over the queue rather than moving the
 * reader to the traces list.
 *
 * The legacy `selectedTab` and `showMessages` parameters are dropped: the
 * Trace Explorer has no equivalent of those tabs, which is the same choice the
 * legacy `/messages/[trace]/[openTab]` path redirects make.
 */
export const LegacyTraceDrawerRedirect = ({
  traceId,
  t,
  span,
}: LegacyTraceDrawerRedirectProps) => {
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
      // `resetStack` because the drawer stack would otherwise seed itself from
      // the address this redirect is leaving, making "back" from the Trace
      // Explorer drawer walk into the legacy name and bounce forward again.
      { replace: true, resetStack: true },
    );
    // Runs on the identity of the link, not of the drawer callbacks, which
    // change with every query change on the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceId, t, span]);

  return null;
};
