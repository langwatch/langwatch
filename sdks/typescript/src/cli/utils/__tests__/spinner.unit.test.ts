/**
 * The spinner must never write when output is a machine contract. Under
 * `--format json` callers merge stderr into stdout, so even a stderr spinner
 * line corrupts the parse. `createSpinner` silences itself for JSON output.
 */
import { describe, it, expect, afterEach } from "vitest";

import { setOutputFormat } from "../errorOutput";
import { createSpinner } from "../spinner";

afterEach(() => {
  setOutputFormat(undefined);
});

describe("given a command running with the default text output", () => {
  describe("when a spinner is created", () => {
    it("is audible", () => {
      setOutputFormat(undefined);

      expect(createSpinner("Fetching agents...").isSilent).toBe(false);
    });

    it("keeps the text it was given", () => {
      setOutputFormat("table");

      expect(createSpinner("Fetching agents...").text).toBe("Fetching agents...");
    });
  });
});

describe("given a command running with --format json", () => {
  describe("when a spinner is created", () => {
    it("is completely silent", () => {
      setOutputFormat("json");

      expect(createSpinner("Fetching agents...").isSilent).toBe(true);
    });

    it("is silent when created from an options object too", () => {
      setOutputFormat("json");

      expect(createSpinner({ text: "Pushing prompts..." }).isSilent).toBe(true);
    });
  });
});

describe("given a caller that asked for silence explicitly", () => {
  describe("when the command output is text", () => {
    it("stays silent", () => {
      setOutputFormat(undefined);

      expect(createSpinner({ text: "quiet", isSilent: true }).isSilent).toBe(true);
    });
  });
});
