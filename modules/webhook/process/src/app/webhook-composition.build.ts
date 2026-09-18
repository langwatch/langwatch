import { WebhookDispatchUnavailableError } from "@langwatch/webhook-contract";
import { PrismaProcessStore } from "@langwatch/eventing/server";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import { WebhookAccessService } from "../services/webhook-access.service.ts";
import type { WebhookHealthDeps } from "../services/webhook-health.service.ts";
import type { WebhookTestDispatch } from "./webhook.app.ts";

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
  prisma: ProcessMembers["prisma"];
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
