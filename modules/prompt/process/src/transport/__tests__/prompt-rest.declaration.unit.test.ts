/**
 * The `/api/prompts` family, as the published contract has it: every address,
 * in the order the router resolves them, with the permission each asks for.
 */
import { describe, expect, it } from "vitest";

import { promptRest } from "../prompt.rest.ts";

describe("the prompts REST declaration", () => {
  it("publishes every route at its literal address, in resolution order", () => {
    const declaration = promptRest.router();

    expect(
      declaration.routes.map((route) => [
        route.method,
        route.path,
        route.operation,
        route.permission,
      ]),
    ).toEqual([
      ["get", "/api/prompts", "getApiPrompts", "prompts:view"],
      ["put", "/api/prompts/:id{.+?}/tags/:tag", "putApiPromptsByIdTagsByTag", "prompts:manage"],
      ["get", "/api/prompts/tags", "getApiPromptsTags", "prompts:view"],
      ["post", "/api/prompts/tags", "postApiPromptsTags", "prompts:manage"],
      ["put", "/api/prompts/tags/:tag", "putApiPromptsTagsByTag", "prompts:manage"],
      ["delete", "/api/prompts/tags/:tag", "deleteApiPromptsTagsByTag", "prompts:manage"],
      ["get", "/api/prompts/:id{.+?}/versions", "getApiPromptsByIdVersions", "prompts:view"],
      [
        "post",
        "/api/prompts/:id{.+?}/versions/:versionId/restore",
        "postApiPromptsByIdVersionsByVersionIdRestore",
        "prompts:update",
      ],
      ["get", "/api/prompts/:id{.+}", "getApiPromptsById", "prompts:view"],
      ["post", "/api/prompts", "postApiPrompts", "prompts:create"],
      ["post", "/api/prompts/:id{.+?}/sync", "postApiPromptsByIdSync", "prompts:manage"],
      ["put", "/api/prompts/:id{.+}", "putApiPromptsById", "prompts:update"],
      ["delete", "/api/prompts/:id{.+}", "deleteApiPromptsById", "prompts:manage"],
    ]);
  });

  it("answers behind a project key, at its own paths and their /api/v1 twins", () => {
    const declaration = promptRest.router();

    expect(declaration.credential).toBe("project");
    expect(declaration.addressing).toBe("literal");
    expect(declaration.v1Twin).toBe(true);
  });

  it("publishes each success body as a caller receives it, defaulted fields required", async () => {
    const declaration = promptRest.router();
    const published = await Promise.all(
      declaration.routes.map(async (route) => {
        const schema = route.docs?.responses?.[200]?.content?.["application/json"]?.schema;
        if (
          !schema ||
          !("toOpenAPISchema" in schema) ||
          typeof schema.toOpenAPISchema !== "function"
        ) {
          return [route.operation, undefined];
        }
        const { schema: body } = await schema.toOpenAPISchema();
        return [route.operation, body.items?.required ?? body.required];
      }),
    );
    const required = Object.fromEntries(published);

    for (const operation of ["getApiPrompts", "getApiPromptsById", "putApiPromptsById"]) {
      expect(required[operation]).toEqual(
        expect.arrayContaining(["messages", "inputs", "tags", "parameters"]),
      );
    }
    expect(required.getApiPromptsTags).toEqual(["id", "name", "createdAt"]);
  });
});
