import { anyAuthenticated } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  LangyApi,
  langyInternalAcceptedSchema,
  langyInternalRevokedSchema,
  langyInternalTurnParamsSchema,
  langyRevokeCredentialsSchema,
  langyTurnResultSchema,
  langyRelayTallySchema,
} from "@langwatch/langy-contract";

const LANGY_SERVICE_REASON =
  "the caller is the deployment's own Langy service, not a tenant; its shared bearer is the whole gate and no RBAC grain applies";

export const langyInternalRest = defineRestRouter(LangyApi)
  .withNamespace("langy-internal")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .post("/api/internal/langy/turn/:turnId/result", "ingestTurnResult")
  .withoutAudit("ingestion")
  .withCredential("internal_secret")
  .withAccess(anyAuthenticated({ reason: LANGY_SERVICE_REASON }))
  .withParams(langyInternalTurnParamsSchema)
  .withInput(langyTurnResultSchema)
  .withOutput(langyInternalAcceptedSchema)
  .withStatus(202)
  .handle(({ app, input }) => app.ingestInternalTurnResult(input))

  .post("/api/internal/langy/credentials/revoke", "revokeWorkerSessionKey")
  .withAudit("langy.revokeWorkerSessionKey")
  .withCredential("internal_secret")
  .withAccess(anyAuthenticated({ reason: LANGY_SERVICE_REASON }))
  .withInput(langyRevokeCredentialsSchema)
  .withOutput(langyInternalRevokedSchema)
  .handle(({ app, input }) => app.revokeInternalCredentials(input))

  .post("/api/internal/langy/relay/frames", "streamRelayFrames")
  .withoutAudit("ingestion")
  .withCredential("internal_secret")
  .withAccess(anyAuthenticated({ reason: LANGY_SERVICE_REASON }))
  // NDJSON frames arrive on a long-lived stream and cannot be buffered before handling.
  .withRawBody("stream", { mediaType: "application/x-ndjson" })
  .withOutput(langyRelayTallySchema)
  .handle(({ app, raw }) => app.receiveInternalFrames(raw))
  .build();
