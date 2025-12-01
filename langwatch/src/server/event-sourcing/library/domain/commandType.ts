import { z } from "zod";
import { COMMAND_TYPE_IDENTIFIERS } from "../../schemas/typeIdentifiers";

/**
 * Command type identifiers follow the taxonomy system defined in ./taxonomy.ts.
 * Format: `<provenance>.<domain>.<aggregate-type>.<command-name>`
 *
 * Example: "lw.obs.span_ingestion.record"
 * - `lw`: Provenance (LangWatch)
 * - `obs`: Domain (Observability)
 * - `span_ingestion`: Aggregate type
 * - `record`: Command name
 */

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
 * Command types follow the taxonomy system (see ./taxonomy.ts):
 * `<provenance>.<domain>.<aggregate-type>.<command-name>`
 *
 * This type is inferred from the zod schema, which is built from type arrays
 * defined in schemas. Schemas are the single source of truth for type identifiers.
 */
export type CommandType = z.infer<typeof CommandTypeSchema>;
