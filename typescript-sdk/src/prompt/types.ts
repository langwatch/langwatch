import type { paths } from "../internal/generated/openapi/api-client";

// Extract types directly from OpenAPI schema for strong type safety.
export type CreatePromptBody = NonNullable<
  paths["/api/prompts"]["post"]["requestBody"]
>["content"]["application/json"];
export type UpdatePromptBody = NonNullable<
  paths["/api/prompts/{id}"]["put"]["requestBody"]
>["content"]["application/json"];
export type CreateVersionBody = NonNullable<
  paths["/api/prompts/{id}/versions"]["post"]["requestBody"]
>["content"]["application/json"];
export type SyncBody = NonNullable<
  paths["/api/prompts/{id}/sync"]["post"]["requestBody"]
>["content"]["application/json"];
