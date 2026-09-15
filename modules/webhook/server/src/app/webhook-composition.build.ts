/**
 * Builds what the deleted `webhook.composition.ts` and
 * `enterprise-webhook.composition.ts` (b383462d96) hand-composed. The
 * entitlement gate they wired in two steps (a no-op, overridden externally)
 * is now unconditional: no per-process override composition exists any more.
 */
import { HandledError } from "@langwatch/handled-error";
import { PrismaProcessStore } from "@langwatch/eventing/server";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { WebhookAccessService } from "../services/webhook-access.service.ts";
import type { WebhookHealthDeps } from "../services/webhook-health.service.ts";
import type { WebhookTestDispatch } from "./webhook.app.ts";

/**
 * A named refusal for the one collaborator this process composes no builder
 * for, same shape as `ScenarioSecretsUnavailableError`: a stable code, a
 * customer-safe message, `fault: "platform"`.
 */
export class WebhookDispatchUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super(
      "service_unavailable",
      "This process cannot send a webhook test delivery; delivery runs on a different process here.",
      { httpStatus: 503, fault: "platform" },
    );
    this.name = "WebhookDispatchUnavailableError";
  }
}

/**
 * The last hop a test fire needs. Refuses by name on every call: the
 * process that serves this app's two doors never dispatches for real.
 */
function unavailableDispatch(): WebhookTestDispatch {
  return () => Promise.reject(new WebhookDispatchUnavailableError());
}

/**
 * What this process hands `WebhookApp` at boot: the shared process store,
 * entitlement check, and the test-fire dispatch this process refuses by name.
 */
export function buildWebhookComposition(input: {
  prisma: PrismaClient;
  entitlement: Pick<EntitlementApi, "getActivePlan">;
}): {
  processStore: WebhookHealthDeps["processStore"];
  assertEndpointsEntitled(organizationId: string): Promise<void>;
  dispatch: WebhookTestDispatch;
} {
  const access = WebhookAccessService.create(input.entitlement);

  return {
    processStore: PrismaProcessStore.create({ database: input.prisma }),
    assertEndpointsEntitled: (organizationId) => access.assertEndpointsAvailable(organizationId),
    dispatch: unavailableDispatch(),
  };
}
