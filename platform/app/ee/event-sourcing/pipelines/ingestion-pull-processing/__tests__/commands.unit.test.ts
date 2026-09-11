import { describe, expect, it } from "vitest";
import type { Event } from "~/server/event-sourcing/domain/types";

import {
  ConfigureIngestionPullCommand,
  RecordIngestionPullAgentsListedCommand,
  RecordIngestionPullAgentsListingRefusedCommand,
  RecordIngestionPullPeopleListedCommand,
  RecordIngestionPullPeopleListingRefusedCommand,
  RecordIngestionPullRunCompletedCommand,
  RequestIngestionPullAgentsListingCommand,
  RequestIngestionPullPeopleListingCommand,
} from "../commands";

const baseData = {
  tenantId: "gov-project",
  occurredAt: Date.parse("2026-07-17T10:00:00Z"),
  sourceId: "source-1",
  configVersion: "v1",
  cursor: null,
};

describe("ConfigureIngestionPullCommand", () => {
  describe("when the pull schedule is not a five-field cron", () => {
    it("rejects the command before it can commit a poison event", () => {
      const result = ConfigureIngestionPullCommand.schema.validate({
        ...baseData,
        cron: "not a cron",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("when the pull schedule has five fields croner cannot evaluate", () => {
    it("rejects the command before it can commit a poison event", () => {
      const result = ConfigureIngestionPullCommand.schema.validate({
        ...baseData,
        cron: "99 99 99 99 99",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("when the pull schedule is a valid cron", () => {
    it("accepts the command", () => {
      const result = ConfigureIngestionPullCommand.schema.validate({
        ...baseData,
        cron: "*/15 * * * *",
      });
      expect(result.success).toBe(true);
    });
  });
});

describe("RecordIngestionPullRunCompletedCommand", () => {
  const completion = {
    tenantId: "gov-project",
    occurredAt: Date.parse("2026-08-31T10:00:00Z"),
    sourceId: "source-1",
    runId: "run-1",
    scheduledFor: Date.parse("2026-08-31T09:45:00Z"),
    nextCursor: "cursor-2",
    eventCount: 3,
  };

  describe("when the run reported errors alongside its progress", () => {
    it("carries the error count through to the event", () => {
      const result = RecordIngestionPullRunCompletedCommand.schema.validate({
        ...completion,
        errorCount: 2,
      });

      expect(result.success).toBe(true);
      // A stripped field would be indistinguishable from a clean run by the
      // time the fold reads it, which is exactly the laundering this closes.
      expect(result.data).toMatchObject({ errorCount: 2 });
    });
  });

  describe("when the run reported no error count at all", () => {
    it("still validates, because every completion already on the log omits it", () => {
      const result =
        RecordIngestionPullRunCompletedCommand.schema.validate(completion);

      expect(result.success).toBe(true);
      expect(result.data).not.toHaveProperty("errorCount");
    });
  });
});

describe("agent listing commands", () => {
  const envelope = {
    tenantId: "gov-project",
    occurredAt: Date.parse("2026-09-09T10:00:00Z"),
    sourceId: "source-1",
    requestId: "req-1",
    requestedAt: Date.parse("2026-09-09T09:59:00Z"),
  };

  /** Runs the command the way the runtime does, and returns its one event. */
  const emit = (command: unknown, data: Record<string, unknown>): Event => {
    // Each defined command is generic over its own data shape, and this
    // helper needs only the event they all return. One cast here beats
    // repeating the generic dance at every call.
    const Command = command as new () => {
      handle(c: { tenantId: string; data: Record<string, unknown> }): Event[];
    };
    return new Command().handle({ tenantId: "gov-project", data })[0] as Event;
  };

  describe("when a caller asks for a listing", () => {
    it("commits to the pull aggregate, so one source is one ordered stream", () => {
      const event = emit(RequestIngestionPullAgentsListingCommand, {
        ...envelope,
      });

      expect(event.aggregateType).toBe("ingestion_pull");
      expect(event.aggregateId).toBe("source-1");
    });

    it("settles a redelivery of one press onto the same event", () => {
      const key = (requestId: string) =>
        emit(RequestIngestionPullAgentsListingCommand, {
          ...envelope,
          requestId,
        }).idempotencyKey;

      // Two independent derivations from the same request id, named so the
      // assertion reads as "these agree" rather than as a value compared to
      // itself. The claim is that the key is a function of the request and of
      // nothing else — no clock, no counter, no randomness — which is what
      // makes a redelivery settle instead of running the listing twice.
      const firstDelivery = key("req-1");
      const redelivery = key("req-1");
      const differentPress = key("req-2");

      expect(redelivery).toBe(firstDelivery);
      expect(differentPress).not.toBe(firstDelivery);
    });
  });

  describe("when an outcome is recorded", () => {
    it("cannot collide with each other", () => {
      const listed = emit(RecordIngestionPullAgentsListedCommand, {
        ...envelope,
        agentCount: 0,
      }).idempotencyKey;
      const refused = emit(RecordIngestionPullAgentsListingRefusedCommand, {
        ...envelope,
        reason: "unauthorized",
        status: 403,
      }).idempotencyKey;

      expect(listed).not.toBe(refused);
      expect(listed).toContain("req-1");
      expect(refused).toContain("req-1");
    });

    it("accepts a zero count, because an empty answer is still an answer", () => {
      const result = RecordIngestionPullAgentsListedCommand.schema.validate({
        ...envelope,
        agentCount: 0,
      });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ agentCount: 0 });
    });

    it("refuses a listing with no reason at all", () => {
      const result =
        RecordIngestionPullAgentsListingRefusedCommand.schema.validate({
          ...envelope,
          reason: "",
          status: null,
        });

      expect(result.success).toBe(false);
    });

    it("accepts a refusal that came without an HTTP status", () => {
      const result =
        RecordIngestionPullAgentsListingRefusedCommand.schema.validate({
          ...envelope,
          reason: "unreachable",
          status: null,
        });

      expect(result.success).toBe(true);
    });
  });
});

describe("the people listing commands", () => {
  const envelope = {
    tenantId: "gov-project",
    occurredAt: Date.parse("2026-09-09T10:00:00Z"),
    sourceId: "source-1",
    requestId: "req-1",
    requestedAt: Date.parse("2026-09-09T09:59:00Z"),
  };

  /** Runs the command the way the runtime does, and returns its one event. */
  const emit = (command: unknown, data: Record<string, unknown>): Event => {
    const Command = command as new () => {
      handle(c: { tenantId: string; data: Record<string, unknown> }): Event[];
    };
    return new Command().handle({ tenantId: "gov-project", data })[0] as Event;
  };

  describe("when a caller asks for a listing", () => {
    it("commits to the pull aggregate, so one source is one ordered stream", () => {
      const event = emit(RequestIngestionPullPeopleListingCommand, {
        ...envelope,
      });

      expect(event.aggregateType).toBe("ingestion_pull");
      expect(event.aggregateId).toBe("source-1");
    });

    it("settles a redelivery of one press onto the same event", () => {
      const key = (requestId: string) =>
        emit(RequestIngestionPullPeopleListingCommand, {
          ...envelope,
          requestId,
        }).idempotencyKey;

      // Two independent derivations from the same request id, named so the
      // assertion reads as "these agree" rather than as a value compared to
      // itself. The claim is that the key is a function of the request and of
      // nothing else — no clock, no counter, no randomness — which is what
      // makes a redelivery settle instead of running the listing twice.
      const firstDelivery = key("req-1");
      const redelivery = key("req-1");
      const differentPress = key("req-2");

      expect(redelivery).toBe(firstDelivery);
      expect(differentPress).not.toBe(firstDelivery);
    });

    /**
     * The two listings share an aggregate and can share a request id. If they
     * also shared an idempotency key, asking for people right after asking for
     * agents would silently settle onto the agent request and never run.
     */
    it("cannot collide with an agent request carrying the same id", () => {
      const people = emit(RequestIngestionPullPeopleListingCommand, {
        ...envelope,
      }).idempotencyKey;
      const agents = emit(RequestIngestionPullAgentsListingCommand, {
        ...envelope,
      }).idempotencyKey;

      expect(people).not.toBe(agents);
    });
  });

  describe("when an outcome is recorded", () => {
    it("cannot collide with each other", () => {
      const listed = emit(RecordIngestionPullPeopleListedCommand, {
        ...envelope,
        directoryPersonCount: 0,
        withheldPersonCount: 0,
      }).idempotencyKey;
      const refused = emit(RecordIngestionPullPeopleListingRefusedCommand, {
        ...envelope,
        reason: "unauthorized",
        status: 403,
      }).idempotencyKey;

      expect(listed).not.toBe(refused);
      expect(listed).toContain("req-1");
      expect(refused).toContain("req-1");
    });

    it("cannot collide with the agent outcomes on the same request", () => {
      const people = emit(RecordIngestionPullPeopleListedCommand, {
        ...envelope,
        directoryPersonCount: 1,
        withheldPersonCount: 0,
      }).idempotencyKey;
      const agents = emit(RecordIngestionPullAgentsListedCommand, {
        ...envelope,
        agentCount: 1,
      }).idempotencyKey;

      expect(people).not.toBe(agents);
    });

    it("accepts a zero count, because an empty answer is still an answer", () => {
      const result = RecordIngestionPullPeopleListedCommand.schema.validate({
        ...envelope,
        directoryPersonCount: 0,
        withheldPersonCount: 0,
      });

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({
        directoryPersonCount: 0,
        withheldPersonCount: 0,
      });
    });

    /**
     * Both counts are required rather than defaulted. A writer that knows only
     * the surviving total has lost the provider's number already, and letting
     * it omit the field would store that loss as a zero indistinguishable from
     * a provider that withheld nobody.
     */
    it("refuses a listing that names only one of the two counts", () => {
      const result = RecordIngestionPullPeopleListedCommand.schema.validate({
        ...envelope,
        directoryPersonCount: 5,
      });

      expect(result.success).toBe(false);
    });

    it("refuses a withheld count the provider's number cannot cover", () => {
      const result = RecordIngestionPullPeopleListedCommand.schema.validate({
        ...envelope,
        directoryPersonCount: 2,
        withheldPersonCount: -1,
      });

      expect(result.success).toBe(false);
    });

    it("refuses a listing with no reason at all", () => {
      const result =
        RecordIngestionPullPeopleListingRefusedCommand.schema.validate({
          ...envelope,
          reason: "",
          status: null,
        });

      expect(result.success).toBe(false);
    });

    it("accepts a refusal that came without an HTTP status", () => {
      const result =
        RecordIngestionPullPeopleListingRefusedCommand.schema.validate({
          ...envelope,
          reason: "unreachable",
          status: null,
        });

      expect(result.success).toBe(true);
    });
  });
});
