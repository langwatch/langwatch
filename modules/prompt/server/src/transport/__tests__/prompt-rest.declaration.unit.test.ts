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
      ["get", "/api/prompts", "listPrompts", "prompts:view"],
      ["put", "/api/prompts/:id{.+?}/tags/:tag", "assignPromptTag", "prompts:manage"],
      ["get", "/api/prompts/tags", "listPromptTags", "prompts:view"],
      ["post", "/api/prompts/tags", "createPromptTag", "prompts:manage"],
      ["put", "/api/prompts/tags/:tag", "renamePromptTag", "prompts:manage"],
      ["delete", "/api/prompts/tags/:tag", "deletePromptTag", "prompts:manage"],
      ["get", "/api/prompts/:id{.+?}/versions", "listPromptVersions", "prompts:view"],
      [
        "post",
        "/api/prompts/:id{.+?}/versions/:versionId/restore",
        "restorePromptVersion",
        "prompts:update",
      ],
      ["get", "/api/prompts/:id{.+}", "getPrompt", "prompts:view"],
      ["post", "/api/prompts", "createPrompt", "prompts:create"],
      ["post", "/api/prompts/:id{.+?}/sync", "syncPrompt", "prompts:manage"],
      ["put", "/api/prompts/:id{.+}", "updatePrompt", "prompts:update"],
      ["delete", "/api/prompts/:id{.+}", "deletePrompt", "prompts:manage"],
    ]);
  });

  it("answers behind a project key, at its own paths and their /api/v1 twins", () => {
    const declaration = promptRest.router();

    expect(declaration.credential).toBe("project");
    expect(declaration.addressing).toBe("literal");
    expect(declaration.v1Twin).toBe(true);
  });
});
