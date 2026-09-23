// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The connect host (ADR-156, section 6): what a self-hosted install calls on
 * LangWatch Cloud. `connect.langwatch.ai/v1/*` maps onto `/api/v1/connect/*`.
 * The presented bearer is the whole credential; refusals are thrown by code.
 */
import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  connectActivationAnswerSchema,
  connectActivationRequestSchema,
  connectHostHeadersSchema,
  connectSyncAnswerSchema,
  LicensingApi,
  licenseSyncBodySchema,
} from "@langwatch/enterprise-licensing-contract";

const CONNECT_HOST_DOOR = publicRoute({
  reason:
    "a self-hosted install presents its license token or activation code as the bearer; no gateway and no session stand in front of the connect host",
});

/** A sync is a version and two seat counts; anything larger is not one. */
const SYNC_MAX_BODY_BYTES = 4 * 1024;

/** An activation carries its code in a header, so its body is empty. */
const ACTIVATE_MAX_BODY_BYTES = 1024;

export const connectHostRest = defineRestRouter(LicensingApi)
  .withNamespace("connect-host")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .post("/api/v1/connect/license/sync", "recordLicenseSync")
  .withInput(licenseSyncBodySchema)
  .withBodyLimit({ maxBytes: SYNC_MAX_BODY_BYTES })
  .withAccess(CONNECT_HOST_DOOR)
  .withHeaders(connectHostHeadersSchema)
  .withOutput(connectSyncAnswerSchema)
  .withDocs({ hide: true })
  .handle(({ input, app }, headers) =>
    app.recordLicenseSync({
      authorization: headers.authorization,
      instanceId: headers["x-langwatch-instance"],
      body: input,
    }),
  )

  .post("/api/v1/connect/license/activate", "redeemActivationCode")
  .withInput(connectActivationRequestSchema)
  .withBodyLimit({ maxBytes: ACTIVATE_MAX_BODY_BYTES })
  .withAccess(CONNECT_HOST_DOOR)
  .withHeaders(connectHostHeadersSchema)
  .withOutput(connectActivationAnswerSchema)
  .withDocs({ hide: true })
  .handle(({ app }, headers) =>
    app.redeemActivationCode({
      authorization: headers.authorization,
      instanceId: headers["x-langwatch-instance"],
    }),
  )
  .build();
