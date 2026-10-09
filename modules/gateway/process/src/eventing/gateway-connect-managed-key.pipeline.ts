/**
 * Gateway ends or re-resolves a licence's managed key from licensing's facts (C3b), so licensing
 * calls no gateway operation for either; both writes are safe to repeat on a redelivery.
 * Spec: enterprise/modules/licensing/specs/licensing.feature
 */
import {
  MANAGED_KEY_INVALIDATED_EVENT_TYPE,
  MANAGED_KEY_RETIRED_EVENT_TYPE,
  managedKeyInvalidatedEventDataSchema,
  managedKeyRetiredEventDataSchema,
} from "@langwatch/enterprise-licensing-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { GatewayModule } from "../app/gateway.app.ts";
import type { GatewayRepositories } from "../repositories/gateway.repositories.ts";
import type { ConnectManagedKeyService } from "../services/connect-managed-key.service.ts";

const GATEWAY_CONNECT_MANAGED_KEY_PIPELINE_NAME = "gateway_connect_managed_key" as const;

export type GatewayConnectManagedKeyPipeline = StaticPipelineDefinition<never>;

export function buildGatewayConnectManagedKeyPipeline({
  managedKeys,
}: {
  managedKeys: Pick<ConnectManagedKeyService, "retire" | "invalidate">;
}): GatewayConnectManagedKeyPipeline {
  return (
    definePipeline({
      name: GATEWAY_CONNECT_MANAGED_KEY_PIPELINE_NAME,
      // `global`: gateway appends no events here; it only applies licensing's.
      aggregate: defineAggregate({ type: "global" }),
    })
      .withEvents([])
      // A revoke leaves an already-revoked key alone, so a redelivery ends the key once.
      .withPeerSubscriber("gatewayConnectManagedKeyRetired", {
        eventType: MANAGED_KEY_RETIRED_EVENT_TYPE,
        data: managedKeyRetiredEventDataSchema,
        handle: ({ virtualKeyId, organizationId, actorId }) =>
          managedKeys.retire({ virtualKeyId, organizationId, actorId }),
      })
      // A repeat only asks every gateway to resolve the same licence once more.
      .withPeerSubscriber("gatewayConnectManagedKeyInvalidated", {
        eventType: MANAGED_KEY_INVALIDATED_EVENT_TYPE,
        data: managedKeyInvalidatedEventDataSchema,
        handle: ({ virtualKeyId, organizationId }) =>
          managedKeys.invalidate({ virtualKeyId, organizationId }),
      })
      .build()
  );
}

export const gatewayConnectManagedKeyEventing = defineEventingModule({
  pipeline: GATEWAY_CONNECT_MANAGED_KEY_PIPELINE_NAME,
  build: ({ app }: EventingSetup<GatewayRepositories, GatewayModule>) =>
    app.connectManagedKeyPipeline(),
});
