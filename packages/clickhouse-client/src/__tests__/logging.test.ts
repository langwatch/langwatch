import { describe, expect, it, vi } from "vitest";
import {
  decideVendorLog,
  emitVendorLog,
  VENDOR_CAUSE_FIELD,
  type VendorLogRecord,
  type VendorLogSink,
} from "../logging";

const record: VendorLogRecord = {
  module: "Connection",
  message: "Insert: HTTP request error.",
  args: { url: "http://ch:8123" },
  err: new Error("socket hang up"),
};

const makeSink = (): VendorLogSink & {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
} => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() });

describe("decideVendorLog", () => {
  describe("given the vendor reports an error", () => {
    describe("when decided", () => {
      it("drops the record", () => {
        expect(decideVendorLog({ level: "error", record })).toBeNull();
      });

      it("drops it even when no cause is attached", () => {
        expect(decideVendorLog({ level: "error", record: { message: "boom" } })).toBeNull();
      });
    });
  });

  describe("given the vendor reports a warning", () => {
    describe("when decided", () => {
      it("keeps it at warn", () => {
        expect(decideVendorLog({ level: "warn", record })?.level).toBe("warn");
      });

      it("attaches the cause away from the `error` field", () => {
        const decision = decideVendorLog({ level: "warn", record });

        // Loki derives detected_level from an `error` field, so a cause
        // parked there reads as an error whatever level was chosen.
        expect(decision?.fields).not.toHaveProperty("error");
        expect(decision?.fields[VENDOR_CAUSE_FIELD]).toBe(record.err);
      });

      it("keeps the vendor's own args and module", () => {
        const decision = decideVendorLog({ level: "warn", record });

        expect(decision?.fields.url).toBe("http://ch:8123");
        expect(decision?.fields.module).toBe("Connection");
      });

      it("carries the message through unchanged", () => {
        expect(decideVendorLog({ level: "warn", record })?.message).toBe(record.message);
      });

      it("omits the cause field when there is no cause", () => {
        const decision = decideVendorLog({
          level: "warn",
          record: { message: "no cause" },
        });

        expect(decision?.fields).not.toHaveProperty(VENDOR_CAUSE_FIELD);
      });
    });
  });

  describe("given the vendor reports below warning", () => {
    describe("when decided", () => {
      it("keeps info on its own level", () => {
        expect(decideVendorLog({ level: "info", record })?.level).toBe("info");
      });

      it("keeps debug on its own level", () => {
        expect(decideVendorLog({ level: "debug", record })?.level).toBe("debug");
      });

      it("folds trace into debug", () => {
        expect(decideVendorLog({ level: "trace", record })?.level).toBe("debug");
      });
    });
  });
});

describe("emitVendorLog", () => {
  describe("given the vendor reports an error", () => {
    describe("when emitted", () => {
      it("emits nothing at any level", () => {
        const sink = makeSink();

        const emitted = emitVendorLog({ sink, level: "error", record });

        expect(emitted).toBe(false);
        expect(sink.debug).not.toHaveBeenCalled();
        expect(sink.info).not.toHaveBeenCalled();
        expect(sink.warn).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the vendor reports a warning", () => {
    describe("when emitted", () => {
      it("emits once on the warn channel", () => {
        const sink = makeSink();

        const emitted = emitVendorLog({ sink, level: "warn", record });

        expect(emitted).toBe(true);
        expect(sink.warn).toHaveBeenCalledTimes(1);
      });

      it("passes the fields and message the policy decided", () => {
        const sink = makeSink();

        emitVendorLog({ sink, level: "warn", record });

        expect(sink.warn).toHaveBeenCalledWith(
          expect.objectContaining({ [VENDOR_CAUSE_FIELD]: record.err }),
          record.message,
        );
      });
    });
  });
});
