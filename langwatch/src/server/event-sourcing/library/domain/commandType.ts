import { z } from "zod";
// Import type arrays from schemas for zod schema construction
// Schemas are the single source of truth for type identifiers
import { COMMAND_TYPE_IDENTIFIERS } from "../../schemas";

/**
 * Array of all command types (for backwards compatibility).
 * Derived from schemas to ensure single source of truth.
 */
export const COMMAND_TYPES = COMMAND_TYPE_IDENTIFIERS;

/**
 * Zod schema for command type identifiers.
 * Built from type arrays defined in schemas.
 */
export const CommandTypeSchema = z.enum(COMMAND_TYPES);

/**
 * Strongly-typed command type identifiers.
 *
 * Command types represent the type of command being executed (e.g., "lw.obs.span_ingestion.record").
 * These are used for routing and processing commands in the event sourcing system.
 *
 * This type is inferred from the zod schema, which is built from type arrays
 * defined in schemas. Schemas are the single source of truth for type identifiers.
 */
export type CommandType = z.infer<typeof CommandTypeSchema>;
