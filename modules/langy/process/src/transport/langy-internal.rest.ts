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

export const langyInternalRest = defineRestRouter(LangyApi)
  .withNamespace("langy-internal")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .post("/api/internal/langy/turn/:turnId/result", "ingestTurnResult")
  .withCredential("internalSecret")
  .withAccess(
    anyAuthenticated({ reason: "The deployment's Langy bearer authenticates its control plane." }),
  )
  .withParams(langyInternalTurnParamsSchema)
  .withInput(langyTurnResultSchema)
  .withOutput(langyInternalAcceptedSchema)
  .withStatus(202)
  .handle(({ app, input }) => app.ingestInternalTurnResult(input))

  .post("/api/internal/langy/credentials/revoke", "revokeWorkerSessionKey")
  .withCredential("internalSecret")
  .withAccess(
    anyAuthenticated({ reason: "The deployment's Langy bearer authenticates its control plane." }),
  )
  .withInput(langyRevokeCredentialsSchema)
  .withOutput(langyInternalRevokedSchema)
  .handle(({ app, input }) => app.revokeInternalCredentials(input))

  .post("/api/internal/langy/relay/frames", "streamRelayFrames")
  .withCredential("internalSecret")
  .withAccess(
    anyAuthenticated({ reason: "The deployment's Langy bearer authenticates its control plane." }),
  )
  // NDJSON frames arrive on a long-lived stream and cannot be buffered before handling.
  .withRawBody("stream", { mediaType: "application/x-ndjson" })
  .withOutput(langyRelayTallySchema)
  .handle(({ app, raw }) => app.receiveInternalFrames(raw))
  .build();
