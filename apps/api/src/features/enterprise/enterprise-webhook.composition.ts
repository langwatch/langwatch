/**
 * The webhook application `/api/webhooks/v1` reads, gated on a plan read (not
 * an Enterprise capability) so a deployment with no governance application
 * still answers a customer-actionable 403 instead of an unknown-error 503.
 * See ADR candidate: webhook plan-gate independence, comment-sweep plan.
 */
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { WebhookAccessService, WebhookApp } from "@langwatch/webhook-server";

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

  return webhooks.withEntitlement((organizationId) =>
    access.assertEndpointsAvailable(organizationId),
  );
}
