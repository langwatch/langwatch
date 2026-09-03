/**
 * The tri-state the session capability keeps, narrowed to the two fields the
 * navigation package reads. `undefined` there means "not answered yet", which
 * is what stops a landing decision resolving against a flag still in flight.
 */

import type { NavigationFlagReading } from "@langwatch/navigation-web/screens/landing";

export function readNavigationFeatureFlag({
  answer,
}: {
  answer: boolean | undefined;
}): NavigationFlagReading {
  return { enabled: answer === true, isLoading: answer === void 0 };
}
