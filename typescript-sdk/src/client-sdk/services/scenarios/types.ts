import type { paths } from "@/internal/generated/openapi/api-client";

export type ScenarioResponse = NonNullable<
  paths["/api/scenarios"]["get"]["responses"]["200"]["content"]["application/json"]
>[number] & {
  /** URL to view this scenario on the LangWatch platform */
  platformUrl?: string;
};

export type CreateScenarioBody = NonNullable<
  paths["/api/scenarios"]["post"]["requestBody"]
>["content"]["application/json"];

export type UpdateScenarioBody = NonNullable<
  paths["/api/scenarios/{id}"]["put"]["requestBody"]
>["content"]["application/json"];

export type DeleteScenarioResponse =
  paths["/api/scenarios/{id}"]["delete"]["responses"]["200"]["content"]["application/json"];
