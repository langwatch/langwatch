import { z } from "zod";

/**
 * Command type format: `<provenance>.<domain>.<aggregate-type>.<command-name>`,
 * e.g. "lw.obs.trace.record_span". Wire boundary schema for command types.
 */
export const CommandTypeSchema = z.string().trim().min(1);

/**
 * Strongly-typed command type identifiers used for routing and processing.
 */
export type CommandType = z.infer<typeof CommandTypeSchema>;
