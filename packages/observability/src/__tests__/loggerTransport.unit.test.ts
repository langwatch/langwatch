import { beforeEach, describe, expect, it, vi } from "vitest";

const pinoMock = vi.hoisted(() => {
  const transport = vi.fn();
  const pino = vi.fn((options: { level: string }) => ({ level: options.level }));

  Object.assign(pino, {
    stdSerializers: { err: vi.fn() },
    stdTimeFunctions: { isoTime: vi.fn() },
    transport,
  });

  return { pino, transport };
});

vi.mock("pino", () => ({ default: pinoMock.pino }));

import { createLoggerFactory } from "../logger";

describe("configured Node logger transports", () => {
  beforeEach(() => {
    pinoMock.pino.mockClear();
    pinoMock.transport.mockReset();
    pinoMock.transport.mockReturnValue({ write: vi.fn() });
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
