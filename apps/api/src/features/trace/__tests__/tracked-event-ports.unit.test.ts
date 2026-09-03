/**
 * The five ports `POST /api/events/track` and `POST /api/track_event` are
 * built from, over a real span collection whose command sender records.
 *
 * Nothing about the span builder is stubbed: the collection is the package's
 * own `TraceSpanCollectionService` with the two ports underneath it replaced,
 * so what is asserted below is the command a customer's feedback event
 * actually produces — its span name, its deterministic id and the attributes
 * the fold reads back.
 *
 * Spec: specs/api-reference/tracked-event-validation.feature
 */
import type { RecordSpanCommandData } from "@langwatch/trace-contract";
import {
  TraceIngressCommandPort,
  TraceSpanCollectionService,
  TraceSpanDedupPort,
  TrackedEventSpanService,
} from "@langwatch/trace-server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createApiTrackedEventPorts } from "../tracked-event-ports.adapter";

const TRACE_ID = "trace_0123456789abcdef";

describe("given the tracked-event ports over this process's span collection", () => {
  describe("when a predefined event type carries a payload its schema rejects", () => {
    /** @scenario A rejected predefined event names the offending field */
    it("refuses it as a handled validation failure that names the field", () => {
      const { ports } = build();

      let thrown: unknown;
      try {
        ports.assertPredefinedEventPayload({
          trace_id: TRACE_ID,
          event_type: "thumbs_up_down",
          metrics: { vote: 2 },
        });
      } catch (error) {
        thrown = error;
      }

      expect((thrown as { code?: string }).code).toBe("validation_error");
      expect(ports.describeValidationError(thrown)).toContain("metrics.vote");
    });
  });

  describe("when a predefined event type carries the payload its schema requires", () => {
    it("passes it through, because the second pass only ever narrows", () => {
      const { ports } = build();

      expect(() =>
        ports.assertPredefinedEventPayload({
          trace_id: TRACE_ID,
          event_type: "thumbs_up_down",
          metrics: { vote: 1 },
        }),
      ).not.toThrow();
    });
  });

  describe("when the event type is the customer's own rather than a predefined one", () => {
    it("leaves it alone: there is no schema for it beyond the base one", () => {
      const { ports } = build();

      expect(() =>
        ports.assertPredefinedEventPayload({
          trace_id: TRACE_ID,
          event_type: "checkout_completed",
          metrics: { basket_size: 4 },
        }),
      ).not.toThrow();
    });
  });

  describe("when a caller sends no event id", () => {
    it("mints one in the shape every stored tracked-event id already has", () => {
      const { ports } = build();

      const first = ports.generateEventId();
      const second = ports.generateEventId();

      expect(first).toMatch(/^trackedevent_/);
      expect(second).not.toBe(first);
    });
  });

  describe("when an event is recorded", () => {
    it("reaches the span collection as one recordSpan command carrying the event", async () => {
      const { ports, commands } = build();

      await ports.recordTrackedEvent({
        project: { id: "project-1" },
        body: {
          trace_id: TRACE_ID,
          event_type: "thumbs_up_down",
          metrics: { vote: 1 },
          event_details: { feedback: "helpful" },
          timestamp: 1_767_225_600_000,
        },
        eventId: "trackedevent_abc",
      });

      expect(commands).toHaveLength(1);
      const [command] = commands;
      expect(command?.tenantId).toBe("project-1");
      expect(command?.span.name).toBe("langwatch.track_event");
      expect(command?.span.traceId).toBe(TRACE_ID);
      // The id both paths must agree on: a digest of trace and event, so a
      // retried REST call and a redelivered SDK event are one span.
      expect(command?.span.spanId).toBe(
        TrackedEventSpanService.spanIdFor({ traceId: TRACE_ID, eventId: "trackedevent_abc" }),
      );
      expect(command?.span.attributes).toEqual(
        expect.arrayContaining([
          { key: "event.type", value: { stringValue: "thumbs_up_down" } },
          { key: "event.id", value: { stringValue: "trackedevent_abc" } },
          { key: "event.metrics.vote", value: { doubleValue: 1 } },
          { key: "event.details.feedback", value: { stringValue: "helpful" } },
        ]),
      );
    });
  });

  describe("when the base schema is the thing that rejected the payload", () => {
    /** @scenario A base-schema rejection keeps the wording it already had */
    it("renders the ZodError the route hands over, naming the missing field", () => {
      const { ports } = build();
      const error = zodErrorFrom(() => z.object({ trace_id: z.string() }).parse({}));

      expect(ports.describeValidationError(error)).toContain("trace_id");
    });
  });

  describe("when the failure handed to the renderer is neither of those", () => {
    /** @scenario A non-validation error is still formatted as a message */
    it("answers one customer-safe sentence rather than the internal message", () => {
      const { ports } = build();

      const message = ports.describeValidationError(
        new Error("connect ECONNREFUSED redis://10.0.0.4:6379"),
      );

      expect(message).not.toContain("ECONNREFUSED");
      expect(message).toBe("The tracked event payload could not be validated.");
    });
  });

  describe("when a rejected payload is reported", () => {
    it("reaches the process's error sink rather than being swallowed", () => {
      const error = vi.fn();
      const { ports } = build({ error });

      ports.reportError(new Error("rejected"));

      expect(error).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------

/**
 * The ports over a real collection whose dedup always grants the claim and
 * whose command sender records instead of enqueueing.
 */
function build(logger: { error: (...args: never[]) => void } = { error: () => {} }) {
  const commands: RecordSpanCommandData[] = [];
  const collection = TraceSpanCollectionService.create({
    dedup: new GrantingDedup(),
    commands: new RecordingCommands(commands),
  });

  return {
    commands,
    ports: createApiTrackedEventPorts({
      spans: TrackedEventSpanService.create({ collection }),
      logger: logger as never,
    }),
  };
}

class GrantingDedup extends TraceSpanDedupPort {
  async tryAcquireProcessingLock(): Promise<boolean> {
    return true;
  }

  async confirmProcessed(): Promise<void> {}

  async releaseOnFailure(): Promise<void> {}
}

class RecordingCommands extends TraceIngressCommandPort {
  constructor(private readonly sent: RecordSpanCommandData[]) {
    super();
  }

  async recordSpan(data: RecordSpanCommandData): Promise<void> {
    this.sent.push(data);
  }
}

function zodErrorFrom(parse: () => unknown): unknown {
  try {
    parse();
  } catch (error) {
    return error;
  }
  throw new Error("expected the schema to reject the payload");
}
