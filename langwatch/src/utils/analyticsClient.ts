import { type Provider, createAnalyticsClient, providers } from "react-contextual-analytics";
import type { PostHog } from "posthog-js";
import { context, trace } from "@opentelemetry/api";

interface CreateAppAnalyticsClientParams {
  isSaaS: boolean;
  posthogClient: PostHog | undefined;
}

export function createAppAnalyticsClient(params: CreateAppAnalyticsClientParams) {
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

          const activeSpan = trace.getSpan(context.active());
          const spanCtx = activeSpan?.spanContext();
          const traceId = spanCtx?.traceId;
          const spanId = spanCtx?.spanId;

          posthogClient.capture(name, {
            ...event.attributes,
            boundary: event.boundary,
            context: event.context,
            ...(traceId && { trace_id: traceId }),
            ...(spanId && { span_id: spanId }),
          });
        },
      } satisfies Provider);
    }
  }

  return createAnalyticsClient(registeredProviders, []);
}


