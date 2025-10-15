import { type Provider, createAnalyticsClient } from "react-contextual-analytics";
import {
  console as consoleProvider,
  google as googleProvider,
} from "react-contextual-analytics/providers";
import type { PostHog } from "posthog-js";

interface CreateAppAnalyticsClientParams {
  isSaaS: boolean;
  posthogClient: PostHog | undefined;
}

export function createAppAnalyticsClient(params: CreateAppAnalyticsClientParams) {
  const { isSaaS, posthogClient } = params;
  const providers = [] as Provider[];
  const isDev = process.env.NODE_ENV !== "production";

  if (isDev) providers.push(consoleProvider);

  if (isSaaS) {
    providers.push(googleProvider);

    if (posthogClient) {
      providers.push({
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

  return createAnalyticsClient(providers);
}


