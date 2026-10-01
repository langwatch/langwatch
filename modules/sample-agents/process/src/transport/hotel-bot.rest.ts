/** `POST /api/demo/hotel_bot` - the scripted demo agent behind the sample project. */
import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  hotelBotHeadersSchema,
  hotelBotReplySchema,
  hotelBotRequestSchema,
  SampleAgentsApi,
} from "@langwatch/sample-agents-contract";

const HOTEL_BOT_DOOR = publicRoute({
  reason:
    "the caller's X-Auth-Token is forwarded unread to /api/collector, which authenticates it, as main's demo door did",
});

export const hotelBotRest = defineRestRouter(SampleAgentsApi)
  .withNamespace("demo")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .post("/api/demo/hotel_bot", "runHotelBot")
  .withInput(hotelBotRequestSchema)
  .withAccess(HOTEL_BOT_DOOR)
  .withHeaders(hotelBotHeadersSchema)
  .withOutput(hotelBotReplySchema)
  .withDocs({ hide: true })
  .handle(({ app }, headers) => app.runHotelBot({ authToken: headers["x-auth-token"] }))
  .build();
