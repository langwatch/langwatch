/**
 * `POST /api/demo/hotel_bot` - the scripted demo agent behind the sample project. The
 * project-scoped API-key door verifies the caller, so the traces land in that project
 * (Alex 2026-10-10 W02-HOTEL-BOT).
 */
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  hotelBotReplySchema,
  hotelBotRequestSchema,
  SampleAgentsApi,
} from "@langwatch/sample-agents-contract";

export const hotelBotRest = defineRestRouter(SampleAgentsApi)
  .withNamespace("demo")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .post("/api/demo/hotel_bot", "runHotelBot")
  .withoutAudit("run, not a change")
  .withInput(hotelBotRequestSchema)
  .withCredential("project", { key: true })
  .withPermission("traces:create")
  .withOutput(hotelBotReplySchema)
  .withDocs({ hide: true })
  .handle(({ app, scope, key }) =>
    app.runHotelBot({
      projectId: scope.id,
      startedByApiKeyId: key.apiKeyId,
      startedByUserId: key.ownerUserId,
    }),
  )
  .build();
