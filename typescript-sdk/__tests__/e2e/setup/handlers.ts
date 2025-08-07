import { createOpenApiHttp } from "openapi-msw";
import { paths } from "../../../src/internal/generated/openapi/api-client";
import { promptResponseFactory } from "../../factories/prompt.factory";

const http = createOpenApiHttp<paths>({
  baseUrl: "https://app.langwatch.ai",
});

export const handles = [
  http.get("/api/prompts/{id}", ({ params, response }) => {
    const prompt = promptResponseFactory.build({
      id: params.id,
    });
    return response(200).json(prompt);
  }),
  http.post("/api/prompts", async ({ request, response }) => {
    const body = await request.json();
    const prompt = promptResponseFactory.build({
      handle: body.handle,
      name: body.name,
      scope: body.scope,
    });
    return response(200).json({
      ...prompt,
      // These should be part of the response but they aren't
      // this is a bug in the spec generation
      organizationId: "123",
      projectId: "123",
    });
  }),
  http.put("/api/prompts/{id}", async ({ params, request, response }) => {
    const body = await request.json();
    const prompt = promptResponseFactory.build({
      id: params.id,
      name: body.name,
    });
    return response(200).json(prompt);
  }),
  http.delete("/api/prompts/{id}", async ({ params, response }) => {
    return response(200).json({ success: true });
  }),
];
