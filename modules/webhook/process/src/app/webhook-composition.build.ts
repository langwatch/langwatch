import type { EntitlementApi } from "@langwatch/entitlement-contract";

import { WebhookAccessService } from "../services/webhook-access.service.ts";

/** What this process hands `WebhookApp` at boot: the entitlement check. */
export function buildWebhookComposition(input: {
  entitlement: Pick<EntitlementApi, "getActivePlan">;
}): {
  assertEndpointsEntitled(organizationId: string): Promise<void>;
} {
  const access = WebhookAccessService.create(input.entitlement);

  return {
    assertEndpointsEntitled: (organizationId) => access.assertEndpointsAvailable(organizationId),
  };
}
