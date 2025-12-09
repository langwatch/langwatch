import type { PostHog } from "posthog-js";
import {
  createAnalyticsClient,
  type Provider,
  providers,
} from "react-contextual-analytics";

interface CreateAppAnalyticsClientParams {
  isSaaS: boolean;
  posthogClient: PostHog | undefined;
}

export function createAppAnalyticsClient(
  params: CreateAppAnalyticsClientParams,
) {
  const { isSaaS, posthogClient } = params;
  const registeredProviders = [] as Provider[];
  const isDev = process.env.NODE_ENV !== "production";

  if (isDev) registeredProviders.push(providers.console);

  if (isSaaS) {
    if (typeof window !== "undefined" && (window as any).gtag) {
      registeredProviders.push(providers.google);
    }

    if (posthogClient) {
      registeredProviders.push({
        id: "posthog",
        send: async (event) => {
          if (typeof window === "undefined" || !posthogClient?.capture) return;

          const name = [event.boundary, event.action, event.name]
            .filter(Boolean)
            .join(".");

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
