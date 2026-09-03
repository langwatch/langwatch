import { z } from "zod";

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
 * The framework validates the wire shape here. Applications register the
 * finite set of installed types in an EventCatalogue.
 */
export const EventTypeSchema = z.string().trim().min(1);

/**
 * Strongly-typed event type identifiers.
 *
 * Event types follow a taxonomy system:
 * `<provenance>.<domain>.<aggregate-type>.<event-name>`
 *
 * A package cannot know every event installed by an application. Literal event
 * types remain intact through generic definitions; the base framework type is
 * therefore the non-empty wire string.
 */
export type EventType = z.infer<typeof EventTypeSchema>;
