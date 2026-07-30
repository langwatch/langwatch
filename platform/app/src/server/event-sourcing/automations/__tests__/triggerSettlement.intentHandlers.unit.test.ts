import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalDispatchError } from "../dispatchError";
import {
  createLogOverflowHandler,
  createNotifyDigestHandler,
  createPersistMatchHandler,
} from "../process-managers/triggerSettlement.intentHandlers";
import type { TriggerDispatchPorts } from "../process-managers/triggerSettlement.dispatchPorts";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function context(overrides: Partial<{ attempt: number; messageKey: string }> = {}) {
  return {
    processName: "triggerSettlement",
    tenantId: "project-1",
    processKey: "trigger-1",
    messageKey: overrides.messageKey ?? "digest:1000:batch",
    attempt: overrides.attempt ?? 1,
  };
}

function makePorts(overrides: Partial<TriggerDispatchPorts> = {}): {
  ports: TriggerDispatchPorts;
  claimed: Set<string>;
} {
  const claimed = new Set<string>();
  const ports: TriggerDispatchPorts = {
    triggerIsActive: vi.fn().mockResolvedValue(true),
    confirmSettledMatch: vi.fn().mockResolvedValue("confirmed"),
    isSendClaimed: vi.fn(async ({ traceId }) => claimed.has(traceId)),
    claimSend: vi.fn(async ({ traceId }) => {
      claimed.add(traceId);
    }),
    sendNotifyDigest: vi.fn().mockResolvedValue(undefined),
    runPersistAction: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { ports, claimed };
}

describe("trigger settlement intent handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createLogOverflowHandler", () => {
    it("logs the committed flush count", async () => {
      await expect(
        createLogOverflowHandler()(
          { triggerId: "trigger-1", flushed: 2, totalFlushed: 7 },
          context(),
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("notifyDigest handler", () => {
    describe("given the trigger was deleted or deactivated since the match", () => {
      it("drops without confirming or sending", async () => {
        const { ports } = makePorts({ triggerIsActive: vi.fn().mockResolvedValue(false) });

        await createNotifyDigestHandler(ports)(
          { triggerId: "trigger-1", traceIds: ["trace-1"], boundary: 1_000 },
          context(),
        );

        expect(ports.confirmSettledMatch).not.toHaveBeenCalled();
        expect(ports.sendNotifyDigest).not.toHaveBeenCalled();
      });
    });

    describe("given a digest batch with one confirmed trace and one whose filters no longer pass", () => {
      /** @scenario "An automation does not fire when its condition is unmet" */
      it("sends only the trace that still confirms, leaving the other unfired", async () => {
        const { ports } = makePorts({
          confirmSettledMatch: vi.fn(async ({ traceId }) =>
            traceId === "trace-filtered" ? "filters-failed" : "confirmed",
          ),
        });

        await createNotifyDigestHandler(ports)(
          { triggerId: "trigger-1", traceIds: ["trace-1", "trace-filtered"], boundary: 1_000 },
          context(),
        );

        expect(ports.sendNotifyDigest).toHaveBeenCalledTimes(1);
        expect(ports.sendNotifyDigest).toHaveBeenCalledWith(
          expect.objectContaining({ traceIds: ["trace-1"] }),
        );
        expect(ports.claimSend).toHaveBeenCalledTimes(1);
        expect(ports.claimSend).toHaveBeenCalledWith(
          expect.objectContaining({ traceId: "trace-1" }),
        );
      });
    });

    describe("given every candidate trace already carries a send claim", () => {
      it("sends nothing and never calls the dispatch port", async () => {
        const { ports } = makePorts({ isSendClaimed: vi.fn().mockResolvedValue(true) });

        await createNotifyDigestHandler(ports)(
          { triggerId: "trigger-1", traceIds: ["trace-1"], boundary: 1_000 },
          context(),
        );

        expect(ports.sendNotifyDigest).not.toHaveBeenCalled();
      });
    });

    describe("given a notify trace already claimed by an earlier settle round", () => {
      /** @scenario "An automation fires at most once per trace" */
      it("suppresses the duplicate send across settle windows", async () => {
        const { ports } = makePorts();

        await createNotifyDigestHandler(ports)(
          { triggerId: "trigger-1", traceIds: ["trace-1"], boundary: 31_000 },
          context({ messageKey: "digest:31000:first-window" }),
        );
        await createNotifyDigestHandler(ports)(
          { triggerId: "trigger-1", traceIds: ["trace-1"], boundary: 61_000 },
          context({ messageKey: "digest:61000:second-window" }),
        );

        expect(ports.sendNotifyDigest).toHaveBeenCalledTimes(1);
        expect(ports.claimSend).toHaveBeenCalledTimes(1);
      });
    });

    describe("given the trace's fold has not caught up yet", () => {
      it("throws so the outbox retries, instead of dropping the match", async () => {
        const { ports } = makePorts({
          confirmSettledMatch: vi.fn().mockResolvedValue("trace-not-settled"),
        });

        await expect(
          createNotifyDigestHandler(ports)(
            { triggerId: "trigger-1", traceIds: ["trace-1"], boundary: 1_000 },
            context(),
          ),
        ).rejects.toThrow(/not settled/);

        expect(ports.sendNotifyDigest).not.toHaveBeenCalled();
      });
    });

    describe("given the dispatch port fails with a terminal error", () => {
      it("drops as a logged completion, without retrying", async () => {
        const { ports } = makePorts({
          sendNotifyDigest: vi
            .fn()
            .mockRejectedValue(new TerminalDispatchError("all recipients suppressed")),
        });

        await expect(
          createNotifyDigestHandler(ports)(
            { triggerId: "trigger-1", traceIds: ["trace-1"], boundary: 1_000 },
            context(),
          ),
        ).resolves.toBeUndefined();

        expect(ports.claimSend).not.toHaveBeenCalled();
      });
    });

    describe("given the dispatch port fails with a plain, retryable error", () => {
      it("rethrows for the outbox to retry with backoff", async () => {
        const { ports } = makePorts({
          sendNotifyDigest: vi.fn().mockRejectedValue(new Error("provider timeout")),
        });

        await expect(
          createNotifyDigestHandler(ports)(
            { triggerId: "trigger-1", traceIds: ["trace-1"], boundary: 1_000 },
            context(),
          ),
        ).rejects.toThrow("provider timeout");
      });
    });

    describe("given claimSend fails after a successful send", () => {
      it("swallows the claim failure rather than retrying and double-sending", async () => {
        const { ports } = makePorts({
          claimSend: vi.fn().mockRejectedValue(new Error("claim store unavailable")),
        });

        await expect(
          createNotifyDigestHandler(ports)(
            { triggerId: "trigger-1", traceIds: ["trace-1"], boundary: 1_000 },
            context(),
          ),
        ).resolves.toBeUndefined();

        expect(ports.sendNotifyDigest).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("persistMatch handler", () => {
    describe("given the trace was already claimed", () => {
      it("skips without re-confirming or running the action", async () => {
        const { ports } = makePorts({ isSendClaimed: vi.fn().mockResolvedValue(true) });

        await createPersistMatchHandler(ports)(
          { triggerId: "trigger-1", traceId: "trace-1" },
          context(),
        );

        expect(ports.confirmSettledMatch).not.toHaveBeenCalled();
        expect(ports.runPersistAction).not.toHaveBeenCalled();
      });
    });

    describe("given a persist trace only passes filters in a later settle round", () => {
      it("runs the persist action once the later confirm succeeds", async () => {
        const { ports } = makePorts({
          confirmSettledMatch: vi
            .fn()
            .mockResolvedValueOnce("filters-failed")
            .mockResolvedValueOnce("confirmed"),
        });

        await createPersistMatchHandler(ports)(
          { triggerId: "trigger-1", traceId: "trace-1" },
          context({ messageKey: "persist:trace-1:30000-0" }),
        );
        await createPersistMatchHandler(ports)(
          { triggerId: "trigger-1", traceId: "trace-1" },
          context({ messageKey: "persist:trace-1:30000-1" }),
        );

        expect(ports.runPersistAction).toHaveBeenCalledTimes(1);
        expect(ports.claimSend).toHaveBeenCalledTimes(1);
      });
    });

    describe("given the persist action fails with a terminal error", () => {
      it("drops as a logged completion without claiming", async () => {
        const { ports } = makePorts({
          runPersistAction: vi
            .fn()
            .mockRejectedValue(new TerminalDispatchError("dataset deleted")),
        });

        await expect(
          createPersistMatchHandler(ports)(
            { triggerId: "trigger-1", traceId: "trace-1" },
            context(),
          ),
        ).resolves.toBeUndefined();
        expect(ports.claimSend).not.toHaveBeenCalled();
      });
    });
  });
});
