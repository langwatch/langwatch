/** Pins the structured JSON log format contract (dev/docs/best_practices/dev-log-format.md). */
import { describe, expect, it, vi } from "vitest";

import { resolveLoggerConfiguration } from "../logger-config.ts";
import { createLoggerFactory } from "../logger.ts";

vi.mock("@opentelemetry/api", () => ({
  context: { active: vi.fn(() => ({})) },
  trace: { getSpan: vi.fn(() => undefined) },
}));

/** RFC 3339, UTC, to the millisecond — what both renderers parse. */
const RFC_3339_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("given a process logger", () => {
  describe("when the environment is development", () => {
    it("still selects JSON, so dev and production emit the same record", () => {
      expect(resolveLoggerConfiguration({ environment: "development" }).format).toBe("json");
    });

    it("selects the pretty console only when the deployment asks for it", () => {
      expect(
        resolveLoggerConfiguration({ environment: "development", format: "pretty" }).format,
      ).toBe("pretty");
    });
  });

  describe("when a line is emitted", () => {
    it("carries the shared field vocabulary", () => {
      const written: string[] = [];
      const writeSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk: string | Uint8Array) => {
          written.push(String(chunk));
          return true;
        });

      try {
        const factory = createLoggerFactory({
          environment: "test",
          level: "info",
          serviceName: "langwatch-api",
        });
        factory.createLogger("langwatch:api:rest").info({ port: 6560 }, "listening");
      } finally {
        writeSpy.mockRestore();
      }

      const record = JSON.parse(written.at(-1) ?? "{}");
      expect(record.level).toBe("info");
      expect(record.msg).toBe("listening");
      expect(record.service).toBe("langwatch-api");
      expect(record.port).toBe(6560);
      expect(record.time).toMatch(RFC_3339_MILLIS);
    });

    it("writes the level as a lowercase word, not a number and not shouted", () => {
      const written: string[] = [];
      const writeSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk: string | Uint8Array) => {
          written.push(String(chunk));
          return true;
        });

      try {
        const logger = createLoggerFactory({
          environment: "test",
          level: "warn",
          serviceName: "langwatch-worker",
        }).createLogger("langwatch:worker");
        logger.warn("slow");
        logger.error("failed");
      } finally {
        writeSpy.mockRestore();
      }

      expect(written.map((line) => JSON.parse(line).level)).toEqual(["warn", "error"]);
    });
  });
});
