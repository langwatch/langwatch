import { defineRestRouter, MANAGEMENT_API_VERSION, type RestEvent } from "@langwatch/api/rest";
import {
  executeRequestSchema,
  PromptApi,
  type PlaygroundStreamEvent,
  PROMPT_EXECUTE_ENDPOINT,
} from "@langwatch/prompt-contract";

async function* events(source: AsyncIterable<PlaygroundStreamEvent>): AsyncIterable<RestEvent> {
  for await (const event of source) yield { data: JSON.stringify(event) };
}

export const promptExecuteRest = defineRestRouter(PromptApi)
  .withNamespace("prompt-playground")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("browser")
  .withAddressing("literal", { v1Twin: false })
  .post(PROMPT_EXECUTE_ENDPOINT, "promptExecute")
  .withInput(executeRequestSchema)
  .withPermission("prompts:view", { at: "route", param: "projectId" })
  .withResponse("sse", {})
  .withDocs({ hide: true, description: "Streams playground execution events." })
  .handle(async ({ app, input, response }) =>
    response.events(events(await app.executePlayground(input))),
  )
  .build();
