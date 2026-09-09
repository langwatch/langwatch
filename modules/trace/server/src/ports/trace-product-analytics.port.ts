/**
 * One product-usage event, as the ingest path emits it.
 *
 * Product analytics, not observability: this is the onboarding funnel's own
 * record that a project started sending traces, and it is keyed by a person.
 */
export type TraceProductEvent = {
  userId: string;
  event: string;
  properties?: Record<string, unknown>;
  projectId?: string;
};

/**
 * Where the ingest path's product-usage events go.
 *
 * The trace path emits exactly one, `first_trace_integrated`, at most once per
 * project in that project's lifetime — the terminal step of the onboarding
 * funnel, carrying the SDK language and framework. The application sends it to
 * PostHog through `trackServerEvent`, which no-ops when `POSTHOG_KEY` is unset.
 *
 * Fire-and-forget, and the `void` return says so: this runs inside a projection
 * subscriber on the ingest path, and an analytics sink must never be able to
 * fail a trace.
 */
export abstract class TraceProductAnalyticsPort {
  abstract record(event: TraceProductEvent): void;
}
