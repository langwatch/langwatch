import { generate } from "@langwatch/ksuid";
import { SpanStatusCode } from "@opentelemetry/api";
import { ESpanKind } from "@opentelemetry/otlp-transformer-next/build/esm/trace/internal-types";
import type { NextApiRequest, NextApiResponse } from "next";
import { type ZodError, z } from "zod";
import { fromZodError } from "zod-validation-error";
import { getApp } from "~/server/app-layer/app";
import { KSUID_RESOURCES } from "~/utils/constants";
import { normalizeHeaderValue } from "~/utils/headers";
import { captureException } from "~/utils/posthogErrorCapture";
import { generateOtelSpanId } from "~/utils/trace";
import { prisma } from "../../../src/server/db"; // Adjust the import based on your setup
import type { TrackEventRESTParamsValidator } from "../../../src/server/tracer/types";
import { trackEventRESTParamsValidatorSchema } from "../../../src/server/tracer/types.generated";
import { TRACK_EVENTS_QUEUE, trackEventsQueue } from "../../server/background/queues/trackEventsQueue";
import { createLogger } from "../../utils/logger/server";

const thumbsUpDownSchema = z.object({
  trace_id: z.string(),
  event_type: z.literal("thumbs_up_down"),
  metrics: z.object({
    vote: z.number().min(-1).max(1),
  }),
  event_details: z
    .object({
      feedback: z.string().nullish(),
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
  (schema) => schema.shape.event_type.value,
);

const logger = createLogger("langwatch:track_event");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).end(); // Only accept POST requests
  }

  const authToken = normalizeHeaderValue(req.headers["x-auth-token"]);
  if (!authToken) {
    return res
      .status(401)
      .json({ message: "X-Auth-Token header is required." });
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
  });
  if (!project) {
    return res.status(401).json({ message: "Invalid auth token." });
  }

  let body: TrackEventRESTParamsValidator;
  try {
    body = trackEventRESTParamsValidatorSchema.parse(req.body);
  } catch (error) {
    logger.error(
      { error, body: req.body, projectId: project.id },
      "invalid event received",
    );
    captureException(error);
    const validationError = fromZodError(error as ZodError);
    return res.status(400).json({ error: validationError.message });
  }

  if (predefinedEventTypes.includes(req.body.event_type)) {
    try {
      predefinedEventsSchemas.parse(req.body);
    } catch (error) {
      logger.error(
        { error, body: req.body, projectId: project.id },
        "invalid event received",
      );
      captureException(error);
      const validationError = fromZodError(error as ZodError);
      return res.status(400).json({ error: validationError.message });
    }
  }

  const eventId =
    body.event_id ?? generate(KSUID_RESOURCES.TRACKED_EVENT).toString();

  if (project.featureEventSourcingTraceIngestion) {
    try {
      const timestampMs = body.timestamp ?? Date.now();
      const timestampNano = String(timestampMs * 1_000_000);
      const spanId = generateOtelSpanId();

      // Build attributes array for the span
      const attributes: {
        key: string;
        value: { stringValue?: string; doubleValue?: number };
      }[] = [
        { key: "event.type", value: { stringValue: body.event_type } },
        { key: "event.id", value: { stringValue: eventId } },
      ];

      // Add metrics as attributes
      for (const [key, value] of Object.entries(body.metrics)) {
        attributes.push({
          key: `event.metrics.${key}`,
          value: { doubleValue: value },
        });
      }

      // Add event_details as attributes
      if (body.event_details) {
        for (const [key, value] of Object.entries(body.event_details)) {
          if (typeof value === "string") {
            attributes.push({
              key: `event.details.${key}`,
              value: { stringValue: value },
            });
          } else if (typeof value === "number") {
            attributes.push({
              key: `event.details.${key}`,
              value: { doubleValue: value },
            });
          } else if (value != null) {
            attributes.push({
              key: `event.details.${key}`,
              value: { stringValue: String(value) },
            });
          }
        }
      }

      await getApp().traces.recordSpan({
        tenantId: project.id,
        span: {
          traceId: body.trace_id,
          spanId: spanId,
          traceState: null,
          parentSpanId: null,
          name: "langwatch.track_event",
          kind: ESpanKind.SPAN_KIND_INTERNAL,
          startTimeUnixNano: timestampNano,
          endTimeUnixNano: timestampNano,
          attributes: attributes,
          events: [
            {
              name: body.event_type,
              timeUnixNano: timestampNano,
              attributes: attributes,
            },
          ],
          links: [],
          status: {
            code: SpanStatusCode.OK as 1,
          },
          droppedAttributesCount: null,
          droppedEventsCount: null,
          droppedLinksCount: null,
        },
        resource: {
          attributes: [],
        },
        instrumentationScope: {
          name: "langwatch.track_event",
        },
        piiRedactionLevel: project.piiRedactionLevel,
        occurredAt: Date.now(),
      });
    } catch (error) {
      logger.error(
        {
          error,
        },
        "unable to dispatch tracked event span",
      );
    }
  }

  await trackEventsQueue.add(
    TRACK_EVENTS_QUEUE.JOB,
    {
      project_id: project.id,
      postpone_count: 0,
      event: {
        ...body,
        event_id: eventId,
        timestamp: body.timestamp ?? Date.now(),
      },
    },
    {
      jobId: `${project.id}_track_event_${eventId}`,
      // Add a delay to track events to possibly wait for trace data to be available for the grouping keys
      delay: process.env.VITEST_MODE ? 0 : 5000,
    },
  );

  return res.status(200).json({ message: "Event tracked" });
}
