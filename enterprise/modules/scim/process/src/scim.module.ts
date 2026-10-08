// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The SCIM feature's installer: one application, four declared doors.
 * `ScimModule` declares what it reads off the process and which peer modules it
 * depends on; a process that supplies both installs this and mounts what it wants.
 */
import {
  bindRestCredential,
  bindRestMiddleware,
  organizationCredentialOfRequest,
  scimCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import type { ScimApi, ScimServerConfig } from "@langwatch/enterprise-scim-contract";
import { defineProjectionReplayStep } from "@langwatch/upgrade/step";

import { ScimModule } from "./app/scim.app.ts";
import { scimCostCenterEventing } from "./eventing/scim-cost-center.pipeline.ts";
import { scimDirectoryEventing } from "./eventing/scim-directory.pipeline.ts";
import {
  SCIM_SSO_CONNECTION_PIPELINE_NAME,
  scimSsoConnectionEventing,
} from "./eventing/scim-sso-connection.pipeline.ts";
import { SCIM_SSO_CONNECTION_PROJECTION_NAME } from "./eventing/scim-sso-connection.projection.ts";
import { scimSyncEventing } from "./eventing/scim-sync.pipeline.ts";
import { scimEventing } from "./eventing/scim.pipeline.ts";
import { scimRepositories } from "./repositories/scim-repositories.registry.ts";
import { SCIM_WEBHOOK_SIGNATURE_HEADER } from "./rules/scim-webhook-signature.rules.ts";
import { scimOversightTrpcTransport } from "./transport/scim-oversight.trpc.ts";
import { scimProtocolRest, scimRestCredential } from "./transport/scim-protocol.rest.ts";
import { scimReconciliationTrpcTransport } from "./transport/scim-reconciliation.trpc.ts";
import { scimTokenRest, scimTokenRestActor } from "./transport/scim-token.rest.ts";
import { scimTokenTrpcTransport } from "./transport/scim-token.trpc.ts";
import { scimWebhookDelivery, scimWebhookRest } from "./transport/scim-webhook.rest.ts";

export const scimProcessModule: PublishedProcessModule<"scim", ScimApi, ScimServerConfig> =
  defineProcessModule("scim")
    .withRepositories(scimRepositories)
    .withApi(ScimModule)
    .withTransports(
      scimTokenRest,
      scimTokenTrpcTransport,
      scimReconciliationTrpcTransport,
      scimOversightTrpcTransport,
      scimProtocolRest,
      scimWebhookRest,
    )
    // Who a management key stands for: the member it acts as, or the key itself
    // where it acts as nobody - one stable string per credential either way.
    .withTransportFacts(({ app }) => {
      if (!(app instanceof ScimModule))
        throw new TypeError("SCIM transport requires its constructed application");
      return [
        bindRestMiddleware(scimTokenRestActor, (context) => {
          const credential = organizationCredentialOfRequest(context.req.raw);

          return {
            actorId: credential.userId ?? `apikey:${credential.apiKeyId}`,
            apiKeyId: credential.apiKeyId,
          };
        }),
        bindRestMiddleware(scimRestCredential, (context) => {
          const credential = scimCredentialOfRequest(context.req.raw);

          return { connectionId: credential.connectionId };
        }),
        bindRestMiddleware(scimWebhookDelivery, (context) => ({
          signature: context.req.header(SCIM_WEBHOOK_SIGNATURE_HEADER) ?? null,
          authorization: context.req.header("authorization") ?? null,
        })),
        bindRestCredential("scim_token", () => app.directoryDoor),
      ];
    })
    .withEventing(scimEventing)
    .withEventing(scimDirectoryEventing)
    .withEventing(scimSyncEventing)
    .withEventing(scimCostCenterEventing)
    .withEventing(scimSsoConnectionEventing)
    .withMigrations(({ replayer }) => [
      defineProjectionReplayStep({
        id: "scim:replay-sso-connection-view",
        description: "Fills SCIM's SSO connection view from identity's connection log at deploy.",
        lane: `${SCIM_SSO_CONNECTION_PIPELINE_NAME}.${SCIM_SSO_CONNECTION_PROJECTION_NAME}`,
        needsOldWritersGone: true,
        trailingPass: true,
        replayer,
      }),
    ]);
