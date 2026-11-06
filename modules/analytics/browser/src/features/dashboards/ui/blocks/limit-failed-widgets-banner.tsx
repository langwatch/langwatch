/**
 * Above a board where two or more widgets failed on a resource limit: one line in place of
 * the same failure told on every card. One failure is left to its card.
 */

import { Banner } from "@langwatch/design-system/banner";

const MIN_LIMIT_FAILURES = 2;

export function LimitFailedWidgetsBanner({ failed, total }: { failed: number; total: number }) {
  if (failed < MIN_LIMIT_FAILURES) return null;
  const all = failed >= total;
  return (
    <Banner
      status="warning"
      title={
        all
          ? `None of the ${total} widgets could load`
          : `${failed} of ${total} widgets couldn't load`
      }
      data-testid="limit-failed-widgets-banner"
    >
      {all
        ? "This project has too much data for them in the selected period."
        : "This project has too much data for them in the selected period. The other widgets loaded normally."}
    </Banner>
  );
}
