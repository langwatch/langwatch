/**
 * The terminal's control requests, `/api/v1/langy/control/requests` (ADR-129), on the developer's
 * own key: the door puts the key's owner on the actor, and each route makes one LangyApi call.
 */

import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  approveControlRequestBodySchema,
  approveControlRequestResponseSchema,
  controlActionBodySchema,
  LangyApi,
  listControlRequestsResponseSchema,
  langyControlIdParamsSchema,
  langyControlCancelResultSchema,
} from "@langwatch/langy-contract";

export const langyLocalControlRest = defineRestRouter(LangyApi)
  .withNamespace("langy")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("project")
  .withAddressing("literal", { v1Twin: true })

  .get("/api/langy/control/requests", "listLangyControlRequests")
  .withPermission("langy:view")
  .withOutput(listControlRequestsResponseSchema)
  .withDocs({
    description:
      "List the open requests Langy made for a folder of mine, on every project I can read. Only the " +
      "person Langy asked ever sees a request, and each one expires fifteen minutes after " +
      "it was made.",
  })
  .handle(({ app, actor }) => app.listLocalControlRequests({ actor }))

  .post("/api/langy/control/requests/:requestId/approve", "approveLangyControlRequest")
  .withPermission("langy:create")
  .withParams(langyControlIdParamsSchema)
  .withInput(approveControlRequestBodySchema)
  .withOutput(approveControlRequestResponseSchema)
  .withDocs({
    description:
      "Approve one request and share the current folder with the conversation that asked. " +
      "Answers with a Langy session key scoped to that conversation, which is never shown " +
      "again. A request is single use: a second approval is refused.",
  })
  .handle(({ app, input, actor }) =>
    app.approveLocalControlRequest({ actor, requestId: input.requestId }),
  )

  .post("/api/langy/control/requests/:requestId/cancel", "cancelLangyControlRequest")
  .withPermission("langy:create")
  .withParams(langyControlIdParamsSchema)
  .withInput(controlActionBodySchema)
  .withOutput(langyControlCancelResultSchema)
  .withDocs({
    description:
      "Refuse one request from the terminal. The card in the chat reads that sharing was " +
      "cancelled, and Langy's next turn offers the choice again.",
  })
  .handle(({ app, input, actor }) =>
    app.cancelLocalControlRequest({ actor, requestId: input.requestId }),
  )

  .build();
