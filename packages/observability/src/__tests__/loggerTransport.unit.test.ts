import { beforeEach, describe, expect, it, vi } from "vitest";

const pinoMock = vi.hoisted(() => {
  const transport = vi.fn();
  const multistream = vi.fn((streams: { stream: { write(line: string): void } }[]) => ({
    streams,
  }));
  const pino = vi.fn((options: { level: string }, _stream?: { write(line: string): void }) => ({
    level: options.level,
  }));

  Object.assign(pino, {
    stdSerializers: { err: vi.fn() },
    stdTimeFunctions: { isoTime: vi.fn() },
    transport,
    multistream,
  });

  return { pino, transport, multistream };
});

/** A transport double whose `error` listener the test can fire. */
function fakeTransport() {
  const listeners: ((error: unknown) => void)[] = [];
  return {
    write: vi.fn(),
    emit: vi.fn(),
    on: vi.fn((_event: string, listener: (error: unknown) => void) => listeners.push(listener)),
    fail: (error: unknown) => listeners.forEach((listener) => listener(error)),
  };
}

vi.mock("pino", () => ({ default: pinoMock.pino }));

import { createLoggerFactory } from "../logger.ts";

describe("configured Node logger transports", () => {
  beforeEach(() => {
    pinoMock.pino.mockClear();
    pinoMock.multistream.mockClear();
    pinoMock.transport.mockReset();
    pinoMock.transport.mockImplementation(fakeTransport);
  });

  it("uses the configured pretty console target without OTel when export is disabled", () => {
    createLoggerFactory({
      environment: "production",
      format: "pretty",
      consoleLevel: "warn",
      otelExportEnabled: false,
    }).createLogger("transport-pretty");

    expect(pinoMock.transport).toHaveBeenCalledWith({
      targets: [
        expect.objectContaining({
          target: "pino-pretty",
          level: "warn",
          options: expect.objectContaining({ minimumLevel: "warn" }),
        }),
      ],
    });
  });

  it("uses JSON console and the legacy fixed OTel logger name when export is enabled", () => {
    createLoggerFactory({
      environment: "production",
      format: "json",
      serviceName: "langwatch-worker",
      deploymentEnvironment: "prod-eu",
      otelExportEnabled: true,
      consoleLevel: "error",
      otelLevel: "info",
      otelTransportServiceVersion: "build-42",
    }).createLogger("transport-json");

    expect(pinoMock.transport).toHaveBeenCalledWith({
      targets: [
        expect.objectContaining({
          target: "pino/file",
          level: "error",
          options: { destination: 1 },
        }),
      ],
    });
    expect(pinoMock.multistream).toHaveBeenCalledWith([
      expect.objectContaining({ level: "error" }),
      expect.objectContaining({ level: "info" }),
    ]);
    expect(pinoMock.transport).toHaveBeenCalledWith({
      targets: [
        expect.objectContaining({
          target: "pino-opentelemetry-transport",
          level: "info",
          options: expect.objectContaining({
            loggerName: "langwatch-app",
            serviceVersion: "build-42",
            resourceAttributes: {
              "service.name": "langwatch-worker",
              "deployment.environment.name": "prod-eu",
            },
          }),
        }),
      ],
    });
  });

  it("reports a transport that fails after setup and writes its lines to stdout", () => {
    const failing = fakeTransport();
    pinoMock.transport.mockReturnValue(failing);
    const reported = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const printed = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    createLoggerFactory({ environment: "production" }).createLogger("transport-late-failure");
    const [, stream] = pinoMock.pino.mock.lastCall ?? [];
    failing.fail(new Error("the worker has exited"));
    stream?.write("after the failure\n");

    expect(reported).toHaveBeenCalledOnce();
    expect(printed).toHaveBeenCalledWith("after the failure\n");
    expect(failing.write).not.toHaveBeenCalled();
    reported.mockRestore();
    printed.mockRestore();
  });

  /**
   * @scenario A failing transport warns once and its lines are dropped quietly
   * @scenario The transport resumes when the endpoint returns
   */
  it("warns once, stays quiet while down and resumes on a fresh worker after the interval", () => {
    vi.useFakeTimers();
    const first = fakeTransport();
    const second = fakeTransport();
    pinoMock.transport.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const reported = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const printed = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    createLoggerFactory({ environment: "production" }).createLogger("transport-resume");
    const [, stream] = pinoMock.pino.mock.lastCall ?? [];
    first.fail(new Error("the worker has exited"));
    first.fail(new Error("the worker has exited"));
    stream?.write("while down\n");
    vi.advanceTimersByTime(30_000);
    stream?.write("after the endpoint returns\n");
    second.fail(new Error("the worker has exited"));

    expect(reported).toHaveBeenCalledOnce();
    expect(first.write).not.toHaveBeenCalled();
    expect(second.write).toHaveBeenCalledWith("after the endpoint returns\n");
    reported.mockRestore();
    printed.mockRestore();
    vi.useRealTimers();
  });

  it("hands the OTel worker epoch milliseconds, since an ISO time string ends that worker", () => {
    const consoleTransport = fakeTransport();
    const otelTransport = fakeTransport();
    pinoMock.transport.mockReturnValueOnce(consoleTransport).mockReturnValueOnce(otelTransport);

    createLoggerFactory({ environment: "production", otelExportEnabled: true }).createLogger(
      "transport-otel-time",
    );
    const [streams] = pinoMock.multistream.mock.lastCall ?? [];
    const line = '{"level":"info","time":"2026-10-09T17:38:32.936Z","msg":"a"}\n';
    for (const { stream } of streams ?? []) stream.write(line);

    expect(consoleTransport.write).toHaveBeenCalledWith(line);
    expect(otelTransport.write).toHaveBeenCalledWith(
      '{"level":"info","time":1791567512936,"msg":"a"}\n',
    );
  });

  it("falls back to stdout when a configured transport cannot initialize", () => {
    pinoMock.transport.mockImplementation(() => {
      throw new Error("transport unavailable");
    });

    createLoggerFactory({ environment: "production", otelExportEnabled: true }).createLogger(
      "transport-fallback",
    );

    expect(pinoMock.pino).toHaveBeenLastCalledWith(expect.any(Object), process.stdout);
  });
});
