/**
 * The analytics destination the shell installs, recording instead of sending, put above a test's
 * tree through the real host-service seam.
 */

import { UiAnalytics, type UiAnalyticsEvent } from "@langwatch/browser-host/analytics";
import { UiHostServicesContextProvider } from "@langwatch/browser-host/capabilities";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import type { ReactNode } from "react";

/** Keeps every product event it is handed. */
export class RecordingUiAnalytics extends UiAnalytics {
  readonly events: UiAnalyticsEvent[] = [];

  track(event: UiAnalyticsEvent): void {
    this.events.push(event);
  }

  identify(): void {}

  group(): void {}

  reset(): void {}
}

/** Installs `analytics` as the host's analytics for everything below it. */
export function RecordingAnalyticsProvider({
  analytics,
  children,
}: {
  analytics: RecordingUiAnalytics;
  children: ReactNode;
}) {
  const services = {
    ...createUiHostServicesFromHost({
      route: () => ({ params: {}, query: {} }),
      navigate: () => void 0,
    }),
    analytics,
  };
  return <UiHostServicesContextProvider value={services}>{children}</UiHostServicesContextProvider>;
}
