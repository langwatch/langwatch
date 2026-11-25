/**
 * Above a board where two or more widgets failed on a resource limit: one line that says why
 * once. Each card still says its own failure. One failure is left to its card.
 */

import { Banner } from "@langwatch/design-system/banner";

const MIN_LIMIT_FAILURES = 2;

const LIMIT_WORDS =
  "LangWatch limits the memory and time a widget's query may use. This is not a problem with your data.";

export function LimitFailedWidgetsBanner({ failed, total }: { failed: number; total: number }) {
  if (failed < MIN_LIMIT_FAILURES) return null;
  const title =
    failed >= total
      ? `All ${total} widgets hit a limit`
      : `${failed} of ${total} widgets hit a limit`;
  return (
    <Banner status="warning" title={title} data-testid="limit-failed-widgets-banner">
      {LIMIT_WORDS}
    </Banner>
  );
}
