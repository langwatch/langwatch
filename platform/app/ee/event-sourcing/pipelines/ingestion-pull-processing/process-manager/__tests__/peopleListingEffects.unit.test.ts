import { describe, expect, it, vi } from "vitest";

import type { IntentContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";

import { LISTING_FAILED_REASON } from "../../schemas/constants";
import {
  createPeopleListingHandler,
  type IngestionPullOutcomeCommands,
  type PeopleListingPort,
} from "../ingestionPullEffects";
import { INGESTION_PULL_PROCESS_NAME } from "../ingestionPullProcess.types";

const intent = {
  sourceId: "source-1",
  requestId: "req-1",
  requestedAt: 100,
};

const context = (attempt: number): IntentContext => ({
  processName: INGESTION_PULL_PROCESS_NAME,
  projectId: "gov-project",
  processKey: "source-1",
  tenantId: "gov-project",
  messageKey: "process:source-1:people:req-1",
  attempt,
});

function commandsStub(
  overrides: Partial<IngestionPullOutcomeCommands> = {},
): IngestionPullOutcomeCommands {
  return {
    recordRunCompleted: vi.fn(),
    recordRunFailed: vi.fn(),
    recordAgentsListed: vi.fn(),
    recordAgentsListingRefused: vi.fn(),
    recordPeopleListed: vi.fn(),
    recordPeopleListingRefused: vi.fn(),
    ...overrides,
  };
}

function handlerFor({
  port,
  commands,
}: {
  port: PeopleListingPort;
  commands: IngestionPullOutcomeCommands;
}) {
  return createPeopleListingHandler({
    runPort: { run: () => Promise.reject(new Error("unused")) },
    agentListingPort: { list: () => Promise.reject(new Error("unused")) },
    peopleListingPort: port,
    commands: () => commands,
    clock: () => 200,
  });
}

describe("people listing outbox effect", () => {
  describe("when the provider names people", () => {
    it("records the count against the request that asked", async () => {
      const recordPeopleListed = vi.fn();
      const handler = handlerFor({
        port: {
          list: vi
            .fn()
            .mockResolvedValue({ outcome: "listed", personCount: 42 }),
        },
        commands: commandsStub({ recordPeopleListed }),
      });

      await handler(intent, context(1));

      expect(recordPeopleListed).toHaveBeenCalledWith({
        tenantId: "gov-project",
        occurredAt: 200,
        sourceId: "source-1",
        requestId: "req-1",
        requestedAt: 100,
        personCount: 42,
      });
    });

    it("does not touch the agent listing commands", async () => {
      const recordAgentsListed = vi.fn();
      const recordAgentsListingRefused = vi.fn();
      const handler = handlerFor({
        port: {
          list: vi
            .fn()
            .mockResolvedValue({ outcome: "listed", personCount: 3 }),
        },
        commands: commandsStub({
          recordAgentsListed,
          recordAgentsListingRefused,
        }),
      });

      await handler(intent, context(1));

      expect(recordAgentsListed).not.toHaveBeenCalled();
      expect(recordAgentsListingRefused).not.toHaveBeenCalled();
    });
  });

  describe("when the provider names nobody", () => {
    /**
     * The distinction the whole feature turns on. A tenant with no staff to
     * report is a LISTING of zero, and it must not reach the log as a refusal
     * — a reader would otherwise be told to go fix a credential that worked.
     */
    it("records a listing of zero rather than a refusal", async () => {
      const recordPeopleListed = vi.fn();
      const recordPeopleListingRefused = vi.fn();
      const handler = handlerFor({
        port: {
          list: vi
            .fn()
            .mockResolvedValue({ outcome: "listed", personCount: 0 }),
        },
        commands: commandsStub({
          recordPeopleListed,
          recordPeopleListingRefused,
        }),
      });

      await handler(intent, context(1));

      expect(recordPeopleListed).toHaveBeenCalledWith(
        expect.objectContaining({ personCount: 0 }),
      );
      expect(recordPeopleListingRefused).not.toHaveBeenCalled();
    });
  });

  describe("when the provider refuses", () => {
    it("records the reason and the status, and never a listing", async () => {
      const recordPeopleListed = vi.fn();
      const recordPeopleListingRefused = vi.fn();
      const handler = handlerFor({
        port: {
          list: vi.fn().mockResolvedValue({
            outcome: "refused",
            reason: "unauthorized",
            status: 403,
          }),
        },
        commands: commandsStub({
          recordPeopleListed,
          recordPeopleListingRefused,
        }),
      });

      await handler(intent, context(1));

      expect(recordPeopleListingRefused).toHaveBeenCalledWith({
        tenantId: "gov-project",
        occurredAt: 200,
        sourceId: "source-1",
        requestId: "req-1",
        requestedAt: 100,
        reason: "unauthorized",
        status: 403,
      });
      expect(recordPeopleListed).not.toHaveBeenCalled();
    });

    /**
     * A refusal is an ANSWER, not a failed effect. Resolving rather than
     * throwing is what stops the outbox spending three attempts on a provider
     * that already said no.
     */
    it("resolves rather than throwing, and asks exactly once", async () => {
      const list = vi.fn().mockResolvedValue({
        outcome: "refused",
        reason: "rate_limited",
        status: 429,
      });
      const handler = handlerFor({ port: { list }, commands: commandsStub() });

      await expect(handler(intent, context(1))).resolves.toBeUndefined();
      expect(list).toHaveBeenCalledTimes(1);
    });
  });

  describe("when our own side fails", () => {
    it("rethrows below the attempt cap so the outbox retries", async () => {
      const recordPeopleListingRefused = vi.fn();
      const handler = createPeopleListingHandler({
        runPort: { run: () => Promise.reject(new Error("unused")) },
        agentListingPort: { list: () => Promise.reject(new Error("unused")) },
        peopleListingPort: {
          list: vi.fn().mockRejectedValue(new Error("postgres is down")),
        },
        commands: () => commandsStub({ recordPeopleListingRefused }),
        clock: () => 200,
        maxAttempts: 3,
      });

      await expect(handler(intent, context(1))).rejects.toThrow(
        "postgres is down",
      );
      expect(recordPeopleListingRefused).not.toHaveBeenCalled();
    });

    it("records listing_failed once the attempts are spent", async () => {
      const recordPeopleListingRefused = vi.fn();
      const handler = createPeopleListingHandler({
        runPort: { run: () => Promise.reject(new Error("unused")) },
        agentListingPort: { list: () => Promise.reject(new Error("unused")) },
        peopleListingPort: {
          list: vi.fn().mockRejectedValue(new Error("postgres is down")),
        },
        commands: () => commandsStub({ recordPeopleListingRefused }),
        clock: () => 200,
        maxAttempts: 3,
      });

      await handler(intent, context(3));

      expect(recordPeopleListingRefused).toHaveBeenCalledWith({
        tenantId: "gov-project",
        occurredAt: 200,
        sourceId: "source-1",
        requestId: "req-1",
        requestedAt: 100,
        reason: LISTING_FAILED_REASON,
        status: null,
      });
    });

    /**
     * `listing_failed` is deliberately not one of the provider's own reasons:
     * "we could not ask" and "your credential was rejected" call for different
     * actions, and only one of them is the customer's to take.
     */
    it("distinguishes our failure from the provider's refusal", async () => {
      const ours = vi.fn();
      const theirs = vi.fn();
      const failing = createPeopleListingHandler({
        runPort: { run: () => Promise.reject(new Error("unused")) },
        agentListingPort: { list: () => Promise.reject(new Error("unused")) },
        peopleListingPort: {
          list: vi.fn().mockRejectedValue(new Error("postgres is down")),
        },
        commands: () => commandsStub({ recordPeopleListingRefused: ours }),
        clock: () => 200,
        maxAttempts: 1,
      });
      const refusing = handlerFor({
        port: {
          list: vi.fn().mockResolvedValue({
            outcome: "refused",
            reason: "unauthorized",
            status: 401,
          }),
        },
        commands: commandsStub({ recordPeopleListingRefused: theirs }),
      });

      await failing(intent, context(1));
      await refusing(intent, context(1));

      expect(ours.mock.calls[0]?.[0].reason).toBe(LISTING_FAILED_REASON);
      expect(theirs.mock.calls[0]?.[0].reason).toBe("unauthorized");
    });

    /**
     * A thrown provider error can carry a response body, and this event is
     * read by an admin. The message stays in the log line and out of the
     * event.
     */
    it("keeps the thrown message out of what gets recorded", async () => {
      const recordPeopleListingRefused = vi.fn();
      const handler = createPeopleListingHandler({
        runPort: { run: () => Promise.reject(new Error("unused")) },
        agentListingPort: { list: () => Promise.reject(new Error("unused")) },
        peopleListingPort: {
          list: vi
            .fn()
            .mockRejectedValue(
              new Error("401 from https://api.example.com?key=sk-live-secret"),
            ),
        },
        commands: () => commandsStub({ recordPeopleListingRefused }),
        clock: () => 200,
        maxAttempts: 1,
      });

      await handler(intent, context(1));

      const recorded = JSON.stringify(
        recordPeopleListingRefused.mock.calls[0]?.[0],
      );
      expect(recorded).not.toContain("sk-live-secret");
      expect(recorded).not.toContain("api.example.com");
    });
  });

  describe("when recording the outcome fails", () => {
    it("rethrows so the outbox redelivers rather than losing the outcome", async () => {
      const handler = handlerFor({
        port: {
          list: vi
            .fn()
            .mockResolvedValue({ outcome: "listed", personCount: 2 }),
        },
        commands: commandsStub({
          recordPeopleListed: vi
            .fn()
            .mockRejectedValue(new Error("event store unavailable")),
        }),
      });

      await expect(handler(intent, context(1))).rejects.toThrow(
        "event store unavailable",
      );
    });
  });
});
