import { afterEach, describe, expect, it, vi } from "vitest";
import { runScript, scriptFailureRecord } from "../run-script.ts";

/** Everything the runner wrote to stdout, as parsed records. */
function captureStdout(): { records: () => unknown[]; restore: () => void } {
  const written: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      written.push(String(chunk));
      return true;
    });

  return {
    records: () =>
      written
        .join("")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as unknown),
    restore: () => spy.mockRestore(),
  };
}

describe("given a one-shot script run through the shared runner", () => {
  afterEach(() => {
    process.exitCode = void 0;
    vi.unstubAllEnvs();
  });

  describe("when it succeeds", () => {
    /** @scenario "A one-shot lane that fails prints one structured line, not a stack" */
    it("prints nothing and leaves the exit code alone", async () => {
      const stdout = captureStdout();
      await runScript({ name: "seed", main: () => Promise.resolve() });
      const records = stdout.records();
      stdout.restore();

      expect(records).toEqual([]);
      expect(process.exitCode).toBeUndefined();
    });
  });

  describe("when it throws", () => {
    /** @scenario "A one-shot lane that fails prints one structured line, not a stack" */
    it("writes one structured error line and exits 1", async () => {
      const stdout = captureStdout();
      await runScript({
        name: "seed",
        main: () => {
          throw new Error("CREDENTIALS_SECRET is required");
        },
      });
      const records = stdout.records();
      stdout.restore();

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        level: "error",
        service: "seed",
        msg: "seed failed",
        error: { type: "Error", message: "CREDENTIALS_SECRET is required" },
      });
      expect(process.exitCode).toBe(1);
    });

    /** @scenario "A one-shot lane that fails prints one structured line, not a stack" */
    it("leaves the stack off unless the process asked for debug", async () => {
      const stdout = captureStdout();
      await runScript({
        name: "prepare",
        main: () => {
          throw new Error("boom");
        },
      });
      const [record] = stdout.records() as [{ error: Record<string, unknown> }];
      stdout.restore();

      expect(record.error).not.toHaveProperty("stack");
    });
  });
});

describe("given an error carrying a Node error code", () => {
  /** @scenario "A one-shot lane that fails prints one structured line, not a stack" */
  it("names the code on the record", () => {
    const error = Object.assign(new Error("Cannot find package '@langwatch/nope'"), {
      code: "ERR_MODULE_NOT_FOUND",
    });

    expect(scriptFailureRecord({ name: "prepare", error, withStack: false }).error).toEqual({
      type: "Error",
      message: "Cannot find package '@langwatch/nope'",
      code: "ERR_MODULE_NOT_FOUND",
    });
  });

  /** @scenario "A one-shot lane that fails prints one structured line, not a stack" */
  it("carries the stack only when it was asked for", () => {
    const record = scriptFailureRecord({
      name: "prepare",
      error: new Error("boom"),
      withStack: true,
    });

    expect(typeof record.error.stack).toBe("string");
  });
});

describe("given something thrown that is not an Error", () => {
  /** @scenario "A one-shot lane that fails prints one structured line, not a stack" */
  it("still writes a readable record", () => {
    const record = scriptFailureRecord({ name: "codegen", error: "exploded", withStack: false });

    expect(record.error).toEqual({ type: "string", message: "exploded" });
  });
});
