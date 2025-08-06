import type { Hono } from "hono";
import { resolver } from "hono-openapi/zod";
import type { z } from "zod";

import type { LlmConfigWithLatestVersion } from "~/server/prompt-config/repositories/llm-config.repository";

import type { RouteResponse } from "../../../shared/types";
import { llmOutputFieldToJsonSchemaTypeMap } from "../constants";
import { type responseFormatSchema } from "../schemas";

export * from "./handle-possible-conflict-error";

export const getOutputsToResponseFormat = (
  config: LlmConfigWithLatestVersion
): z.infer<typeof responseFormatSchema> | null => {
  const outputs = config.latestVersion.configData.outputs;
  if (!outputs.length || (outputs.length === 1 && outputs[0]?.type === "str")) {
    return null;
  }

  return {
    type: "json_schema",
    json_schema: {
      name: "outputs",
      schema: {
        type: "object",
        properties: Object.fromEntries(
          outputs.map((output) => {
            if (output.type === "json_schema") {
              return [
                output.identifier,
                output.json_schema ?? { type: "object", properties: {} },
              ];
            }
            return [
              output.identifier,
              {
                type: llmOutputFieldToJsonSchemaTypeMap[output.type],
              },
            ];
          })
        ),
        required: outputs.map((output) => output.identifier),
      },
    },
  };
};

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
