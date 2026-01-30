import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("Worker Startup Architecture (Static Analysis)", () => {
  // NOTE: These tests verify source code conventions, not runtime behavior.
  // They serve as documentation and guard against accidental changes.
  describe("Worker initialization logs startup events", () => {
    it("emits startup log entry with logger name 'langwatch:workers'", () => {
      // Read the worker.ts file and verify it creates a logger with the correct name
      const workerPath = path.resolve(__dirname, "../worker.ts");
      const workerContent = fs.readFileSync(workerPath, "utf8");

      // Verify the logger is created with "langwatch:workers"
      expect(workerContent).toContain('createLogger("langwatch:workers")');
    });

    it("logs initialization status for each worker type", () => {
      // Each individual worker module creates a logger with its worker type
      const workerFiles = [
        { file: "workers/collectorWorker.ts", name: "collectorWorker" },
        { file: "workers/evaluationsWorker.ts", name: "evaluationsWorker" },
        {
          file: "workers/topicClusteringWorker.ts",
          name: "topicClusteringWorker",
        },
        // Note: trackEventsWorker.ts uses "trackEventWorker" (singular)
        { file: "workers/trackEventsWorker.ts", name: "trackEventWorker" },
        { file: "workers/usageStatsWorker.ts", name: "usageStatsWorker" },
        {
          file: "workers/eventSourcingWorker.ts",
          name: "eventSourcingWorker",
        },
      ];

      for (const { file, name } of workerFiles) {
        const workerPath = path.resolve(__dirname, "..", file);
        if (fs.existsSync(workerPath)) {
          const content = fs.readFileSync(workerPath, "utf8");
          // Each worker should create a logger with its type
          expect(content).toContain("createLogger");
          expect(content).toContain(`langwatch:workers:${name}`);
        }
      }
    });
  });

  describe("Worker logs include structured context", () => {
    it("includes worker type as context in log entries", () => {
      // The logger naming convention includes worker type
      // e.g., "langwatch:workers:collectorWorker"
      const collectorWorkerPath = path.resolve(
        __dirname,
        "../workers/collectorWorker.ts",
      );
      const content = fs.readFileSync(collectorWorkerPath, "utf8");

      // Logger name includes worker type
      expect(content).toContain("langwatch:workers:collectorWorker");
    });

    it("includes job ID when available in log entries", () => {
      // Verify the logging pattern includes jobId
      const collectorWorkerPath = path.resolve(
        __dirname,
        "../workers/collectorWorker.ts",
      );
      const content = fs.readFileSync(collectorWorkerPath, "utf8");

      // The pattern: logger.info({ jobId: id, ... }, "processing job")
      expect(content).toContain("jobId");
    });

    it("uses appropriate log levels (info, warn, error)", () => {
      // Verify the worker uses multiple log levels
      const collectorWorkerPath = path.resolve(
        __dirname,
        "../workers/collectorWorker.ts",
      );
      const content = fs.readFileSync(collectorWorkerPath, "utf8");

      expect(content).toContain("logger.info");
      expect(content).toContain("logger.warn");
      expect(content).toContain("logger.error");
    });
  });

  describe("Worker restart logs include restart count", () => {
    it("logs restart event when max runtime reached", () => {
      // The worker.ts module logs "max runtime reached, closing worker"
      const workerPath = path.resolve(__dirname, "../worker.ts");
      const content = fs.readFileSync(workerPath, "utf8");

      expect(content).toContain("max runtime reached");
    });

    it("increments worker restart counter metric", () => {
      // The incrementWorkerRestartCount function increments workerRestartsCounter
      const workerPath = path.resolve(__dirname, "../worker.ts");
      const content = fs.readFileSync(workerPath, "utf8");

      expect(content).toContain("workerRestartsCounter");
      expect(content).toContain("inc()");
    });
  });

  describe("Worker graceful shutdown logs closing events", () => {
    it("logs closing events for each worker", () => {
      // The worker.ts module attaches "closing" event listeners
      const workerPath = path.resolve(__dirname, "../worker.ts");
      const content = fs.readFileSync(workerPath, "utf8");

      expect(content).toContain('on("closing"');
      expect(content).toContain("closed before expected");
    });

    it("closes workers gracefully before process exit", () => {
      // The worker.ts start function calls close() on all workers
      const workerPath = path.resolve(__dirname, "../worker.ts");
      const content = fs.readFileSync(workerPath, "utf8");

      // Workers are closed via Promise.all
      expect(content).toContain("close()");
      expect(content).toContain("Promise.all");
    });
  });

  describe("initializeBackgroundWorkers module removed from startApp", () => {
    it("does not import initializeBackgroundWorkers in start.ts", () => {
      const startTsPath = path.resolve(__dirname, "../../../start.ts");
      const startTsContent = fs.readFileSync(startTsPath, "utf8");

      expect(startTsContent).not.toContain("initializeBackgroundWorkers");
    });

    it("does not reference background/init.ts in start.ts", () => {
      const startTsPath = path.resolve(__dirname, "../../../start.ts");
      const startTsContent = fs.readFileSync(startTsPath, "utf8");

      expect(startTsContent).not.toContain("./server/background/init");
      expect(startTsContent).not.toContain("background/init");
    });

    it("init.ts module no longer exists", () => {
      const initPath = path.resolve(__dirname, "../init.ts");
      expect(fs.existsSync(initPath)).toBe(false);
    });
  });
});
