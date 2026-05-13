import { tool, type Tool } from "ai";
import { z } from "zod";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:langy:tools:defineLangyTool");

export const LANGY_TOOL_OUTPUT_INVALID_CODE = "tool_output_invalid" as const;

export const langyToolErrorEnvelope = z.object({
  error: z.object({
    code: z.literal(LANGY_TOOL_OUTPUT_INVALID_CODE),
    message: z.string(),
    issues: z.array(z.unknown()).optional(),
  }),
});

export type LangyToolErrorEnvelope = z.infer<typeof langyToolErrorEnvelope>;

export function defineLangyTool<TInput, TOutput>({
  name,
  description,
  inputSchema,
  outputSchema,
  execute,
}: {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  execute: (input: TInput) => Promise<TOutput>;
}) {
  const execWithValidation = async (input: TInput) => {
    const raw = await execute(input);
    const parsed = outputSchema.safeParse(raw);

    if (!parsed.success) {
      logger.warn(
        { tool: name, issues: parsed.error.issues },
        "langy tool output failed schema validation",
      );
      return {
        error: {
          code: LANGY_TOOL_OUTPUT_INVALID_CODE,
          message: "Tool returned data in an unexpected shape.",
          issues: parsed.error.issues,
        },
      } as LangyToolErrorEnvelope;
    }

    return parsed.data;
  };

  return tool({
    description,
    inputSchema: inputSchema as unknown as z.ZodType<TInput>,
    execute: execWithValidation,
  } as unknown as Parameters<typeof tool<TInput, TOutput | LangyToolErrorEnvelope>>[0]) as Tool<TInput, TOutput | LangyToolErrorEnvelope>;
}
