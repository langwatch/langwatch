import { z } from "zod";
import { EVENT_TYPE_IDENTIFIERS } from "../schemas/typeIdentifiers";

/**
 * Event type identifiers follow a taxonomy system.
 * Format: `<provenance>.<domain>.<aggregate-type>.<event-name>`
 *
 * Example: "lw.obs.trace.span_received"
 * - `lw`: Provenance (LangWatch)
 * - `obs`: Domain (Observability)
 * - `trace`: Aggregate type
 * - `span_received`: Event name
 */

/**
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
 * Event types follow a taxonomy system:
 * `<provenance>.<domain>.<aggregate-type>.<event-name>`
 *
 * This type is inferred from the zod schema, which is built from type arrays
 * defined in schemas. Schemas are the single source of truth for type identifiers.
 */
export type EventType = z.infer<typeof EventTypeSchema>;
