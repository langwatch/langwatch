import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerService } from "~/server/app-layer/automations/trigger.service";
import type { Event } from "~/server/event-sourcing/domain/types";
import { DispatchError } from "~/server/event-sourcing/queues/dispatchError";
import { createGraphTriggerActivityHandler } from "../graphTriggerActivity.subscriber";

// vi.mock is hoisted above module-level consts, so the shared spy has to be
// created inside vi.hoisted to exist by the time the factory runs.
const log = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => log,
}));

function event(): Event {
  return { occurredAt: Date.now() } as Event;
}

function handlerFor(evaluateGraphTrigger: (params: {
  triggerId: string;
  projectId: string;
}) => Promise<void>) {
  return createGraphTriggerActivityHandler({
    triggers: {
      getActiveGraphTriggersForProject: vi
        .fn()
        .mockResolvedValue([{ id: "trigger-1", name: "Alert" }]),
    } as unknown as TriggerService,
    evaluateGraphTrigger: evaluateGraphTrigger as never,
  });
}

describe("createGraphTriggerActivityHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when a trigger is rejected as terminal", () => {
    const terminal = () =>
      Promise.reject(
        new DispatchError({
          message: 'Slack bot connection for alert "Alert" is missing its token',
          retryable: false,
          customerMessage: "Reconnect the Slack app.",
        }),
      );

    it("does not throw, so the queue stops redelivering a trigger that cannot succeed", async () => {
      await expect(
        handlerFor(terminal)(event(), { tenantId: "project-1" }),
      ).resolves.toBeUndefined();
    });

    it("logs at info rather than error", async () => {
      await handlerFor(terminal)(event(), { tenantId: "project-1" });

      expect(log.error).not.toHaveBeenCalled();
      expect(log.info).toHaveBeenCalled();
    });

    it("keeps the customer-facing remediation on the record", async () => {
      await handlerFor(terminal)(event(), { tenantId: "project-1" });

      expect(log.info).toHaveBeenCalledWith(
        expect.objectContaining({
          customerMessage: "Reconnect the Slack app.",
          triggerId: "trigger-1",
        }),
        expect.any(String),
      );
    });
  });

  describe("when a trigger fails in a way the thrower marked retryable", () => {
    const retryable = () =>
      Promise.reject(
        new DispatchError({ message: "Slack 503", retryable: true }),
      );

    it("throws so the queue redelivers", async () => {
      await expect(
        handlerFor(retryable)(event(), { tenantId: "project-1" }),
      ).rejects.toThrow(/evaluations failed/);
    });

    it("logs at error", async () => {
      await handlerFor(retryable)(event(), { tenantId: "project-1" }).catch(
        () => undefined,
      );

      expect(log.error).toHaveBeenCalled();
    });
  });

  describe("when a trigger fails with an unclassified error", () => {
    // ADR-027 makes the unknown case retryable on purpose. This is the
    // guard against a future classifier that defaults the other way and
    // silently demotes our own outages to info.
    const unexpected = () => Promise.reject(new Error("connection reset"));

    it("throws rather than treating the unknown case as terminal", async () => {
      await expect(
        handlerFor(unexpected)(event(), { tenantId: "project-1" }),
      ).rejects.toThrow(/evaluations failed/);
    });

    it("logs at error", async () => {
      await handlerFor(unexpected)(event(), { tenantId: "project-1" }).catch(
        () => undefined,
      );

      expect(log.error).toHaveBeenCalled();
      expect(log.info).not.toHaveBeenCalled();
    });
  });
});
