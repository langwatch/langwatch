import type { Hono } from "hono";
import { resolver } from "hono-openapi/zod";

import type { RouteResponse } from "../../../shared/types";

export * from "./handle-possible-conflict-error";

export const buildStandardSuccessResponse = (zodSchema: any): RouteResponse => {
  return {
    description: "Success",
    content: {
      "application/json": { schema: resolver(zodSchema) },
    },
  };
};

// Patches Hono's openapi spec generation to work correctly for /:id{.+} paths
export const patchHonoOpenApiSpecFix = (app: Hono<any>) => {
  const withOpenApiSpecFix =
    (
      fn: typeof app.get | typeof app.post | typeof app.put | typeof app.delete
    ) =>
    (path: string, ...args: any) => {
      fn(path, ...args);

      if (/\{.+?\}/g.test(path)) {
        // Hack: only here because hono does not generate openapi spec correctly for /:id{.+} paths
        fn(path.replace(/\{.+?\}/g, ""), ...args, async () => {
          throw new Error("This should not have been called");
        });
      }
    };

  //@ts-ignore
  app.get = withOpenApiSpecFix(app.get);
  //@ts-ignore
  app.post = withOpenApiSpecFix(app.post);
  //@ts-ignore
  app.put = withOpenApiSpecFix(app.put);
  //@ts-ignore
  app.delete = withOpenApiSpecFix(app.delete);
};
