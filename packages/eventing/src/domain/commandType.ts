import { z } from "zod";

/**
 * Command type identifiers follow a taxonomy system.
 * Format: `<provenance>.<domain>.<aggregate-type>.<command-name>`
 *
 * Example: "lw.obs.trace.record_span"
 * - `lw`: Provenance (LangWatch)
 * - `obs`: Domain (Observability)
 * - `trace`: Aggregate type
 * - `record_span`: Command name
 */

/**
 * Applications register installed commands through their pipeline catalogue.
 * This schema protects the framework's wire boundary without importing any
 * application-owned command registry.
 */
export const CommandTypeSchema = z.string().trim().min(1);

/**
 * Strongly-typed command type identifiers.
 *
 * Command types represent the type of command being executed (e.g., "lw.obs.span_ingestion.record").
 * These are used for routing and processing commands in the event sourcing system.
 *
 * Command types follow a taxonomy system:
 * `<provenance>.<domain>.<aggregate-type>.<command-name>`
 *
 * Literal command identifiers are preserved by defineCommand and pipeline
 * registration; the framework base type is the non-empty wire string.
 */
export type CommandType = z.infer<typeof CommandTypeSchema>;
