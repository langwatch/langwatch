import type { paths } from "@/internal/generated/openapi/api-client";

export type EvaluatorResponse = NonNullable<
  paths["/api/evaluators"]["get"]["responses"]["200"]["content"]["application/json"]
>[number];

export type EvaluatorField = EvaluatorResponse["fields"][number];

export type CreateEvaluatorBody = NonNullable<
  paths["/api/evaluators"]["post"]["requestBody"]
>["content"]["application/json"];

export type DeleteEvaluatorResponse =
  paths["/api/evaluators/{id}"]["delete"]["responses"]["200"]["content"]["application/json"];
