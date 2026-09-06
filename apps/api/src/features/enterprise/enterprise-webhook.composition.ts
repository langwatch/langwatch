/**
 * The webhook application `/api/webhooks/v1` reads, with the entitlement gate
 * this process can always answer.
 *
 * The surface's gate is a PLAN READ, not an Enterprise capability: a
 * deployment that composed no Enterprise governance application still knows
 * whether an organization's plan carries webhook endpoints, and the 403 that
 * names the plan is a refusal the customer can act on. Taken off the
 * governance slice instead, the whole family answered a platform 503 whose
 * body says only that an unknown error occurred — a knowable refusal reported
 * as our outage.
 *
 * Everything behind the gate is left exactly as the slice composed it. This
 * decides which plan the surface is judged against, and nothing else.
 */
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { WebhookAccessService, WebhookApp } from "@langwatch/enterprise-api/webhooks";

/**
 * The slice's application, gated on the deployment's own plan provider. Without
 * one the slice is returned untouched: a gate that cannot read a plan must not
 * decide entitlement, and the surface keeps whatever the slice answers.
 */
export function composeApiWebhookApplication(options: {
  webhooks: WebhookApp;
  plans: PlanProvider | undefined;
}): WebhookApp {
  const { webhooks, plans } = options;
  if (!plans) return webhooks;

  const access = WebhookAccessService.create(plans);

  return WebhookApp.create({
    endpoints: webhooks.endpoints,
    health: webhooks.health,
    events: webhooks.events,
    assertEndpointsEntitled: (organizationId) => access.assertEndpointsAvailable(organizationId),
    dispatch: (input) => webhooks.dispatch(input),
  });
}
