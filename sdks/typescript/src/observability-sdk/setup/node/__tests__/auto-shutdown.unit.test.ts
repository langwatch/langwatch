import { trace } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetObservabilitySdkConfig } from "../../../config.js";
import { createAndStartNodeSdk } from "../setup.js";
import type { SetupObservabilityOptions } from "../types.js";

const mocks = vi.hoisted(() => ({
  shutdown: vi.fn<() => Promise<void>>(),
}));

vi.mock("../../utils", () => ({
  isConcreteProvider: vi.fn(() => false),
  getConcreteProvider: vi.fn(() => undefined),
  createMergedResource: vi.fn(() => resourceFromAttributes({})),
}));
vi.mock("../../../exporters", () => ({
  LangWatchTraceExporter: vi.fn().mockImplementation(function () {
    return { shutdown: vi.fn() };
  }),
  LangWatchLogsExporter: vi.fn().mockImplementation(function () {
    return { shutdown: vi.fn() };
  }),
}));
vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: vi.fn().mockImplementation(function () {
    return { start: vi.fn(), shutdown: mocks.shutdown };
  }),
}));
vi.mock("../../../logger", () => ({
  setLangWatchLoggerProvider: vi.fn(),
}));

const HANDLED_EVENTS = ["beforeExit", "SIGINT", "SIGTERM"] as const;

type ProcessListener = (...args: any[]) => void;

// `process.listeners` is overloaded per event name and has no overload covering a union
// that mixes `beforeExit` with the signal names.
const listenersFor = (event: string): ProcessListener[] =>
  (process.listeners as (e: string) => ProcessListener[])(event);

const createLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
});

const startSdk = (advanced?: SetupObservabilityOptions["advanced"]) => {
  const logger = createLogger();
  createAndStartNodeSdk(
    {
      serviceName: "svc",
      langwatch: { apiKey: "test" },
      debug: { logger },
      advanced,
    },
    logger,
    resourceFromAttributes({}),
  );
  return logger;
};

// Real timers, and a mocked shutdown that settles immediately, so a couple of macrotasks
// is past every continuation the handler can schedule. Long enough to be a real settle
// point, short enough that the negative assertions below stay cheap.
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("given the observability SDK owns the process exit handlers", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let killSpy: ReturnType<typeof vi.spyOn>;
  let borrowedListeners: { event: string; listeners: ProcessListener[] }[];

  beforeEach(() => {
    vi.clearAllMocks();
    resetObservabilitySdkConfig();

    mocks.shutdown.mockReset();
    mocks.shutdown.mockResolvedValue(undefined);

    // The test runner has its own listeners on these events, and their presence is exactly
    // what the code under test reads to decide whether it may re-raise. Take them off for
    // the duration of the test so each case controls the listener set, and put them back
    // untouched afterwards.
    borrowedListeners = HANDLED_EVENTS.map((event) => ({
      event,
      listeners: listenersFor(event),
    }));
    for (const { event } of borrowedListeners)
      process.removeAllListeners(event);

    // Both are how the process would actually die, so both are stubbed: an unstubbed
    // re-raise would take the test worker down with it.
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => void 0) as never);
    killSpy = vi
      .spyOn(process, "kill")
      .mockImplementation((() => true) as never);
  });

  afterEach(() => {
    for (const { event, listeners } of borrowedListeners) {
      process.removeAllListeners(event);
      for (const listener of listeners) process.on(event, listener);
    }
    exitSpy.mockRestore();
    killSpy.mockRestore();
    trace.disable();
    resetObservabilitySdkConfig();
  });

  describe("when the host has its own SIGTERM handler", () => {
    // The footgun this whole feature exists for: the SDK used to call process.exit(0) the
    // moment its own flush resolved, killing the host's drain a second or two in.
    /** @scenario A host with its own SIGTERM handler keeps control of its shutdown */
    it("flushes telemetry and terminates nothing", async () => {
      const hostHandler = vi.fn();
      process.on("SIGTERM", hostHandler);
      startSdk();

      process.emit("SIGTERM", "SIGTERM");
      await settle();

      expect(mocks.shutdown).toHaveBeenCalledTimes(1);
      expect(hostHandler).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();
      expect(killSpy).not.toHaveBeenCalled();

      process.removeListener("SIGTERM", hostHandler);
    });

    // The flush finishing first is the normal case — an OTel flush is fast and a queue
    // drain is not — so this is the ordering that used to lose the host's work.
    /** @scenario A host drain that outlives the flush is not cut short */
    it("lets a slower host drain run to completion", async () => {
      let drainCompleted = false;
      const hostHandler = () => {
        void sleep(120).then(() => {
          drainCompleted = true;
        });
      };
      process.on("SIGTERM", hostHandler);
      startSdk();

      process.emit("SIGTERM", "SIGTERM");
      await settle();

      expect(mocks.shutdown).toHaveBeenCalledTimes(1);
      expect(drainCompleted).toBe(false);
      expect(exitSpy).not.toHaveBeenCalled();
      expect(killSpy).not.toHaveBeenCalled();

      await vi.waitFor(() => expect(drainCompleted).toBe(true));
      expect(exitSpy).not.toHaveBeenCalled();

      process.removeListener("SIGTERM", hostHandler);
    });

    // A failed export is the SDK's problem, never the host's: losing spans must not also
    // change how the process ends.
    /** @scenario An export failure during the flush still leaves the host alone */
    it("reports a failed flush and still leaves the process alone", async () => {
      mocks.shutdown.mockRejectedValue(new Error("exporter unreachable"));
      const hostHandler = vi.fn();
      process.on("SIGTERM", hostHandler);
      const logger = startSdk();

      process.emit("SIGTERM", "SIGTERM");
      await settle();

      expect(logger.error).toHaveBeenCalledWith(
        "Error shutting down OpenTelemetry",
        expect.any(Error),
      );
      expect(exitSpy).not.toHaveBeenCalled();
      expect(killSpy).not.toHaveBeenCalled();

      process.removeListener("SIGTERM", hostHandler);
    });

    // The handlers are one-shot. An operator hitting Ctrl+C twice, or a supervisor sending
    // SIGTERM again, must not queue a second shutdown of an SDK that is already down.
    /** @scenario A second signal during the flush does not start a second shutdown */
    it("shuts the SDK down once across repeated signals", async () => {
      const hostHandler = vi.fn();
      process.on("SIGTERM", hostHandler);
      startSdk();

      process.emit("SIGTERM", "SIGTERM");
      process.emit("SIGTERM", "SIGTERM");
      await settle();

      expect(mocks.shutdown).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();

      process.removeListener("SIGTERM", hostHandler);
    });
  });

  describe("when the SDK installed the only handler for the signal", () => {
    // Node skips a signal's default action while any listener is registered, so a plain
    // "flush and stand aside" would leave this script running forever. Re-raising restores
    // the exact behaviour the script would have had without the SDK loaded.
    /** @scenario A one-shot script ends on the signal once the flush is done */
    it("re-raises the signal instead of exiting with a success status", async () => {
      startSdk();

      process.emit("SIGTERM", "SIGTERM");
      await settle();

      expect(mocks.shutdown).toHaveBeenCalledTimes(1);
      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");
      expect(exitSpy).not.toHaveBeenCalled();
      expect(process.listenerCount("SIGTERM")).toBe(0);
    });

    /** @scenario Ctrl+C on a script with no other handler still stops the script */
    it("re-raises SIGINT for a script interrupted at the terminal", async () => {
      startSdk();

      process.emit("SIGINT", "SIGINT");
      await settle();

      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGINT");
      expect(exitSpy).not.toHaveBeenCalled();
    });

    // A script that cannot reach the collector still has to stop when it is signalled.
    /** @scenario A flush that fails does not leave a one-shot script running */
    it("re-raises the signal even when the flush rejects", async () => {
      mocks.shutdown.mockRejectedValue(new Error("exporter unreachable"));
      startSdk();

      process.emit("SIGTERM", "SIGTERM");
      await settle();

      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGTERM");
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe("when the event loop drains", () => {
    // beforeExit is not a termination request, so there is nothing here to exit or
    // re-raise — the process is already on its way out and only needs its spans flushed.
    /** @scenario Telemetry is flushed when the event loop drains */
    it("flushes without exiting or re-raising", async () => {
      startSdk();

      process.emit("beforeExit", 0);
      await settle();

      expect(mocks.shutdown).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();
      expect(killSpy).not.toHaveBeenCalled();
    });
  });

  describe("when the host opts out of automatic shutdown", () => {
    /** @scenario Disabling auto shutdown registers no handlers at all */
    it("registers no exit or signal handlers", () => {
      startSdk({ disableAutoShutdown: true });

      for (const event of HANDLED_EVENTS) {
        expect(process.listenerCount(event)).toBe(0);
      }
    });
  });

  describe("when the host opts in to being exited after the flush", () => {
    // The escape hatch for the one application shape that regresses: a host that registers
    // a signal handler which never terminates the process, and relied on the SDK's exit.
    /** @scenario A host that relied on being exited can ask for it explicitly */
    it("exits the process as soon as the flush finishes", async () => {
      const hostHandler = vi.fn();
      process.on("SIGTERM", hostHandler);
      startSdk({ UNSAFE_exitProcessAfterAutoShutdown: true });

      process.emit("SIGTERM", "SIGTERM");
      await settle();

      expect(mocks.shutdown).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(0);

      process.removeListener("SIGTERM", hostHandler);
    });
  });
});
