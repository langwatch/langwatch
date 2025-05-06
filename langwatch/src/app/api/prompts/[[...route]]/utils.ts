import type { z } from "zod";
import { responseFormatSchema } from "./schemas";
import { llmOutputFieldToJsonSchemaTypeMap } from "./constants";
import type { LlmConfigWithLatestVersion } from "~/server/prompt-config/types";

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
