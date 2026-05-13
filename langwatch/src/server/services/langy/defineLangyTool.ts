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

// Two casts at the SDK boundary — one to make `tool()`'s overload set accept
// our generic-typed object literal (it can't infer through our wrapper's
// generics), one to preserve the precise `Tool<Input, Output>` shape on the
// way back out. Both are local to this function: callers of defineLangyTool
// see fully-typed inputs and outputs.
export function defineLangyTool<
  TInputSchema extends z.ZodType,
  TOutput,
>(args: {
  name: string;
  description: string;
  inputSchema: TInputSchema;
  outputSchema: z.ZodType<TOutput>;
  execute: (input: z.infer<TInputSchema>) => Promise<TOutput>;
}): Tool<z.infer<TInputSchema>, TOutput> {
  type Input = z.infer<TInputSchema>;

  const definition = {
    description: args.description,
    inputSchema: args.inputSchema,
    execute: async (input: Input): Promise<TOutput> => {
      const raw = await args.execute(input);
      const parsed = args.outputSchema.safeParse(raw);

      if (!parsed.success) {
        logger.warn(
          { tool: args.name, issues: parsed.error.issues },
          "langy tool output failed schema validation",
        );
        const envelope: LangyToolErrorEnvelope = {
          error: {
            code: LANGY_TOOL_OUTPUT_INVALID_CODE,
            message: "Tool returned data in an unexpected shape.",
            issues: parsed.error.issues,
          },
        };
        return envelope as unknown as TOutput;
      }

      return parsed.data;
    },
  };

  return tool(
    definition as unknown as Parameters<typeof tool<Input, TOutput>>[0],
  ) as Tool<Input, TOutput>;
}
