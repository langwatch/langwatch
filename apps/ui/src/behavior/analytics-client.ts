import type { PostHog } from "posthog-js";
import { createAnalyticsClient, type Provider, providers } from "react-contextual-analytics";

interface CreateUiAnalyticsClientParams {
  isSaaS: boolean;
  posthogClient: PostHog | undefined;
  isGtagReady: boolean;
  /**
   * Whether this build is a development build. Supplied by the composing
   * application rather than read here: browser UI never reads the process
   * environment, and the bundler define that answers it belongs to the
   * application build.
   */
  isDevelopment: boolean;
}

export function createUiAnalyticsClient(params: CreateUiAnalyticsClientParams) {
  const { isSaaS, posthogClient, isGtagReady, isDevelopment } = params;
  const registeredProviders = [] as Provider[];

  if (isDevelopment) registeredProviders.push(providers.console);

  if (isSaaS) {
    if (isGtagReady) {
      registeredProviders.push(providers.google);
    }

    if (posthogClient) {
      registeredProviders.push({
        id: "posthog",
        send: async (event) => {
          if (typeof window === "undefined" || !posthogClient?.capture) return;

          const name = [event.boundary, event.action, event.name].filter(Boolean).join(".");

          posthogClient.capture(name, {
            ...event.attributes,
            boundary: event.boundary,
            context: event.context,
          });
        },
      } satisfies Provider);
    }
  }

  return createAnalyticsClient(registeredProviders, []);
}
