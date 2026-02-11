import type { paths } from "@/internal/generated/openapi/api-client";

export type EvaluatorResponse = NonNullable<
  paths["/api/evaluators"]["get"]["responses"]["200"]["content"]["application/json"]
>[number];

export type EvaluatorField = EvaluatorResponse["fields"][number];
