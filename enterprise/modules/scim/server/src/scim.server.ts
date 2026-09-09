// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The SCIM feature's installer: one application, four declared doors. A
 * process that composes the directory service, the plan source, the webhook
 * secret and the management audit ledger installs this and mounts what it
 * wants; one that composes none of them installs nothing.
 */
import { defineModule } from "@langwatch/runtime-composition";

import { ScimApp } from "./app/scim.app.ts";
import { scimProtocolRest } from "./transport/scim-protocol.rest.ts";
import { scimTokenRest } from "./transport/scim-token.rest.ts";
import { scimTokenTrpcTransport } from "./transport/scim-token.trpc.ts";
import { scimWebhookRest } from "./transport/scim-webhook.rest.ts";

export type {
  ScimInfrastructure,
  ScimManagementAuditPort,
  ScimPlanProvider,
} from "./app/scim.app.ts";

export const scimServer = defineModule("scim")
  .withApp(ScimApp)
  .withTransports(scimTokenRest, scimTokenTrpcTransport, scimProtocolRest, scimWebhookRest)
  .build();
