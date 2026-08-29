/**
 * The `--target` reader.
 *
 * A target is what to run against plus the parameter values that target alone
 * runs with, written as a query string after the reference id. What these
 * assertions pin is the grammar: where the reference id ends, how a value is
 * decoded and typed, and which spellings are refused before anything is
 * scheduled.
 *
 * Spec: specs/features/run-plan-cli.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseTargets } from "../scopeFlags";

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

const noop = () => {
  // intentionally empty, suppresses output during tests
};

/** Everything the reader wrote on stderr while refusing. */
const reported = (): string =>
  vi.mocked(console.error).mock.calls.flat().join("\n");

describe("parseTargets()", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(noop);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ProcessExitError(code as number);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when a target names no parameters", () => {
    it("reads the type and the reference id and carries no overrides", () => {
      expect(parseTargets(["http:agent_abc"])).toEqual([
        { type: "http", referenceId: "agent_abc" },
      ]);
    });

    it("keeps a colon inside the reference id", () => {
      expect(parseTargets(["prompt:prompt:xyz"])).toEqual([
        { type: "prompt", referenceId: "prompt:xyz" },
      ]);
    });

    /** @scenario "A reference id that holds a question mark is percent-decoded" */
    it("percent-decodes the reference id", () => {
      expect(parseTargets(["http:agent%3Fabc"])).toEqual([
        { type: "http", referenceId: "agent?abc" },
      ]);
    });
  });

  describe("when a target carries a query string", () => {
    /** @scenario "A target carries its own parameters after a question mark" */
    it("splits the reference id from the parameters at the question mark", () => {
      expect(parseTargets(["http:agent_abc?model=gpt-5"])).toEqual([
        {
          type: "http",
          referenceId: "agent_abc",
          runParameters: { model: "gpt-5" },
        },
      ]);
    });

    /** @scenario "A target carries its own parameters after a question mark" */
    it("gives the same agent named twice its own values each time", () => {
      expect(
        parseTargets([
          "http:agent_abc?model=gpt-5",
          "http:agent_abc?model=gpt-5-mini",
        ]),
      ).toEqual([
        {
          type: "http",
          referenceId: "agent_abc",
          runParameters: { model: "gpt-5" },
        },
        {
          type: "http",
          referenceId: "agent_abc",
          runParameters: { model: "gpt-5-mini" },
        },
      ]);
    });

    it("reads every pair the ampersands separate", () => {
      expect(
        parseTargets(["http:agent_abc?model=gpt-5&region=eu&seats=12"]),
      ).toEqual([
        {
          type: "http",
          referenceId: "agent_abc",
          runParameters: { model: "gpt-5", region: "eu", seats: 12 },
        },
      ]);
    });

    /** @scenario "A target carries its own parameters after a question mark" */
    it("reads a value as the type it looks like, the rule --param uses", () => {
      expect(
        parseTargets(["http:agent_abc?seats=12&beta=true&account=007"]),
      ).toEqual([
        {
          type: "http",
          referenceId: "agent_abc",
          runParameters: { seats: 12, beta: true, account: "007" },
        },
      ]);
    });

    /** @scenario "A reference id that holds a question mark is percent-decoded" */
    it("percent-decodes the reference id beside the parameters", () => {
      expect(parseTargets(["http:agent%3Fabc?model=gpt-5"])).toEqual([
        {
          type: "http",
          referenceId: "agent?abc",
          runParameters: { model: "gpt-5" },
        },
      ]);
    });

    /** @scenario "A target carries its own parameters after a question mark" */
    it("percent-decodes both halves", () => {
      expect(
        parseTargets(["http:agent_abc?system%20prompt=be%20brief%20%26%20kind"]),
      ).toEqual([
        {
          type: "http",
          referenceId: "agent_abc",
          runParameters: { "system prompt": "be brief & kind" },
        },
      ]);
    });

    it("keeps the last value when one name is repeated", () => {
      expect(parseTargets(["http:agent_abc?model=gpt-5&model=gpt-5-mini"])).toEqual(
        [
          {
            type: "http",
            referenceId: "agent_abc",
            runParameters: { model: "gpt-5-mini" },
          },
        ],
      );
    });

    it("keeps an equals sign inside a value", () => {
      expect(parseTargets(["http:agent_abc?filter=a=b"])).toEqual([
        {
          type: "http",
          referenceId: "agent_abc",
          runParameters: { filter: "a=b" },
        },
      ]);
    });

    it("puts the values on their own target and leaves the others alone", () => {
      expect(
        parseTargets(["http:agent_abc?model=gpt-5", "prompt:prompt_xyz"]),
      ).toEqual([
        {
          type: "http",
          referenceId: "agent_abc",
          runParameters: { model: "gpt-5" },
        },
        { type: "prompt", referenceId: "prompt_xyz" },
      ]);
    });
  });

  describe("when the query string cannot be read", () => {
    /** @scenario "Run with a target whose question mark carries nothing" */
    it("refuses a question mark carrying nothing", () => {
      expect(() => parseTargets(["http:agent_abc?"])).toThrow(ProcessExitError);
      expect(reported()).toContain("carries no parameters");
    });

    /** @scenario "Run with a target parameter that is not a pair" */
    it("refuses a parameter that is not a pair", () => {
      expect(() => parseTargets(["http:agent_abc?model"])).toThrow(
        ProcessExitError,
      );
      expect(reported()).toContain("key=value");
    });

    /** @scenario "Run with a target parameter that is not a pair" */
    it("refuses a pair with no name", () => {
      expect(() => parseTargets(["http:agent_abc?=gpt-5"])).toThrow(
        ProcessExitError,
      );
      expect(reported()).toContain("key=value");
    });

    /** @scenario "Run with a target holding a second question mark" */
    it("refuses a second question mark and names the encoding", () => {
      expect(() => parseTargets(["http:agent_abc?ask=what?"])).toThrow(
        ProcessExitError,
      );
      expect(reported()).toContain("%3F");
    });

    it("refuses a half that is not valid percent-encoding", () => {
      expect(() => parseTargets(["http:agent_abc?model=%zz"])).toThrow(
        ProcessExitError,
      );
      expect(reported()).toContain("percent-encoded");
    });
  });

  describe("when the target itself is malformed", () => {
    /** @scenario "Run with a malformed target" */
    it("refuses a value with no type", () => {
      expect(() => parseTargets(["agent_abc"])).toThrow(ProcessExitError);
      expect(reported()).toContain("<type>:<referenceId>");
    });

    it("refuses a type the platform does not run", () => {
      expect(() => parseTargets(["agent:agent_abc?model=gpt-5"])).toThrow(
        ProcessExitError,
      );
      expect(reported()).toContain("prompt, http, code, workflow");
    });

    /** @scenario "Run with no target" */
    it("refuses an empty list, because a run has nothing to go against", () => {
      expect(() => parseTargets([])).toThrow(ProcessExitError);
      expect(reported()).toContain("--target is required");
    });
  });
});
