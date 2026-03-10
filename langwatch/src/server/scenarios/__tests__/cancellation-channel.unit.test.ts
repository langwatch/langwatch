/**
 * Unit tests for the scenario cancellation pub/sub channel.
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 * (Distributed cancellation scenarios)
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  CANCELLATION_CHANNEL,
  publishCancellation,
  subscribeToCancellations,
  type CancellationMessage,
} from "../cancellation-channel";

function createMockPublisher() {
  return { publish: vi.fn().mockResolvedValue(1) };
}

function createMockSubscriber() {
  return {
    subscribe: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockWorker() {
  return { cancelJob: vi.fn().mockReturnValue(false) };
}

describe("CANCELLATION_CHANNEL", () => {
  it("is a non-empty string", () => {
    expect(typeof CANCELLATION_CHANNEL).toBe("string");
    expect(CANCELLATION_CHANNEL.length).toBeGreaterThan(0);
  });
});

describe("publishCancellation()", () => {
  describe("when publishing a cancellation message", () => {
    let publisher: ReturnType<typeof createMockPublisher>;
    const message: CancellationMessage = {
      jobId: "job-1",
      projectId: "proj-1",
      scenarioRunId: "run-1",
      batchRunId: "batch-1",
    };

    beforeEach(async () => {
      publisher = createMockPublisher();
      await publishCancellation({ publisher, message });
    });

    it("publishes to the cancellation channel", () => {
      expect(publisher.publish).toHaveBeenCalledWith(
        CANCELLATION_CHANNEL,
        expect.any(String),
      );
    });

    it("serializes the message as JSON", () => {
      const [, payload] = publisher.publish.mock.calls[0] as [string, string];
      expect(JSON.parse(payload)).toEqual(message);
    });
  });
});

describe("subscribeToCancellations()", () => {
  describe("when setting up a subscription", () => {
    let subscriber: ReturnType<typeof createMockSubscriber>;
    let worker: ReturnType<typeof createMockWorker>;

    beforeEach(async () => {
      subscriber = createMockSubscriber();
      worker = createMockWorker();
      await subscribeToCancellations({ worker, subscriber });
    });

    it("subscribes to the cancellation channel", () => {
      expect(subscriber.subscribe).toHaveBeenCalledWith(CANCELLATION_CHANNEL);
    });

    it("registers a message handler", () => {
      expect(subscriber.on).toHaveBeenCalledWith("message", expect.any(Function));
    });
  });

  describe("when the cleanup function is called", () => {
    it("calls subscriber.quit()", async () => {
      const subscriber = createMockSubscriber();
      const worker = createMockWorker();

      const cleanup = await subscribeToCancellations({ worker, subscriber });
      await cleanup();

      expect(subscriber.quit).toHaveBeenCalled();
    });
  });

  describe("when a cancellation message arrives", () => {
    let worker: ReturnType<typeof createMockWorker>;
    let capturedHandler: (channel: string, raw: string) => void;

    beforeEach(async () => {
      const subscriber = createMockSubscriber();
      worker = createMockWorker();

      subscriber.on.mockImplementation((event: string, handler: (channel: string, raw: string) => void) => {
        if (event === "message") capturedHandler = handler;
      });

      await subscribeToCancellations({ worker, subscriber });
    });

    describe("when the worker owns the job", () => {
      beforeEach(() => {
        worker.cancelJob.mockReturnValue(true);
        capturedHandler(CANCELLATION_CHANNEL, JSON.stringify({ jobId: "job-1", projectId: "p1", scenarioRunId: "r1", batchRunId: "b1" }));
      });

      it("calls cancelJob with the job id", () => {
        expect(worker.cancelJob).toHaveBeenCalledWith("job-1");
      });
    });

    describe("when the worker does not own the job", () => {
      beforeEach(() => {
        worker.cancelJob.mockReturnValue(false);
        capturedHandler(CANCELLATION_CHANNEL, JSON.stringify({ jobId: "job-2", projectId: "p1", scenarioRunId: "r1", batchRunId: "b1" }));
      });

      it("calls cancelJob (which is a no-op on non-owning workers)", () => {
        expect(worker.cancelJob).toHaveBeenCalledWith("job-2");
      });
    });

    describe("when the message arrives on a different channel", () => {
      beforeEach(() => {
        capturedHandler("other:channel", JSON.stringify({ jobId: "job-3", projectId: "p1", scenarioRunId: "r1", batchRunId: "b1" }));
      });

      it("does not call cancelJob", () => {
        expect(worker.cancelJob).not.toHaveBeenCalled();
      });
    });

    describe("when the message is malformed JSON", () => {
      it("does not throw", () => {
        expect(() => capturedHandler(CANCELLATION_CHANNEL, "not-json")).not.toThrow();
      });

      it("does not call cancelJob", () => {
        capturedHandler(CANCELLATION_CHANNEL, "not-json");
        expect(worker.cancelJob).not.toHaveBeenCalled();
      });
    });
  });
});
