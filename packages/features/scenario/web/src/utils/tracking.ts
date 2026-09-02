/**
 * Product analytics, as the workflow selector drawer spells it.
 *
 * `~/utils/tracking` reached the application's PostHog client, which is the
 * application's identity and consent boundary and not a feature package's to
 * hold. The one call site records "a workflow was chosen as a run target"; the
 * event is DROPPED until this family takes an analytics capability off its host
 * port, and dropping it is recorded rather than hidden.
 */

export function trackEvent(_event: string, _properties?: Record<string, unknown>): void {
  // Intentionally inert. See the module docblock.
}
