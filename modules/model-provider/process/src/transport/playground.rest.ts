/**
 * `POST /api/v1/playground` (and bare `/api/playground`) — the model playground's streaming
 * proxy. The door uses the browser session and the project named by its parsed header target.
 */
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  ModelProviderApi,
  playgroundRestBodySchema,
  playgroundRestHeadersSchema,
} from "@langwatch/model-provider-contract";

export const playgroundRest = defineRestRouter(ModelProviderApi)
  .withNamespace("playground")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })
  .withCredential("browser")

  .post("/api/playground", "runPlaygroundCompletion")
  .withInput(playgroundRestBodySchema)
  .withHeaders(playgroundRestHeadersSchema)
  .withPermission("playground:view", {
    at: "header",
    param: "projectId",
    header: "x-project-id",
  })
  .withResponse("bytes", {
    produces: ["text/plain", "application/json"],
    because: "The AI SDK owns the text stream and provider refusal response body.",
  })
  .handle(async ({ app, input, response }, headers) => {
    const completion = await app.runPlaygroundCompletion({
      projectId: headers["x-project-id"] ?? "",
      model: headers["x-model"] ?? "",
      systemPrompt: headers["x-system-prompt"] ?? null,
      messages: input.messages,
    });

    return response.stream(completion.body, {
      mediaType: completion.mediaType,
      status: completion.status,
      headers: completion.headers,
    });
  })
  .build();
