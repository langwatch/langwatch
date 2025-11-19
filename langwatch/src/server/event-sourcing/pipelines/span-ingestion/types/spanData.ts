/**
 * JSON-serializable DTO for span data.
 * This replaces the non-serializable ReadableSpan in command payloads.
 * Type is inferred from the Zod schema.
 */
export type { SpanData } from "../../../schemas/commands/spanIngestion.schema";
