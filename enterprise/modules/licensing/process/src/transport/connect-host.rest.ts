// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The connect host (ADR-156, section 6): what a self-hosted install calls on
 * LangWatch Cloud. `connect.langwatch.ai/v1/*` maps onto `/api/connect/v1/*`.
 * The `licence_token` door verifies the bearer before the body; refusals keep their codes.
 */
import { anyAuthenticated } from "@langwatch/api/access";
import {
  defineRestRouter,
  LicenceTokenIdentity,
  MANAGEMENT_API_VERSION,
  type RestDoor,
} from "@langwatch/api/rest";
import {
  connectActivationAnswerSchema,
  connectActivationCallerSchema,
  connectActivationRequestSchema,
  connectLicenceCallerSchema,
  connectSyncAnswerSchema,
  LicensingApi,
  licenseSyncBodySchema,
} from "@langwatch/enterprise-licensing-contract";

const CONNECT_HOST_ACCESS = anyAuthenticated({
  reason:
    "a self-hosted install presents its license token or activation code as the bearer; the door verifies it and no permission names a licence holder",
});

const SYNC_PATH = "/api/connect/v1/license/sync";
const ACTIVATE_PATH = "/api/connect/v1/license/activate";

/** A sync is a version and two seat counts; anything larger is not one. */
const SYNC_MAX_BODY_BYTES = 4 * 1024;

/** An activation carries its code in a header, so its body is empty. */
const ACTIVATE_MAX_BODY_BYTES = 1024;

/** The two checks behind the door: an activation code on the activate path, else a licence token. */
export type ConnectBearerVerifiers = Pick<
  LicensingApi,
  "verifyLicenceToken" | "verifyActivationCode"
>;

export function connectHostDoor(verifiers: ConnectBearerVerifiers): RestDoor {
  return LicenceTokenIdentity.create({
    verify: async ({ authorization, instanceId, path }) => {
      const presented = {
        authorization: authorization ?? undefined,
        instanceId: instanceId ?? undefined,
      };
      const caller =
        path === ACTIVATE_PATH
          ? await verifiers.verifyActivationCode(presented)
          : await verifiers.verifyLicenceToken(presented);

      return { organizationId: caller.organizationId, session: caller };
    },
  });
}

export const connectHostRest = defineRestRouter(LicensingApi)
  .withNamespace("connect-host")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("licence_token")

  .post(SYNC_PATH, "recordLicenseSync")
  .withCredential("licence_token", { session: connectLicenceCallerSchema })
  .withInput(licenseSyncBodySchema)
  .withBodyLimit({ maxBytes: SYNC_MAX_BODY_BYTES })
  .withAccess(CONNECT_HOST_ACCESS)
  .withOutput(connectSyncAnswerSchema)
  .withDocs({ hide: true })
  .handle(({ input, app, session }) => app.recordLicenseSync({ caller: session, body: input }))

  .post(ACTIVATE_PATH, "redeemActivationCode")
  .withCredential("licence_token", { session: connectActivationCallerSchema })
  .withInput(connectActivationRequestSchema)
  .withBodyLimit({ maxBytes: ACTIVATE_MAX_BODY_BYTES })
  .withAccess(CONNECT_HOST_ACCESS)
  .withOutput(connectActivationAnswerSchema)
  .withDocs({ hide: true })
  .handle(({ app, session }) => app.redeemActivationCode(session))
  .build();
