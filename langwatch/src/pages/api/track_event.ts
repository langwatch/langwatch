import * as Sentry from "@sentry/nextjs";
import { nanoid } from "nanoid";
import { type NextApiRequest, type NextApiResponse } from "next";
import { z } from "zod";
import { trackEventsQueue } from "../../server/background/queues/trackEventsQueue";
import { prisma } from "../../server/db"; // Adjust the import based on your setup
import {
  type TrackEventRESTParamsValidator
} from "../../server/tracer/types";
import { trackEventRESTParamsValidatorSchema } from "../../server/tracer/types.generated";
import { getDebugger } from "../../utils/logger";

const thumbsUpDownSchema = z.object({
  trace_id: z.string(),
  event_type: z.literal("thumbs_up_down"),
  metrics: z.object({
    vote: z.number().min(-1).max(1),
  }),
  event_details: z
    .object({
      feedback: z.string().optional(),
    })
    .optional(),
});

const selectedTextSchema = z.object({
  trace_id: z.string(),
  event_type: z.literal("selected_text"),
  metrics: z.object({
    text_length: z.number().positive(),
  }),
  event_details: z
    .object({
      selected_text: z.string().optional(),
    })
    .optional(),
});

const waitedToFinishSchema = z.object({
  trace_id: z.string(),
  event_type: z.literal("waited_to_finish"),
  metrics: z.object({
    finished: z.number().min(0).max(1),
  }),
  event_details: z.object({}).optional(),
});

export const predefinedEventsSchemas = z.union([
  thumbsUpDownSchema,
  selectedTextSchema,
  waitedToFinishSchema,
]);

const predefinedEventTypes = predefinedEventsSchemas.options.map(
  (schema) => schema.shape.event_type.value
);

export const debug = getDebugger("langwatch:track_event");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).end(); // Only accept POST requests
  }

  const authToken = req.headers["x-auth-token"];
  if (!authToken) {
    return res
      .status(401)
      .json({ message: "X-Auth-Token header is required." });
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken as string },
  });
  if (!project) {
    return res.status(401).json({ message: "Invalid auth token." });
  }

  let body: TrackEventRESTParamsValidator;
  try {
    body = trackEventRESTParamsValidatorSchema.parse(req.body);
  } catch (error) {
    debug(
      "Invalid event received",
      error,
      JSON.stringify(req.body, null, "  ")
    );
    Sentry.captureException(error);
    return res.status(400).json({ error: "Invalid event format." });
  }

  if (predefinedEventTypes.includes(req.body.event_type)) {
    try {
      predefinedEventsSchemas.parse(req.body);
    } catch (error) {
      debug(
        "Invalid event received",
        error,
        JSON.stringify(req.body, null, "  ")
      );
      Sentry.captureException(error);
      return res.status(400).json({ error: "Invalid event format." });
    }
  }

  const eventId = body.id
    ? `event_${project.id}_${body.id}`
    : `event_${nanoid()}`;

  await trackEventsQueue.add(
    "track_event",
    {
      project_id: project.id,
      postpone_count: 0,
      event: { ...body, id: eventId, timestamp: body.timestamp ?? Date.now() },
    },
    {
      jobId: `track_event_${eventId}`,
      // Add a delay to track events to possibly wait for trace data to be available for the grouping keys
      delay: process.env.VITEST_MODE ? 0 : 5000,
      attempts: 3,
    }
  );

  return res.status(200).json({ message: "Event tracked" });
}
