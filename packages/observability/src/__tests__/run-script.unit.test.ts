import { describe, expect, it } from "vitest";

import { processFailureLine, scriptFailureRecord } from "../run-script.ts";

describe("processFailureLine", () => {
  describe("given a long-running process whose boot throws", () => {
    const error = new TypeError('Feature API "project" must be implemented by an object.');

    describe("when it reports the failure", () => {
      const line = processFailureLine({ service: "langwatch-api", event: "fatal boot failure", error });
      const record = JSON.parse(line) as Record<string, unknown>;

      // @scenario "A process that cannot boot prints one fatal record with its stack"
      it("writes one structured line at level fatal naming the event and the error", () => {
        expect(line.endsWith("\n")).toBe(true);
        expect(line.slice(0, -1)).not.toContain("\n");
        expect(record.level).toBe("fatal");
        expect(record.service).toBe("langwatch-api");
        expect(record.msg).toBe(
          'fatal boot failure: Feature API "project" must be implemented by an object.',
        );
        expect(record.error).toMatchObject({ type: "TypeError", message: error.message });
      });

      it("carries the trace as one string in the record", () => {
        expect(typeof record.stack).toBe("string");
        expect(record.stack).toContain("\n    at ");
      });
    });
  });

  describe("given a failure that is not an Error", () => {
    it("names the event and the value, with no stack", () => {
      const record = JSON.parse(
        processFailureLine({ service: "langwatch-backend", event: "unhandled rejection", error: "boom" }),
      ) as Record<string, unknown>;
      expect(record.msg).toBe("unhandled rejection: boom");
      expect(record.error).toEqual({ type: "string", message: "boom" });
      expect(record).not.toHaveProperty("stack");
    });
  });

  describe("given an event with no error behind it", () => {
    it("is the event alone", () => {
      const record = JSON.parse(
        processFailureLine({ service: "langwatch-backend", event: "shutdown outlived its deadline; exiting" }),
      ) as Record<string, unknown>;
      expect(record.msg).toBe("shutdown outlived its deadline; exiting");
      expect(record).not.toHaveProperty("error");
    });
  });
});

describe("scriptFailureRecord", () => {
  it("keeps the one-shot shape: level error and the stack only when asked", () => {
    const record = scriptFailureRecord({ name: "seed", error: new Error("no"), withStack: false });
    expect(record.level).toBe("error");
    expect(record.error).not.toHaveProperty("stack");
  });
});
