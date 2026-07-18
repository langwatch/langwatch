/**
 * A missing API key is the first failure every agent hits, so it must fail in
 * the shape the caller asked for: a `{ ok: false, error: { kind: … } }`
 * document on stdout under `--format json`, human guidance on stderr otherwise
 * — and a nonzero exit either way.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readCliErrorDocument } from "@langwatch/cli-cards/domain-error";

// A developer's local .env must not decide whether these tests see a key; the
// scoped loader's `parse` results are stubbed per test below.
vi.mock("dotenv", () => ({ config: vi.fn() }));

import { config } from "dotenv";
import { checkApiKey } from "../apiKey";
import { setOutputFormat } from "../errorOutput";

const mockedDotenvConfig = vi.mocked(config);

describe("checkApiKey()", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.LANGWATCH_API_KEY;
    delete process.env.LANGWATCH_API_KEY;
    mockedDotenvConfig.mockReset();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("process.exit called");
      }) as never);
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env.LANGWATCH_API_KEY;
    else process.env.LANGWATCH_API_KEY = savedKey;
    setOutputFormat(undefined);
    vi.restoreAllMocks();
  });

  describe("given no LANGWATCH_API_KEY in the environment", () => {
    describe("when the command runs with --format json", () => {
      it("prints a structured error document on stdout and exits nonzero", () => {
        setOutputFormat("json");

        expect(() => checkApiKey()).toThrow("process.exit called");

        const stdout = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        const domain = readCliErrorDocument(stdout);

        expect(domain).not.toBeNull();
        expect(domain?.kind).toBe("missing_api_key");
        expect(domain?.isDomain).toBe(true);
        expect(exitSpy).toHaveBeenCalledWith(1);
      });

      it("keeps stdout free of prose — the document is the whole stream", () => {
        setOutputFormat("json");

        expect(() => checkApiKey()).toThrow("process.exit called");

        const stdout = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(() => JSON.parse(stdout)).not.toThrow();
      });
    });

    describe("when the command runs with the default text output", () => {
      it("prints guidance on stderr, nothing on stdout, and exits nonzero", () => {
        setOutputFormat(undefined);

        expect(() => checkApiKey()).toThrow("process.exit called");

        expect(logSpy).not.toHaveBeenCalled();
        const stderr = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(stderr).toContain("LANGWATCH_API_KEY");
        expect(stderr).toContain("langwatch login");
        expect(exitSpy).toHaveBeenCalledWith(1);
      });
    });
  });

  describe("given a key that is only whitespace", () => {
    describe("when the command runs with --format json", () => {
      it("fails exactly like a missing key", () => {
        process.env.LANGWATCH_API_KEY = "   ";
        setOutputFormat("json");

        expect(() => checkApiKey()).toThrow("process.exit called");

        const stdout = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(readCliErrorDocument(stdout)?.kind).toBe("missing_api_key");
      });
    });
  });

  describe("given a real key in the environment", () => {
    describe("when the command runs", () => {
      it("returns without printing or exiting", () => {
        process.env.LANGWATCH_API_KEY = "test-key";

        expect(() => checkApiKey()).not.toThrow();
        expect(logSpy).not.toHaveBeenCalled();
        expect(exitSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a .env the caller's shell never exported", () => {
    describe("when it holds LANGWATCH_* keys", () => {
      it("applies them — the .env API key unlocks the command", () => {
        mockedDotenvConfig.mockReturnValue({
          parsed: { LANGWATCH_API_KEY: "sk-from-dotenv" },
        });

        expect(() => checkApiKey()).not.toThrow();
        expect(process.env.LANGWATCH_API_KEY).toBe("sk-from-dotenv");
      });

      it("never overwrites a variable the environment already has", () => {
        process.env.LANGWATCH_API_KEY = "sk-real";
        mockedDotenvConfig.mockReturnValue({
          parsed: { LANGWATCH_API_KEY: "sk-from-dotenv" },
        });

        checkApiKey();

        expect(process.env.LANGWATCH_API_KEY).toBe("sk-real");
      });
    });

    describe("when it holds unrelated secrets", () => {
      const SECRET = "LW_DOTENV_TEST_SECRET";

      afterEach(() => {
        delete process.env[SECRET];
      });

      it("does NOT stuff them into process.env (the daemon is long-lived and shared)", () => {
        mockedDotenvConfig.mockReturnValue({
          parsed: {
            LANGWATCH_API_KEY: "sk-from-dotenv",
            [SECRET]: "postgres://user:pass@host/db",
          },
        });

        checkApiKey();

        expect(process.env[SECRET]).toBeUndefined();
      });
    });
  });
});
