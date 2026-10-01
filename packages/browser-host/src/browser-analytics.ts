/**
 * The instrumentation destinations this application composes, behind the one
 * `UiAnalytics` capability (ARCHITECTURE.md §10.1). Every destination name and
 * payload below is what react-contextual-analytics sent before it was evicted.
 */

import type { PostHog } from "posthog-js";

import {
  UiAnalytics,
  type UiAnalyticsEvent,
  type UiAnalyticsGroup,
  type UiAnalyticsReader,
} from "./analytics.ts";

/** The envelope version every destination has received since 2025-05-29. */
const EVENT_VERSION = "2025-05-29";

type InstrumentedEvent = {
  version: typeof EVENT_VERSION;
  action?: string;
  name?: string;
  boundary?: string;
  attributes: Record<string, unknown>;
  context: {
    href: string;
    windowWidth: number;
    windowHeight: number;
    userAgent: string;
  };
};

type AnalyticsDestination = {
  id: string;
  send: (event: InstrumentedEvent) => void;
  /** Only a destination that keeps people apart implements these. */
  identify?: (reader: UiAnalyticsReader) => void;
  group?: (organization: UiAnalyticsGroup) => void;
  reset?: () => void;
};

const CONSOLE_DESTINATION: AnalyticsDestination = {
  id: "console",
  send: (event) => console.dir(event, { depth: null }),
};

const GOOGLE_DESTINATION: AnalyticsDestination = {
  id: "google",
  send: (event) => {
    const name = [event.boundary, event.name, event.action].filter(Boolean).join(" ");
    // The shape the previous vendor tested for, kept byte-for-byte: GTM's
    // `gtag` is a function, so this warns rather than sending, and repairing
    // it would start a Google Analytics event stream that never existed.
    const gtag: unknown = window.gtag;
    if (typeof gtag === "object" && gtag !== null && "event" in gtag) {
      const send = gtag.event;
      if (typeof send === "function") {
        send(name, event);
        return;
      }
    }
    console.warn("gtag is not available");
  },
};

function postHogDestination(client: PostHog): AnalyticsDestination {
  return {
    id: "posthog",
    send: (event) => {
      if (typeof window === "undefined" || !client.capture) return;

      const name = [event.boundary, event.action, event.name].filter(Boolean).join(".");

      client.capture(name, {
        ...event.attributes,
        boundary: event.boundary,
        context: event.context,
      });
    },
    identify: (reader) => client.identify(reader.id, { email: reader.email ?? undefined }),
    group: (organization) =>
      client.group(
        "organization",
        organization.id,
        organization.name ? { name: organization.name } : {},
      ),
    reset: () => client.reset(),
  };
}

class BrowserUiAnalytics extends UiAnalytics {
  private constructor(private readonly destinations: readonly AnalyticsDestination[]) {
    super();
  }

  static create(destinations: readonly AnalyticsDestination[]): UiAnalytics {
    return new BrowserUiAnalytics(destinations);
  }

  track(event: UiAnalyticsEvent): void {
    if (typeof window === "undefined") return;

    const instrumented: InstrumentedEvent = {
      version: EVENT_VERSION,
      boundary: event.boundary,
      action: event.action,
      name: event.name,
      attributes: { ...event.attributes },
      context: {
        href: window.location.href,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        userAgent: window.navigator.userAgent,
      },
    };

    for (const destination of this.destinations) {
      try {
        destination.send(instrumented);
      } catch {
        console.error(`analytic provider ${destination.id} failed`, instrumented);
      }
    }
  }

  identify(reader: UiAnalyticsReader): void {
    this.#each("identify", (destination) => destination.identify?.(reader));
  }

  group(organization: UiAnalyticsGroup): void {
    this.#each("group", (destination) => destination.group?.(organization));
  }

  reset(): void {
    this.#each("reset", (destination) => destination.reset?.());
  }

  #each(what: string, call: (destination: AnalyticsDestination) => void): void {
    if (typeof window === "undefined") return;
    for (const destination of this.destinations) {
      try {
        call(destination);
      } catch {
        console.error(`analytic provider ${destination.id} failed to ${what}`);
      }
    }
  }
}

type CreateBrowserUiAnalyticsParams = {
  isSaaS: boolean;
  posthogClient: PostHog | undefined;
  isGtagReady: boolean;
  /**
   * Whether this build is a development build — supplied by the composing
   * application, since browser UI never reads the process environment.
   */
  isDevelopment: boolean;
};

export function createBrowserUiAnalytics({
  isSaaS,
  posthogClient,
  isGtagReady,
  isDevelopment,
}: CreateBrowserUiAnalyticsParams): UiAnalytics {
  const destinations: AnalyticsDestination[] = [];

  if (isDevelopment) destinations.push(CONSOLE_DESTINATION);

  if (isSaaS) {
    if (isGtagReady) destinations.push(GOOGLE_DESTINATION);
    if (posthogClient) destinations.push(postHogDestination(posthogClient));
  }

  return BrowserUiAnalytics.create(destinations);
}
