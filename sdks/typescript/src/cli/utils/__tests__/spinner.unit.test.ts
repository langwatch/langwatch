/**
 * The spinner must never write when the command's output is a machine contract.
 *
 * Under `--format json` stdout carries exactly one JSON document, and callers
 * routinely merge stderr into stdout — so even the spinner's stderr "✔ Found N"
 * lines corrupt what a parser reads. `createSpinner` silences the spinner at
 * the source whenever the running command was invoked with JSON output.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createSpinner } from "../spinner";
import { setOutputFormat } from "../errorOutput";

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

      expect(createSpinner("Fetching agents...").text).toBe(
        "Fetching agents...",
      );
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

      expect(
        createSpinner({ text: "quiet", isSilent: true }).isSilent,
      ).toBe(true);
    });
  });
});
