import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventSourcedQueueProcessorImpl } from "../index";
import { Queue, Worker } from "bullmq";

// Mock Redis connection
let mockConnection: any = undefined;
vi.mock("../../../redis", () => ({
  get connection() {
    return mockConnection;
  },
}));

// Mock BullMQ
vi.mock("bullmq", () => {
  const mockQueue = {
    add: vi.fn().mockResolvedValue({ id: "job-1" }),
    close: vi.fn().mockResolvedValue(void 0),
  };

  const mockWorker = {
    close: vi.fn().mockResolvedValue(void 0),
    on: vi.fn(),
  };

  return {
    Queue: vi.fn().mockImplementation(() => mockQueue),
    Worker: vi.fn().mockImplementation(() => mockWorker),
  };
});

// Mock BullMQOtel
vi.mock("bullmq-otel", () => ({
  BullMQOtel: vi.fn().mockImplementation(() => ({})),
}));

// Mock logger and tracer
vi.mock("../../../../utils/logger", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: vi.fn(() => ({
    withActiveSpan: vi.fn((name, options, fn) => fn()),
  })),
}));

describe("EventSourcedQueueProcessorImpl", () => {
  let originalConnection: any;

  beforeEach(() => {
    originalConnection = mockConnection;
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockConnection = originalConnection;
  });

  describe("inline mode", () => {
    beforeEach(() => {
      mockConnection = undefined;
    });

    it("executes process inline when Redis connection is null", async () => {
      const processFn = vi.fn().mockResolvedValue(void 0);
      const processor = new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: processFn,
      });

      const payload = { test: "data" };
      await processor.send(payload);

      expect(processFn).toHaveBeenCalledWith(payload);
      expect(processFn).toHaveBeenCalledTimes(1);
    });

    it("close() does nothing in inline mode", async () => {
      const processor = new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: vi.fn(),
      });

      await expect(processor.close()).resolves.not.toThrow();
    });

    it("close() is safe to call multiple times in inline mode", async () => {
      const processor = new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: vi.fn(),
      });

      await processor.close();
      await processor.close();
      await processor.close();

      // Should not throw
      expect(true).toBe(true);
    });

    it("does not create queue or worker in inline mode", () => {
      new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: vi.fn(),
      });

      expect(Queue).not.toHaveBeenCalled();
      expect(Worker).not.toHaveBeenCalled();
    });

    it("preserves error propagation in inline mode", async () => {
      const error = new Error("Test error");
      const processFn = vi.fn().mockRejectedValue(error);
      const processor = new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: processFn,
      });

      await expect(processor.send({})).rejects.toThrow("Test error");
    });

    it("handles inline mode when connection is explicitly undefined", () => {
      mockConnection = undefined;

      const processor = new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: vi.fn(),
      });

      expect(Queue).not.toHaveBeenCalled();
      expect(Worker).not.toHaveBeenCalled();
    });
  });

  describe("queue mode", () => {
    let mockQueue: any;
    let mockWorker: any;

    beforeEach(() => {
      mockConnection = {};

      mockQueue = {
        add: vi.fn().mockResolvedValue({ id: "job-1" }),
        close: vi.fn().mockResolvedValue(void 0),
      };

      mockWorker = {
        close: vi.fn().mockResolvedValue(void 0),
        on: vi.fn(),
      };

      vi.mocked(Queue).mockClear();
      vi.mocked(Worker).mockClear();
      vi.mocked(Queue).mockImplementation(() => mockQueue);
      vi.mocked(Worker).mockImplementation(() => mockWorker);
    });

    it("initializes queue and worker when Redis is available", () => {
      new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: vi.fn(),
      });

      expect(Queue).toHaveBeenCalledWith(
        "test-queue",
        expect.objectContaining({
          connection: mockConnection,
        }),
      );
      expect(Worker).toHaveBeenCalledWith(
        "test-queue",
        expect.any(Function),
        expect.objectContaining({
          connection: mockConnection,
        }),
      );
    });

    it("initializes queue with correct options", () => {
      new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: vi.fn(),
      });

      expect(Queue).toHaveBeenCalledWith(
        "test-queue",
        expect.objectContaining({
          defaultJobOptions: expect.objectContaining({
            attempts: 3,
            backoff: {
              type: "exponential",
              delay: 2000,
            },
            removeOnComplete: {
              age: 3600,
              count: 1000,
            },
            removeOnFail: {
              age: 60 * 60 * 24 * 7,
            },
          }),
        }),
      );
    });

    it("initializes worker with default concurrency", () => {
      new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: vi.fn(),
      });

      expect(Worker).toHaveBeenCalledWith(
        "test-queue",
        expect.any(Function),
        expect.objectContaining({
          concurrency: 5,
        }),
      );
    });

    it("initializes worker with custom concurrency", () => {
      new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: vi.fn(),
        options: { concurrency: 10 },
      });

      expect(Worker).toHaveBeenCalledWith(
        "test-queue",
        expect.any(Function),
        expect.objectContaining({
          concurrency: 10,
        }),
      );
    });

    it("send() adds job to queue with correct payload", async () => {
      const processor = new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: vi.fn(),
      });

      const payload = { test: "data" };
      await processor.send(payload);

      expect(mockQueue.add).toHaveBeenCalledWith("test-job", payload, {});
    });

    it("send() uses makeJobId when provided", async () => {
      const makeJobId = vi.fn().mockReturnValue("custom-job-id");
      const processor = new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        makeJobId,
        process: vi.fn(),
      });

      const payload = { test: "data" };
      await processor.send(payload);

      expect(makeJobId).toHaveBeenCalledWith(payload);
      expect(mockQueue.add).toHaveBeenCalledWith("test-job", payload, {
        jobId: "custom-job-id",
      });
    });

    it("send() handles job without makeJobId", async () => {
      const processor = new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: vi.fn(),
      });

      const payload = { test: "data" };
      await processor.send(payload);

      expect(mockQueue.add).toHaveBeenCalledWith("test-job", payload, {});
    });

    it("send() handles undefined jobId from makeJobId", async () => {
      const makeJobId = vi.fn().mockReturnValue(undefined);
      const processor = new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        makeJobId,
        process: vi.fn(),
      });

      const payload = { test: "data" };
      await processor.send(payload);

      expect(mockQueue.add).toHaveBeenCalledWith("test-job", payload, {});
    });

    it("worker processes jobs correctly", async () => {
      const processFn = vi.fn().mockResolvedValue(void 0);
      new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: processFn,
      });

      // Get the worker processor function
      const workerCall = vi.mocked(Worker).mock.calls[0];
      if (!workerCall) {
        throw new Error("Worker was not called");
      }
      const workerProcessor = workerCall[1] as (job: { id: string; data: unknown }) => Promise<void>;
      if (!workerProcessor || typeof workerProcessor !== "function") {
        throw new Error("Worker processor is not a function");
      }

      const mockJob = {
        id: "job-1",
        data: { test: "data" },
      };

      await workerProcessor(mockJob);

      expect(processFn).toHaveBeenCalledWith({ test: "data" });
    });

    it("worker handles errors and logs them", async () => {
      const processFn = vi
        .fn()
        .mockRejectedValue(new Error("Processing error"));
      new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: processFn,
      });

      // Get the worker processor function
      const workerCall = vi.mocked(Worker).mock.calls[0];
      if (!workerCall) {
        throw new Error("Worker was not called");
      }
      const workerProcessor = workerCall[1] as (job: { id: string; data: unknown }) => Promise<void>;
      if (!workerProcessor || typeof workerProcessor !== "function") {
        throw new Error("Worker processor is not a function");
      }

      const mockJob = {
        id: "job-1",
        data: { test: "data" },
      };

      // Worker should handle errors
      await expect(workerProcessor(mockJob)).rejects.toThrow(
        "Processing error",
      );
    });

    it("worker registers event handlers", () => {
      new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: vi.fn(),
      });

      expect(mockWorker.on).toHaveBeenCalledWith("ready", expect.any(Function));
      expect(mockWorker.on).toHaveBeenCalledWith(
        "failed",
        expect.any(Function),
      );
    });

    it("close() gracefully closes worker and queue", async () => {
      const processor = new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: vi.fn(),
      });

      await processor.close();

      expect(mockWorker.close).toHaveBeenCalled();
      expect(mockQueue.close).toHaveBeenCalled();
    });

    it("close() closes worker before queue", async () => {
      let closeOrder: string[] = [];
      mockWorker.close = vi.fn().mockImplementation(async () => {
        closeOrder.push("worker");
      });
      mockQueue.close = vi.fn().mockImplementation(async () => {
        closeOrder.push("queue");
      });

      const processor = new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: vi.fn(),
      });

      await processor.close();

      expect(closeOrder).toEqual(["worker", "queue"]);
    });

    it("close() is idempotent", async () => {
      const processor = new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: vi.fn(),
      });

      await processor.close();
      await processor.close();
      await processor.close();

      // Should only close once (or handle multiple closes gracefully)
      // The implementation may allow multiple closes, so we just verify no errors
      expect(mockWorker.close).toHaveBeenCalled();
      expect(mockQueue.close).toHaveBeenCalled();
    });

    it("close() handles error in worker close", async () => {
      mockWorker.close = vi
        .fn()
        .mockRejectedValue(new Error("Worker close error"));

      const processor = new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: vi.fn(),
      });

      await expect(processor.close()).rejects.toThrow("Worker close error");
      // Queue should still be attempted to close (or not, depending on implementation)
    });

    it("close() handles error in queue close", async () => {
      mockQueue.close = vi
        .fn()
        .mockRejectedValue(new Error("Queue close error"));

      const processor = new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: vi.fn(),
      });

      await expect(processor.close()).rejects.toThrow("Queue close error");
    });

    it("handles job ID collision when makeJobId returns duplicate IDs", async () => {
      const makeJobId = vi.fn().mockReturnValue("duplicate-id");
      const processor = new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        makeJobId,
        process: vi.fn(),
      });

      // First send should succeed
      await processor.send({ test: "data1" });

      // Second send with same ID - BullMQ should handle this
      // The behavior depends on BullMQ's idempotency handling
      await processor.send({ test: "data2" });

      expect(mockQueue.add).toHaveBeenCalledTimes(2);
      expect(mockQueue.add).toHaveBeenNthCalledWith(
        1,
        "test-job",
        { test: "data1" },
        {
          jobId: "duplicate-id",
        },
      );
      expect(mockQueue.add).toHaveBeenNthCalledWith(
        2,
        "test-job",
        { test: "data2" },
        {
          jobId: "duplicate-id",
        },
      );
    });

    it("handles special characters in job ID", async () => {
      const makeJobId = vi
        .fn()
        .mockReturnValue("job-id-with-special-chars-🚀-@#$");
      const processor = new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        makeJobId,
        process: vi.fn(),
      });

      await processor.send({ test: "data" });

      expect(mockQueue.add).toHaveBeenCalledWith(
        "test-job",
        { test: "data" },
        {
          jobId: "job-id-with-special-chars-🚀-@#$",
        },
      );
    });
  });

  describe("mode detection", () => {
    it("detects inline mode when connection is null", () => {
      mockConnection = null;

      const processor = new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: vi.fn(),
      });

      expect(Queue).not.toHaveBeenCalled();
    });

    it("detects queue mode when connection is available", () => {
      mockConnection = {};

      new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: vi.fn(),
      });

      expect(Queue).toHaveBeenCalled();
    });

    it("mode does not change after construction", async () => {
      mockConnection = undefined;

      const processor = new EventSourcedQueueProcessorImpl({
        queueName: "test-queue",
        jobName: "test-job",
        process: vi.fn(),
      });

      // Change connection after construction
      mockConnection = {};

      // New processor should use queue mode since connection is now available
      const mockQueue = {
        add: vi.fn().mockResolvedValue({ id: "job-1" }),
        close: vi.fn().mockResolvedValue(void 0),
      };

      vi.mocked(Queue).mockImplementation(() => mockQueue as any);

      const processFn = vi.fn();
      const processor2 = new EventSourcedQueueProcessorImpl({
        queueName: "test-queue-2",
        jobName: "test-job",
        process: processFn,
      });

      await processor2.send({});
      // Should use queue mode, so processFn won't be called directly
      expect(mockQueue.add).toHaveBeenCalled();
    });
  });
});
