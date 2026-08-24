import type { MiddlewareHandler } from "hono";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import { appFromContext } from "./app-context";

export type EvaluatorServiceMiddlewareVariables = {
  evaluatorService: EvaluatorService;
};

export const evaluatorServiceMiddleware: MiddlewareHandler = async (
  c,
  next,
) => {
  c.set("evaluatorService", appFromContext(c).evaluators);
  await next();
};
