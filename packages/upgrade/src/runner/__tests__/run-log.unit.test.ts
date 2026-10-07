/**
 * @vitest-environment node
 * @see specs/upgrade/upgrade-logging.feature
 */
import { describe, expect, it } from "vitest";

import { redactSecrets, UPGRADE_NEXT_ACTION, UpgradeRunLog } from "../run-log.ts";
import { upgradeOutcome, upgradeOutcomeCodeSchema } from "../upgrade-outcome.ts";

type Line = { level: "info" | "warn"; message: string; fields: Record<string, unknown> };

function recorded() {
  const lines: Line[] = [];
  const log = new UpgradeRunLog({
    info: (message, fields = {}) => void lines.push({ level: "info", message, fields }),
    warn: (message, fields = {}) => void lines.push({ level: "warn", message, fields }),
  });
  return { log, lines };
}

describe("redactSecrets", () => {
  describe("when an error message carries a connection URL with a password and secret parameters", () => {
    /** @scenario "A connection URL in a log line is written without its password" */
    it("keeps the user, host and database and masks the password and the token", () => {
      const text = redactSecrets(
        "connect failed: postgresql://langwatch:s3cret@db:5432/langwatch?password=s3cret&token=abc",
      );
      expect(text).toContain("postgresql://langwatch:***@db:5432/langwatch");
      expect(text).not.toContain("s3cret");
      expect(text).not.toContain("abc");
    });
  });

  describe("when a URL has no password", () => {
    it("leaves it as it was", () => {
      expect(redactSecrets("http://127.0.0.1:58123/langwatch")).toBe(
        "http://127.0.0.1:58123/langwatch",
      );
    });
  });
});

describe("UPGRADE_NEXT_ACTION", () => {
  describe("when an upgrade ends with any outcome other than done", () => {
    /** @scenario "Every failed outcome names the command or setting that fixes it" */
    it("names a command or an environment variable for every failure code", () => {
      const failures = upgradeOutcomeCodeSchema.options.filter((code) => code !== "done");
      for (const code of failures) {
        expect(UPGRADE_NEXT_ACTION[code], code).toMatch(/pnpm task upgrade|\b[A-Z][A-Z0-9_]{3,}\b/);
      }
    });
  });
});

describe("UpgradeRunLog", () => {
  describe("when a phase starts and ends", () => {
    it("names the phase, what it waits on, the elapsed time and the next action on both lines", () => {
      const { log, lines } = recorded();
      const phase = { name: "postgres-schema", release: "3.21.0", startedAt: "t" } as const;
      log.phase({ phase: { ...phase, outcome: "running" } });
      log.phase({ phase: { ...phase, outcome: "succeeded", finishedAt: "t" } });
      expect(lines.map((line) => line.fields)).toEqual([
        expect.objectContaining({
          phase: "postgres-schema",
          waitingOn: expect.stringContaining("DATABASE_URL"),
          elapsedMs: expect.any(Number),
          next: expect.any(String),
        }),
        expect.objectContaining({
          phase: "postgres-schema",
          phaseElapsedMs: expect.any(Number),
          next: expect.any(String),
        }),
      ]);
    });
  });

  describe("when a field or a message carries a secret", () => {
    it("redacts both before they reach the logger", () => {
      const { log, lines } = recorded();
      log.warn("failed on clickhouse://default:pw-1@ch:8123/db", {
        error: { cause: "password=pw-1" },
      });
      expect(JSON.stringify(lines)).not.toContain("pw-1");
    });
  });

  describe("when a run finishes with a failure", () => {
    it("warns with the code and its next action", () => {
      const { log, lines } = recorded();
      log.finished({
        outcome: upgradeOutcome({ code: "step_failed", message: "blocking step x:y failed" }),
        fresh: false,
      });
      expect(lines).toEqual([
        expect.objectContaining({
          level: "warn",
          fields: expect.objectContaining({
            code: "step_failed",
            next: UPGRADE_NEXT_ACTION.step_failed,
          }),
        }),
      ]);
    });
  });
});
