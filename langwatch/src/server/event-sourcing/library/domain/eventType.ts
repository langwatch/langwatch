import { z } from "zod";
// Import type arrays from schemas for zod schema construction
// Schemas are the single source of truth for type identifiers
import { EVENT_TYPE_IDENTIFIERS } from "../../schemas";

/**
 * Array of all event types (for backwards compatibility).
 * Derived from schemas to ensure single source of truth.
 */
export const EVENT_TYPES = EVENT_TYPE_IDENTIFIERS;

/**
 * Zod schema for event type identifiers.
 * Built from type arrays defined in schemas.
 */
export const EventTypeSchema = z.enum(EVENT_TYPES);

/**
 * Strongly-typed event type identifiers.
 *
 * This type is inferred from the zod schema, which is built from type arrays
 * defined in schemas. Schemas are the single source of truth for type identifiers.
 */
export type EventType = z.infer<typeof EventTypeSchema>;
