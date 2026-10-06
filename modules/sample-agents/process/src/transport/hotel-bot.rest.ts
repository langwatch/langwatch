/**
 * `POST /api/demo/hotel_bot` - the scripted demo agent behind the sample project. LangWatch
 * staff only (ruling 2026-10-05): the browser door asks `ops:manage` at the platform tier and
 * hides the route from everyone else; the X-Auth-Token is the project key the traces post with.
 */
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  hotelBotHeadersSchema,
  hotelBotReplySchema,
  hotelBotRequestSchema,
  SampleAgentsApi,
} from "@langwatch/sample-agents-contract";

export const hotelBotRest = defineRestRouter(SampleAgentsApi)
  .withNamespace("demo")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .post("/api/demo/hotel_bot", "runHotelBot")
  .withInput(hotelBotRequestSchema)
  .withCredential("browser")
  .withPermission("ops:manage", { at: "platform", refusal: "hidden" })
  .withHeaders(hotelBotHeadersSchema)
  .withOutput(hotelBotReplySchema)
  .withDocs({ hide: true })
  .handle(({ app }, headers) => app.runHotelBot({ authToken: headers["x-auth-token"] }))
  .build();
