/**
 * Gateway's side of a licence's managed key (C3b): it provisions the key from licensing's issued
 * fact and says so, and ends or re-resolves it from licensing's facts. Every write repeats safely.
 * Spec: enterprise/modules/licensing/specs/licensing.feature
 */
import {
  CONNECT_CREDENTIAL_ISSUED_EVENT_TYPE,
  connectCredentialIssuedEventDataSchema,
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
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  GATEWAY_CONNECT_MANAGED_KEY_AGGREGATE_TYPE,
  type GatewayManagedKeyProvisionedEventData,
} from "@langwatch/gateway-contract";

import type { GatewayModule } from "../app/gateway.app.ts";
import type { GatewayRepositories } from "../repositories/gateway.repositories.ts";
import type { ConnectManagedKeyService } from "../services/connect-managed-key.service.ts";
import {
  GATEWAY_CONNECT_MANAGED_KEY_PIPELINE_NAME,
  type GatewayManagedKeyProvisionedEvent,
  gatewayManagedKeyProvisionedEventSchema,
  RecordManagedKeyProvisionedCommand,
} from "./gateway-connect-managed-key.intent.ts";

export type GatewayConnectManagedKeyPipeline = StaticPipelineDefinition<
  GatewayManagedKeyProvisionedEvent,
  Record<string, Projection>,
  { name: "recordManagedKeyProvisioned"; payload: GatewayManagedKeyProvisionedEventData }
>;

export function buildGatewayConnectManagedKeyPipeline({
  managedKeys,
}: {
  managedKeys: Pick<ConnectManagedKeyService, "provisionForLicense" | "retire" | "invalidate">;
}): GatewayConnectManagedKeyPipeline {
  return (
    definePipeline({
      name: GATEWAY_CONNECT_MANAGED_KEY_PIPELINE_NAME,
      // Keyed by organisation, so one customer's provisioned facts stay in order (C3B-NAMES).
      aggregate: defineAggregate({ type: GATEWAY_CONNECT_MANAGED_KEY_AGGREGATE_TYPE }),
    })
      .withEvents([gatewayManagedKeyProvisionedEventSchema])
      .withCommand("recordManagedKeyProvisioned", RecordManagedKeyProvisionedCommand)
      // Finds the licence's key before minting one, so a repeat answers with the same key.
      .withPeerSubscriber("gatewayConnectManagedKeyIssued", {
        eventType: CONNECT_CREDENTIAL_ISSUED_EVENT_TYPE,
        data: connectCredentialIssuedEventDataSchema,
        handle: (issued) => managedKeys.provisionForLicense(issued),
      })
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
  connect: ({ app, commands }) => app.connectManagedKeyCommands(commands),
});
