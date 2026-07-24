import { createProjectApp } from "~/server/api/security";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import {
  type EvaluatorAppVariables,
  registerEvaluatorRoutes,
} from "./app.v1";

patchZodOpenapi();

const secured = createProjectApp<EvaluatorAppVariables>({
  basePath: "/api/evaluators",
});

registerEvaluatorRoutes(secured);

export const app = secured.hono;
