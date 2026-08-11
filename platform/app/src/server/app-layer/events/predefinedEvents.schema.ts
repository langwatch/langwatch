import { z } from "zod";

/**
 * Predefined tracked-event schemas, isolated from the ingestion service so
 * lightweight consumers (e.g. the trackedEventSync reactor) can validate a
 * payload without pulling the app singleton + Prisma graph into their import
 * tree. The ingestion service and both `track`/`track_event` routes import
 * these directly.
 */

const thumbsUpDownSchema = z.object({
  trace_id: z.string(),
  event_type: z.literal("thumbs_up_down"),
  metrics: z.object({ vote: z.number().min(-1).max(1) }),
  event_details: z.object({ feedback: z.string().nullish() }).optional(),
});

const selectedTextSchema = z.object({
  trace_id: z.string(),
  event_type: z.literal("selected_text"),
  metrics: z.object({ text_length: z.number().positive() }),
  event_details: z.object({ selected_text: z.string().optional() }).optional(),
});

const waitedToFinishSchema = z.object({
  trace_id: z.string(),
  event_type: z.literal("waited_to_finish"),
  metrics: z.object({ finished: z.number().min(0).max(1) }),
  event_details: z.object({}).optional(),
});

/**
 * Predefined event-type schemas (`thumbs_up_down`, `selected_text`,
 * `waited_to_finish`). Custom event types validate against
 * `trackEventRESTParamsValidatorSchema` only.
 */
export const predefinedEventsSchemas = z.union([
  thumbsUpDownSchema,
  selectedTextSchema,
  waitedToFinishSchema,
]);

export const predefinedEventTypes = predefinedEventsSchemas.options.map(
  (schema) => schema.shape.event_type.value,
);
