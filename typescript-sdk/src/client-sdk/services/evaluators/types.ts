import type { paths } from "@/internal/generated/openapi/api-client";

export type EvaluatorResponse = NonNullable<
  paths["/api/evaluators"]["get"]["responses"]["200"]["content"]["application/json"]
>[number] & {
  /** URL to view this evaluator on the LangWatch platform */
  platformUrl?: string;
};

export type EvaluatorField = EvaluatorResponse["fields"][number];

export type CreateEvaluatorBody = NonNullable<
  paths["/api/evaluators"]["post"]["requestBody"]
>["content"]["application/json"];

export type UpdateEvaluatorBody = NonNullable<
  paths["/api/evaluators/{id}"]["put"]["requestBody"]
>["content"]["application/json"];

export type DeleteEvaluatorResponse =
  paths["/api/evaluators/{id}"]["delete"]["responses"]["200"]["content"]["application/json"];
