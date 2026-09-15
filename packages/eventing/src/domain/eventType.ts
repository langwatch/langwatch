import { z } from "zod";

/**
 * Event type format: `<provenance>.<domain>.<aggregate-type>.<event-name>`
 * Example: "lw.obs.trace.span_received"
 */
/**
 * Wire shape validation schema. Applications register installed types in EventCatalogue.
 */
export const EventTypeSchema = z.string().trim().min(1);

/**
 * Strongly-typed event type identifiers. Applications register types in EventCatalogue.
 */
export type EventType = z.infer<typeof EventTypeSchema>;
