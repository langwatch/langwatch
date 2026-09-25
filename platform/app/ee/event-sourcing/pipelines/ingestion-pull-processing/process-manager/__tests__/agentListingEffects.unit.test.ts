import { describe, expect, it, vi } from "vitest";

import type { IntentContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";

import { LISTING_FAILED_REASON } from "../../schemas/constants";
import {
  type AgentListingPort,
  createAgentListingHandler,
  type IngestionPullOutcomeCommands,
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
  messageKey: "process:source-1:agents:req-1",
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
  port: AgentListingPort;
  commands: IngestionPullOutcomeCommands;
}) {
  return createAgentListingHandler({
    runPort: { run: () => Promise.reject(new Error("unused")) },
    agentListingPort: port,
    peopleListingPort: { list: () => Promise.reject(new Error("unused")) },
    commands: () => commands,
    clock: () => 200,
  });
}

describe("agent listing outbox effect", () => {
  describe("when the provider names agents", () => {
    it("records the count against the request that asked", async () => {
      const recordAgentsListed = vi.fn();
      const handler = handlerFor({
        port: {
          list: vi.fn().mockResolvedValue({ outcome: "listed", agentCount: 4 }),
        },
        commands: commandsStub({ recordAgentsListed }),
      });

      await handler(intent, context(1));

      expect(recordAgentsListed).toHaveBeenCalledWith({
        tenantId: "gov-project",
        occurredAt: 200,
        sourceId: "source-1",
        requestId: "req-1",
        requestedAt: 100,
        agentCount: 4,
      });
    });
  });

  describe("when the provider answers with an empty list", () => {
    it("records a listing of zero, not a refusal", async () => {
      const recordAgentsListed = vi.fn();
      const recordAgentsListingRefused = vi.fn();
      const handler = handlerFor({
        port: {
          list: vi.fn().mockResolvedValue({ outcome: "listed", agentCount: 0 }),
        },
        commands: commandsStub({
          recordAgentsListed,
          recordAgentsListingRefused,
        }),
      });

      await handler(intent, context(1));

      // The whole point: an empty answer and a refusal are different events,
      // so a reader can tell "you have no agents" from "we could not find out".
      expect(recordAgentsListed).toHaveBeenCalledWith(
        expect.objectContaining({ agentCount: 0 }),
      );
      expect(recordAgentsListingRefused).not.toHaveBeenCalled();
    });
  });

  describe("when the provider refuses", () => {
    it("records the refusal with its reason and status", async () => {
      const recordAgentsListingRefused = vi.fn();
      const recordAgentsListed = vi.fn();
      const handler = handlerFor({
        port: {
          list: vi.fn().mockResolvedValue({
            outcome: "refused",
            reason: "unauthorized",
            status: 403,
          }),
        },
        commands: commandsStub({
          recordAgentsListingRefused,
          recordAgentsListed,
        }),
      });

      await handler(intent, context(1));

      expect(recordAgentsListingRefused).toHaveBeenCalledWith({
        tenantId: "gov-project",
        occurredAt: 200,
        sourceId: "source-1",
        requestId: "req-1",
        requestedAt: 100,
        reason: "unauthorized",
        status: 403,
      });
      expect(recordAgentsListed).not.toHaveBeenCalled();
    });

    it("does not retry: the listing worked and the answer was no", async () => {
      const list = vi.fn().mockResolvedValue({
        outcome: "refused",
        reason: "unauthorized",
        status: 403,
      });
      const handler = handlerFor({
        port: { list },
        commands: commandsStub(),
      });

      // Resolving rather than throwing is what stops the outbox retrying.
      await expect(handler(intent, context(1))).resolves.toBeUndefined();
      expect(list).toHaveBeenCalledTimes(1);
    });
  });

  describe("when our own side gives out", () => {
    it("rethrows before the final attempt so the outbox retries", async () => {
      const recordAgentsListingRefused = vi.fn();
      const handler = handlerFor({
        port: { list: vi.fn().mockRejectedValue(new Error("database down")) },
        commands: commandsStub({ recordAgentsListingRefused }),
      });

      await expect(handler(intent, context(1))).rejects.toThrow(
        "database down",
      );
      expect(recordAgentsListingRefused).not.toHaveBeenCalled();
    });

    it("records a listing_failed refusal once retries run out", async () => {
      const recordAgentsListingRefused = vi.fn();
      const handler = handlerFor({
        port: { list: vi.fn().mockRejectedValue(new Error("database down")) },
        commands: commandsStub({ recordAgentsListingRefused }),
      });

      await handler(intent, context(3));

      expect(recordAgentsListingRefused).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: LISTING_FAILED_REASON,
          status: null,
        }),
      );
    });

    it("keeps the thrown message out of the durable event", async () => {
      const recordAgentsListingRefused = vi.fn();
      const handler = handlerFor({
        port: {
          list: vi
            .fn()
            .mockRejectedValue(new Error("401 body: token sk-live-secret")),
        },
        commands: commandsStub({ recordAgentsListingRefused }),
      });

      await handler(intent, context(3));

      const recorded = JSON.stringify(
        recordAgentsListingRefused.mock.calls[0]?.[0],
      );
      expect(recorded).not.toContain("sk-live-secret");
    });

    it("tells our own failure apart from the provider's own refusal", async () => {
      const ours = vi.fn();
      const theirs = vi.fn();
      await handlerFor({
        port: { list: vi.fn().mockRejectedValue(new Error("database down")) },
        commands: commandsStub({ recordAgentsListingRefused: ours }),
      })(intent, context(3));
      await handlerFor({
        port: {
          list: vi.fn().mockResolvedValue({
            outcome: "refused",
            reason: "unauthorized",
            status: 401,
          }),
        },
        commands: commandsStub({ recordAgentsListingRefused: theirs }),
      })(intent, context(1));

      // An admin told "listing_failed" must not go hunting for a credential
      // problem they do not have.
      expect(ours.mock.calls[0]?.[0].reason).toBe(LISTING_FAILED_REASON);
      expect(theirs.mock.calls[0]?.[0].reason).toBe("unauthorized");
    });
  });

  describe("when the outcome command itself fails", () => {
    it("rethrows so the outbox redelivers rather than losing the outcome", async () => {
      const handler = handlerFor({
        port: {
          list: vi.fn().mockResolvedValue({ outcome: "listed", agentCount: 2 }),
        },
        commands: commandsStub({
          recordAgentsListed: vi
            .fn()
            .mockRejectedValue(new Error("event log unavailable")),
        }),
      });

      await expect(handler(intent, context(3))).rejects.toThrow(
        "event log unavailable",
      );
    });
  });
});
