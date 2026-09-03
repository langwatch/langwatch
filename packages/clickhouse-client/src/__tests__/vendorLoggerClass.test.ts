/**
 * The class the driver is handed, and what reaches the process's logger
 * through it.
 *
 * The policy that decides what a vendor record means was already written and
 * already tested; what was missing was anything passing a class to the driver,
 * so `@clickhouse/client` went on writing its own bracketed console lines.
 *
 * Corresponds to specs/setup/dev-stack-log-format.feature.
 */

import { describe, expect, it } from "vitest";

import { VENDOR_CAUSE_FIELD, vendorLoggerClassFor, type VendorLogSink } from "../logging";

function recordingSink(): VendorLogSink & { lines: Array<[string, string]> } {
  const lines: Array<[string, string]> = [];
  return {
    lines,
    debug: (_fields, message) => lines.push(["debug", message]),
    info: (_fields, message) => lines.push(["info", message]),
    warn: (_fields, message) => lines.push(["warn", message]),
  };
}

describe("given the ClickHouse driver reporting a connection problem", () => {
  describe("when it writes it", () => {
    /** @scenario "The database driver logs through the process's own logger" */
    it("goes through the logger the process composed", () => {
      const sink = recordingSink();
      const driverLogger = new (vendorLoggerClassFor(sink))();

      driverLogger.warn({
        module: "Connection",
        message: "Failed to connect",
        err: new Error("ECONNREFUSED"),
      });

      expect(sink.lines).toEqual([["warn", "Failed to connect"]]);
    });

    /** @scenario "The database driver logs through the process's own logger" */
    it("carries the driver's module and its cause under the field that does not promote a level", () => {
      const fields: Array<Record<string, unknown>> = [];
      const driverLogger = new (vendorLoggerClassFor({
        debug: () => {},
        info: () => {},
        warn: (recorded) => fields.push(recorded),
      }))();

      const cause = new Error("ECONNREFUSED");
      driverLogger.warn({ module: "Connection", message: "Failed to connect", err: cause });

      expect(fields).toEqual([{ module: "Connection", [VENDOR_CAUSE_FIELD]: cause }]);
    });
  });
});

describe("given the ClickHouse driver reporting at each of its levels", () => {
  describe("when each is written", () => {
    /** @scenario "A driver record keeps the level the policy gives it" */
    it("keeps informational and warning records, and drops the driver's own error", () => {
      const sink = recordingSink();
      const driverLogger = new (vendorLoggerClassFor(sink))();

      driverLogger.trace({ message: "trace" });
      driverLogger.debug({ message: "debug" });
      driverLogger.info({ message: "info" });
      driverLogger.warn({ message: "warn" });
      driverLogger.error({ message: "error", err: new Error("boom") });

      expect(sink.lines).toEqual([
        // A trace is the driver's most detailed level and has no counterpart
        // here, so it arrives as a debug.
        ["debug", "trace"],
        ["debug", "debug"],
        ["info", "info"],
        ["warn", "warn"],
      ]);
    });
  });
});
