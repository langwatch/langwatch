import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LoggerProviderConfig } from "@opentelemetry/sdk-logs";

const loggerEmit = vi.fn();
const forceFlush = vi.fn<() => Promise<void>>();
const shutdown = vi.fn<() => Promise<void>>();
const loggerProviderConstructed = vi.fn<(config: LoggerProviderConfig) => void>();
const exporterConstructed = vi.fn<(config: Record<string, unknown>) => void>();

// The OTLP pipeline is mocked so a unit test can assert the thing that matters
// most about this feature: with the flag off, none of it is ever constructed.
// `@opentelemetry/resources` is deliberately NOT mocked — the whole point of the
// resource wiring is that it reads OTEL_RESOURCE_ATTRIBUTES, and mocking it away
// would test nothing.
vi.mock("@opentelemetry/sdk-logs", () => ({
  LoggerProvider: class {
    constructor(config: LoggerProviderConfig) {
      loggerProviderConstructed(config);
    }
    getLogger() {
      return { emit: loggerEmit };
    }
    forceFlush() {
      return forceFlush();
    }
    shutdown() {
      return shutdown();
    }
  },
  SimpleLogRecordProcessor: class {
    constructor(readonly exporter: unknown) {}
  },
}));

vi.mock("@opentelemetry/exporter-logs-otlp-http", () => ({
  OTLPLogExporter: class {
    constructor(config: Record<string, unknown>) {
      exporterConstructed(config);
    }
  },
}));

import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  areEventsEnabled,
  createCommandEvents,
  redactSecrets,
  resolveLogsEndpoint,
  resolveTransport,
} from "../events";
import {
  LANGWATCH_EVENT_ATTRIBUTES as ATTR,
  LANGWATCH_EVENTS,
} from "../attributes";

const ENABLED_ENV = {
  LANGWATCH_OTEL_EVENTS: "1",
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
} satisfies NodeJS.ProcessEnv;

/** The attributes of every record emitted so far, in emit order. */
const emittedRecords = (): Record<string, unknown>[] =>
  loggerEmit.mock.calls.map((call) => {
    const [record] = call as [{ attributes: Record<string, unknown> }];
    return record.attributes;
  });

const eventSequence = (): unknown[] =>
  emittedRecords().map((attributes) => attributes[ATTR.event]);

describe("createCommandEvents()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    forceFlush.mockResolvedValue(undefined);
    shutdown.mockResolvedValue(undefined);
  });

  describe("given the feature flag is unset", () => {
    describe("when a command emits its whole life cycle", () => {
      it("constructs no exporter and emits nothing", async () => {
        const events = createCommandEvents({
          resource: "trace",
          verb: "search",
          env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" },
        });

        events.started("Searching traces…");
        events.count({ count: 1204, message: "1,204 traces matched" });
        events.progress({ progress: 0.5, message: "Halfway" });
        events.completed({ count: 25, message: "Done" });
        events.failed({ error: new Error("boom") });
        await events.flush();

        expect(exporterConstructed).not.toHaveBeenCalled();
        expect(loggerProviderConstructed).not.toHaveBeenCalled();
        expect(loggerEmit).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the flag is set but no collector is configured", () => {
    describe("when a command emits its life cycle", () => {
      it("constructs no exporter and emits nothing", async () => {
        const events = createCommandEvents({
          resource: "trace",
          verb: "search",
          env: { LANGWATCH_OTEL_EVENTS: "1" },
        });

        events.started("Searching traces…");
        events.completed({ count: 0, message: "Done" });
        await events.flush();

        expect(exporterConstructed).not.toHaveBeenCalled();
        expect(loggerEmit).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the channel is switched on", () => {
    describe("when a command reports a full life cycle", () => {
      it("emits started, count, progress and completed in order", async () => {
        const events = createCommandEvents({
          resource: "trace",
          verb: "search",
          env: ENABLED_ENV,
        });

        events.started("Searching traces…");
        events.count({ count: 1204, total: 1204, message: "1,204 traces matched" });
        events.progress({ progress: 0.5, count: 12, total: 25, message: "12 of 25" });
        events.completed({ count: 25, total: 1204, message: "Done" });
        await events.flush();

        expect(eventSequence()).toEqual([
          LANGWATCH_EVENTS.started,
          LANGWATCH_EVENTS.count,
          LANGWATCH_EVENTS.progress,
          LANGWATCH_EVENTS.completed,
        ]);
      });

      it("carries the resource and verb on every record", async () => {
        const events = createCommandEvents({
          resource: "trace",
          verb: "search",
          env: ENABLED_ENV,
        });

        events.started("Searching traces…");
        events.completed({ count: 25, message: "Done" });
        await events.flush();

        for (const attributes of emittedRecords()) {
          expect(attributes[ATTR.resource]).toBe("trace");
          expect(attributes[ATTR.verb]).toBe("search");
        }
      });

      it("carries the matched count and a human message on the count record", async () => {
        const events = createCommandEvents({
          resource: "trace",
          verb: "search",
          env: ENABLED_ENV,
        });

        events.count({ count: 1204, total: 1204, message: "1,204 traces matched" });
        await events.flush();

        expect(emittedRecords()[0]).toMatchObject({
          [ATTR.event]: LANGWATCH_EVENTS.count,
          [ATTR.count]: 1204,
          [ATTR.total]: 1204,
          [ATTR.message]: "1,204 traces matched",
        });
      });

      it("carries the elapsed duration on the completed record", async () => {
        const events = createCommandEvents({
          resource: "trace",
          verb: "search",
          env: ENABLED_ENV,
        });

        events.completed({ count: 25, total: 1204, message: "Done" });
        await events.flush();

        const completed = emittedRecords()[0]!;
        expect(completed[ATTR.progress]).toBe(1);
        expect(completed[ATTR.durationMs]).toEqual(expect.any(Number));
        expect(completed[ATTR.durationMs] as number).toBeGreaterThanOrEqual(0);
      });

      it("sends the records to the configured OTLP logs endpoint", async () => {
        const events = createCommandEvents({
          resource: "trace",
          verb: "search",
          env: ENABLED_ENV,
        });

        events.started("Searching traces…");
        await events.flush();

        expect(exporterConstructed).toHaveBeenCalledWith(
          expect.objectContaining({ url: "http://localhost:4318/v1/logs" }),
        );
      });
    });

    describe("when a progress fraction falls outside 0..1", () => {
      it("clamps it to the 0..1 the progress bar expects", async () => {
        const events = createCommandEvents({
          resource: "trace",
          verb: "search",
          env: ENABLED_ENV,
        });

        events.progress({ progress: 1.7, message: "Over" });
        events.progress({ progress: -3, message: "Under" });
        await events.flush();

        expect(emittedRecords()[0]![ATTR.progress]).toBe(1);
        expect(emittedRecords()[1]![ATTR.progress]).toBe(0);
      });
    });

    describe("when the worker declares the Langy turn in OTEL_RESOURCE_ATTRIBUTES", () => {
      // The OTEL env detector reads `process.env` directly, per the spec — so this
      // exercises the real production path rather than an injected stand-in.
      // Correlation is the whole point of the channel: without it the panel cannot
      // tell which turn an event belongs to.
      it("carries the conversation and turn on the resource", async () => {
        const previous = process.env.OTEL_RESOURCE_ATTRIBUTES;
        process.env.OTEL_RESOURCE_ATTRIBUTES =
          "langy.conversation_id=conv_123,langy.turn_id=turn_456";

        try {
          const events = createCommandEvents({
            resource: "trace",
            verb: "search",
            env: ENABLED_ENV,
          });

          events.started("Searching traces…");
          await events.flush();

          const config = loggerProviderConstructed.mock.calls[0]![0];
          expect(config.resource?.attributes).toMatchObject({
            "langy.conversation_id": "conv_123",
            "langy.turn_id": "turn_456",
            "service.name": "langwatch-cli",
          });
        } finally {
          if (previous === undefined) delete process.env.OTEL_RESOURCE_ATTRIBUTES;
          else process.env.OTEL_RESOURCE_ATTRIBUTES = previous;
        }
      });
    });
  });

  describe("given the collector is broken", () => {
    describe("when the exporter throws on every export", () => {
      it("does not fail the command", async () => {
        loggerEmit.mockImplementation(() => {
          throw new Error("collector refused the connection");
        });

        const events = createCommandEvents({
          resource: "trace",
          verb: "search",
          env: ENABLED_ENV,
        });

        events.started("Searching traces…");
        events.completed({ count: 25, message: "Done" });

        await expect(events.flush()).resolves.toBeUndefined();
      });
    });

    describe("when the collector never answers", () => {
      it("bounds the flush instead of hanging the command", async () => {
        forceFlush.mockImplementation(() => new Promise<void>(() => undefined));

        const events = createCommandEvents({
          resource: "trace",
          verb: "search",
          env: ENABLED_ENV,
        });
        events.started("Searching traces…");

        const startedAt = Date.now();
        await events.flush();

        // The flush is raced against a 2s cap; a hung collector must not add more.
        expect(Date.now() - startedAt).toBeLessThan(4_000);
      });
    });
  });

  describe("given a command fails", () => {
    describe("when the failure message quotes the API key", () => {
      it("redacts the key out of the error event", async () => {
        const apiKey = "sk-lw-super-secret-key-value";
        const events = createCommandEvents({
          resource: "trace",
          verb: "search",
          env: { ...ENABLED_ENV, LANGWATCH_API_KEY: apiKey },
        });

        events.failed({
          error: new Error(`401 Unauthorized: key ${apiKey} is not valid`),
        });
        await events.flush();

        const error = emittedRecords()[0]!;
        expect(error[ATTR.event]).toBe(LANGWATCH_EVENTS.error);
        expect(error[ATTR.error]).not.toContain(apiKey);
        expect(error[ATTR.error]).toContain("[redacted]");
      });
    });

    describe("when the failure is a plain message", () => {
      it("carries the reason on the error event", async () => {
        const events = createCommandEvents({
          resource: "trace",
          verb: "search",
          env: ENABLED_ENV,
        });

        events.failed({ error: new Error("Network unreachable") });
        await events.flush();

        expect(emittedRecords()[0]).toMatchObject({
          [ATTR.event]: LANGWATCH_EVENTS.error,
          [ATTR.error]: "Network unreachable",
        });
      });
    });

    describe("when the platform declined the request with a domain error", () => {
      // The SDK's service layer flattens the API body into a sentence but keeps the
      // original alongside it. The panel needs the KIND — a `not_found` it can act
      // on — not the prose.
      it("carries the platform's own kind and status, not just prose", async () => {
        const events = createCommandEvents({
          resource: "dataset",
          verb: "list",
          env: ENABLED_ENV,
        });

        events.failed({
          error: Object.assign(new Error("Failed to list datasets: not found"), {
            status: 404,
            originalError: {
              error: "dataset_not_found",
              message: "Dataset not found: ds_42",
              id: "ds_42",
            },
          }),
        });
        await events.flush();

        expect(emittedRecords()[0]).toMatchObject({
          [ATTR.event]: LANGWATCH_EVENTS.error,
          [ATTR.errorKind]: "dataset_not_found",
          [ATTR.errorStatus]: 404,
          [ATTR.errorIsHandled]: true,
          [ATTR.error]: "Dataset not found: ds_42",
        });
      });
    });

    describe("when the platform failed with a 500", () => {
      // A 500 is OUR failure. Trusting a `kind` off a 500 body would let an
      // outage present itself to the user as though they had done something wrong.
      it("reports it as infrastructure, not as the user's fault", async () => {
        const events = createCommandEvents({
          resource: "trace",
          verb: "search",
          env: ENABLED_ENV,
        });

        events.failed({
          error: Object.assign(new Error("boom"), {
            status: 500,
            originalError: { error: "Internal server error", message: "boom" },
          }),
        });
        await events.flush();

        expect(emittedRecords()[0]).toMatchObject({
          [ATTR.errorIsHandled]: false,
          [ATTR.errorStatus]: 500,
        });
      });
    });
  });
});

describe("the IPC transport", () => {
  let socketDir: string;
  let socketPath: string;
  let server: net.Server;
  let received: string[];
  let connections: net.Socket[];

  beforeEach(async () => {
    vi.clearAllMocks();
    received = [];
    connections = [];
    socketDir = mkdtempSync(join(tmpdir(), "langy-ipc-"));
    socketPath = join(socketDir, "events.sock");

    server = net.createServer((socket) => {
      connections.push(socket);
      socket.on("data", (chunk) => {
        for (const line of chunk.toString("utf8").split("\n")) {
          if (line.trim()) received.push(line);
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  });

  afterEach(async () => {
    // `net.Server#close` waits on live connections, so drop them first —
    // `closeAllConnections` is an http.Server method and does not exist here.
    for (const socket of connections) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(socketDir, { recursive: true, force: true });
  });

  describe("given the host is listening on a socket", () => {
    describe("when a command reports its life cycle", () => {
      it("streams the events down the socket as newline-delimited JSON", async () => {
        const events = createCommandEvents({
          resource: "trace",
          verb: "search",
          env: { LANGWATCH_EVENTS_SOCKET: socketPath },
        });

        events.started("Searching traces…");
        events.count({ count: 1204, total: 1204, message: "1,204 traces matched" });
        events.completed({ count: 25, total: 1204, message: "Done" });
        await events.flush();

        // The socket write is async; give the server a tick to drain it.
        await vi.waitFor(() => expect(received.length).toBe(3));

        const records = received.map((line) => JSON.parse(line) as {
          event: string;
          attributes: Record<string, unknown>;
        });

        expect(records.map((r) => r.event)).toEqual([
          LANGWATCH_EVENTS.started,
          LANGWATCH_EVENTS.count,
          LANGWATCH_EVENTS.completed,
        ]);
        expect(records[1]!.attributes).toMatchObject({
          [ATTR.resource]: "trace",
          [ATTR.verb]: "search",
          [ATTR.count]: 1204,
        });
      });

      // The reason the IPC path exists at all: no OTEL SDK, so none of the ~60ms
      // of parse+init that pulling the exporter in would cost.
      it("never loads the OTEL exporter", async () => {
        const events = createCommandEvents({
          resource: "trace",
          verb: "search",
          env: { LANGWATCH_EVENTS_SOCKET: socketPath },
        });

        events.started("Searching traces…");
        await events.flush();

        expect(exporterConstructed).not.toHaveBeenCalled();
        expect(loggerProviderConstructed).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a socket path nothing is listening on", () => {
    describe("when a command reports its life cycle", () => {
      it("does not fail or hang the command", async () => {
        const events = createCommandEvents({
          resource: "trace",
          verb: "search",
          env: { LANGWATCH_EVENTS_SOCKET: join(socketDir, "nobody-home.sock") },
        });

        events.started("Searching traces…");
        events.completed({ count: 0, message: "Done" });

        const startedAt = Date.now();
        await expect(events.flush()).resolves.toBeUndefined();
        expect(Date.now() - startedAt).toBeLessThan(2_000);
      });
    });
  });
});

describe("resolveTransport()", () => {
  describe("given the host provides a socket", () => {
    it("prefers IPC over OTLP, being cheaper and faster", () => {
      expect(
        resolveTransport({
          LANGWATCH_EVENTS_SOCKET: "/tmp/langy.sock",
          LANGWATCH_OTEL_EVENTS: "1",
          OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
        }),
      ).toEqual({ kind: "ipc", path: "/tmp/langy.sock" });
    });

    it("needs no flag, because handing over a socket is the ask", () => {
      expect(resolveTransport({ LANGWATCH_EVENTS_SOCKET: "/tmp/langy.sock" })).toEqual({
        kind: "ipc",
        path: "/tmp/langy.sock",
      });
    });
  });

  describe("given only OTLP is configured", () => {
    it("selects the OTLP transport", () => {
      expect(resolveTransport(ENABLED_ENV)).toEqual({
        kind: "otlp",
        endpoint: "http://localhost:4318/v1/logs",
      });
    });
  });

  describe("given nothing is configured", () => {
    it("selects no transport at all", () => {
      expect(resolveTransport({})).toBeNull();
    });
  });
});

describe("redactSecrets()", () => {
  describe("given a message quoting a value from this environment", () => {
    it("removes the value whatever shape it has", () => {
      const scrubbed = redactSecrets("token=abcdefgh12345678 rejected", {
        LANGWATCH_API_KEY: "abcdefgh12345678",
      });

      expect(scrubbed).not.toContain("abcdefgh12345678");
    });
  });

  describe("given a message quoting a credential this process never held", () => {
    it("still redacts it on shape alone", () => {
      expect(redactSecrets("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9", {})).not.toContain(
        "eyJhbGciOiJIUzI1NiJ9",
      );
      expect(redactSecrets("used sk-proj-AbCdEfGh12345678", {})).not.toContain(
        "sk-proj-AbCdEfGh12345678",
      );
    });
  });

  describe("given a very long message", () => {
    it("truncates it so a stack trace cannot ride along", () => {
      expect(redactSecrets("x".repeat(5_000), {}).length).toBeLessThanOrEqual(500);
    });
  });
});

describe("resolveLogsEndpoint()", () => {
  describe("given the signal-specific endpoint is set", () => {
    it("uses it verbatim", () => {
      expect(
        resolveLogsEndpoint({
          OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "http://collector:4318/custom/logs",
          OTEL_EXPORTER_OTLP_ENDPOINT: "http://ignored:4318",
        }),
      ).toBe("http://collector:4318/custom/logs");
    });
  });

  describe("given only the generic endpoint is set", () => {
    it("hangs the logs path off it", () => {
      expect(
        resolveLogsEndpoint({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318/" }),
      ).toBe("http://collector:4318/v1/logs");
    });
  });

  describe("given no endpoint is set", () => {
    it("reports that there is nowhere to send events", () => {
      expect(resolveLogsEndpoint({})).toBeNull();
    });
  });
});

describe("areEventsEnabled()", () => {
  describe("given the flag is set to a truthy value and a collector exists", () => {
    it("switches the channel on", () => {
      for (const value of ["1", "true", "yes", "ON"]) {
        expect(
          areEventsEnabled({
            LANGWATCH_OTEL_EVENTS: value,
            OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
          }),
        ).toBe(true);
      }
    });
  });

  describe("given the flag is absent, empty or falsy", () => {
    it("leaves the channel off", () => {
      const collector = { OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" };

      expect(areEventsEnabled(collector)).toBe(false);
      expect(areEventsEnabled({ ...collector, LANGWATCH_OTEL_EVENTS: "" })).toBe(false);
      expect(areEventsEnabled({ ...collector, LANGWATCH_OTEL_EVENTS: "0" })).toBe(false);
      expect(areEventsEnabled({ ...collector, LANGWATCH_OTEL_EVENTS: "false" })).toBe(false);
    });
  });
});
