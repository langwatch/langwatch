/**
 * Reading an offloaded value back out of a trace event's payload: the shapes the payload may
 * take, and which of them carries the field asked for. Pure, so the parsing is stated once.
 */

import { z } from "zod";

/**
 * Span attribute entry inside EventPayload, which stores raw OTLP spans. The read path needs only
 * offloaded IO fields, so this reads stringValue alone. Attributes are parsed per element, so a
 * malformed sibling can never fail the whole-array parse and mask the offloaded field.
 */
const spanAttributeSchema = z.object({
  key: z.string(),
  value: z.object({ stringValue: z.string().optional() }),
});

/**
 * @see ADR-022
 * Parsed EventPayload structure, the full event as stored by the command worker; the span write
 * shape sits at the top level with no outer data wrapper. Attributes stay unknown per element.
 */
export const eventPayloadSchema = z.object({
  span: z
    .object({
      attributes: z.array(z.unknown()),
    })
    .optional(),
  body: z.string().optional(),
});

/** One parsed payload as a typed shape, so the reader below can be stated without a cast. */
type EventLogPayload = z.infer<typeof eventPayloadSchema>;

/**
 * The offloaded value the payload holds for `field`, or null when it holds none. A log-record body
 * sits at the top level; a span attribute is found by key, each entry parsed on its own so a
 * malformed sibling can never mask the offloaded field.
 */
export function findEventPayloadField(payload: EventLogPayload, field: string): string | null {
  if (field === "body") {
    return typeof payload.body === "string" ? payload.body : null;
  }

  for (const raw of payload.span?.attributes ?? []) {
    const attr = spanAttributeSchema.safeParse(raw);
    if (!attr.success || attr.data.key !== field) continue;
    const { stringValue } = attr.data.value;
    if (typeof stringValue === "string") {
      return stringValue;
    }
  }

  return null;
}
