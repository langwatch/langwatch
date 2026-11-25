import { describe, expect, it } from "vitest";

import { vendorClickHouseClientOptions } from "../clickhouse-member.ts";

function recordingSink() {
  const lines: [string, string][] = [];
  return {
    lines,
    sink: {
      debug: (_fields: Record<string, unknown>, message: string) => lines.push(["debug", message]),
      info: (_fields: Record<string, unknown>, message: string) => lines.push(["info", message]),
      warn: (_fields: Record<string, unknown>, message: string) => lines.push(["warn", message]),
    },
  };
}

function driverLoggerFor({ logSink }: { logSink: ReturnType<typeof recordingSink>["sink"] }) {
  const options = vendorClickHouseClientOptions({
    config: { url: "http://127.0.0.1:8123" },
    input: { url: "http://127.0.0.1:8123", maxOpenConnections: 4 },
    logSink,
  });
  const LoggerClass = options.log?.LoggerClass;
  if (LoggerClass === undefined) throw new Error("the driver was handed no logger class");
  return new LoggerClass();
}

describe("given the ClickHouse driver this process builds", () => {
  describe("when an insert times out and the retry wrapper will try again", () => {
    /** @scenario "The database driver logs through the process's own logger" */
    it("writes no error line of its own: the retry's warn and the final outcome carry the verdict", () => {
      const { lines, sink } = recordingSink();
      const driverLogger = driverLoggerFor({ logSink: sink });

      driverLogger.error({
        module: "Connection",
        message: "Insert: HTTP request error.",
        err: new Error("Timeout error."),
      });

      expect(lines).toEqual([]);
    });
  });

  describe("when it reports a warning", () => {
    /** @scenario "A driver record keeps the level the policy gives it" */
    it("goes through the logger the process composed, at warn", () => {
      const { lines, sink } = recordingSink();
      const driverLogger = driverLoggerFor({ logSink: sink });

      driverLogger.warn({ module: "Connection", message: "Failed to connect" });

      expect(lines).toEqual([["warn", "Failed to connect"]]);
    });
  });
});
