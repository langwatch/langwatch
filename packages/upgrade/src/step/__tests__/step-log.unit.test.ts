/**
 * An attempt's log keeps only its last lines, each redacted and bounded.
 * Spec: specs/upgrade/step-diagnostics.feature
 */
import { describe, expect, it } from "vitest";

import { STEP_LOG_TAIL_LINES, StepLogTail, ledgerRedactor } from "../step-log.ts";

describe("StepLogTail", () => {
  describe("when an attempt logs 500 lines", () => {
    /** @scenario "A step's log tail keeps only the last lines of an attempt" */
    it("keeps the last 200, oldest first", () => {
      const log = StepLogTail.create({
        redact: ledgerRedactor({ secretValues: [] }),
        forward: () => undefined,
        now: () => "2026-10-20T00:00:00.000Z",
      });

      for (let line = 1; line <= 500; line += 1) log.info(`line ${line}`);

      const tail = log.tail();
      expect(tail).toHaveLength(STEP_LOG_TAIL_LINES);
      expect(tail[0]).toBe("2026-10-20T00:00:00.000Z info line 301");
      expect(tail.at(-1)).toBe("2026-10-20T00:00:00.000Z info line 500");
    });
  });

  describe("when a line names a secret in its message and in every kind of field", () => {
    /** @scenario "A step's log line is redacted before it reaches the worker's own log" */
    it("forwards the message and each field masked", () => {
      const forwarded: { message: string; fields: Record<string, unknown> }[] = [];
      const log = StepLogTail.create({
        redact: ledgerRedactor({ secretValues: ["opensesame-held"] }),
        forward: (_level, message, fields) => void forwarded.push({ message, fields }),
      });

      log.warn("connecting with password=opensesame", {
        note: "password=opensesame",
        hosts: ["db opensesame-held", 3],
        nested: { inner: { dsn: "postgres://app:opensesame@db:5432/app" } },
        cause: new Error("refused opensesame-held"),
        attempts: 2,
      });

      expect(forwarded).toHaveLength(1);
      expect(JSON.stringify(forwarded)).not.toContain("opensesame");
      expect(forwarded[0]?.fields).toMatchObject({
        hosts: ["db ***", 3],
        cause: "refused ***",
        attempts: 2,
      });
    });
  });

  describe("when a line was already logged by the caller", () => {
    it("keeps it without forwarding it again", () => {
      const forwarded: string[] = [];
      const log = StepLogTail.create({
        redact: ledgerRedactor({ secretValues: [] }),
        forward: (_level, message) => void forwarded.push(message),
      });

      log.keepOnly({ level: "warn", message: "blocking step failed" });

      expect(forwarded).toEqual([]);
      expect(log.tail()[0]).toContain("warn blocking step failed");
    });
  });
});
