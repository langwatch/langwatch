import { z } from "zod";

/**
 * Zod schema for the platform_create_dataset MCP tool parameters.
 *
 * Extracted so it can be shared between the MCP tool registration
 * (create-mcp-server.ts) and unit tests.
 */
export const createDatasetSchema = z.object({
  name: z.string().min(1).describe("Dataset name"),
  columnTypes: z
    .array(
      z.object({
        name: z.string().describe("Column name"),
        type: z
          .string()
          .describe(
            "Column type (e.g. 'string', 'number', 'boolean', 'json', 'list', 'chat_messages', 'rag_contexts', 'annotations')",
          ),
      }),
    )
    .optional()
    .describe("Column definitions for the dataset"),
});
