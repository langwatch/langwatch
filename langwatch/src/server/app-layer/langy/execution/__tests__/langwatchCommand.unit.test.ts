import { describe, expect, it } from "vitest";
import { parseLangwatchCommand } from "../langwatchCommand";

describe("parseLangwatchCommand", () => {
  describe("given a plain CLI invocation", () => {
    it("reads the resource and the verb", () => {
      expect(
        parseLangwatchCommand("langwatch trace search --format json"),
      ).toEqual({ resource: "trace", verb: "search" });
    });

    it("reads a verb that carries an argument", () => {
      expect(parseLangwatchCommand("langwatch trace get abc123")).toEqual({
        resource: "trace",
        verb: "get",
      });
    });

    it("reads a kebab-case verb", () => {
      expect(
        parseLangwatchCommand("langwatch experiment list-runs my-experiment"),
      ).toEqual({ resource: "experiment", verb: "list-runs" });
    });

    it("reads a kebab-case resource", () => {
      expect(parseLangwatchCommand("langwatch simulation-run list")).toEqual({
        resource: "simulation-run",
        verb: "list",
      });
    });

    it("reads a sub-command group as the verb", () => {
      expect(
        parseLangwatchCommand("langwatch dataset records list --format json"),
      ).toEqual({ resource: "dataset", verb: "records" });
    });
  });

  describe("given the invocation is wrapped in other shell", () => {
    it("finds it after a directory change", () => {
      expect(
        parseLangwatchCommand("cd /tmp/work && langwatch dataset list -f json"),
      ).toEqual({ resource: "dataset", verb: "list" });
    });

    it("finds it before a pipe", () => {
      expect(
        parseLangwatchCommand(
          "langwatch trace search --format json | jq '.traces[0]'",
        ),
      ).toEqual({ resource: "trace", verb: "search" });
    });

    it("finds it behind env-var prefixes", () => {
      expect(
        parseLangwatchCommand(
          "LANGWATCH_API_KEY=sk-123 NODE_ENV=production langwatch monitor list",
        ),
      ).toEqual({ resource: "monitor", verb: "list" });
    });

    it("finds it behind a runner", () => {
      expect(parseLangwatchCommand("npx langwatch prompt list")).toEqual({
        resource: "prompt",
        verb: "list",
      });
    });

    it("finds it when invoked by path", () => {
      expect(
        parseLangwatchCommand("/opt/homebrew/bin/langwatch analytics query"),
      ).toEqual({ resource: "analytics", verb: "query" });
    });

    it("finds it across multiple lines and continuations", () => {
      expect(
        parseLangwatchCommand(
          'set -euo pipefail\nlangwatch trace search -q "refund policy" \\\n  --format json\n',
        ),
      ).toEqual({ resource: "trace", verb: "search" });
    });

    it("does not read a quoted argument as the resource", () => {
      expect(parseLangwatchCommand('langwatch "scenario" run scn_123')).toEqual({
        resource: "scenario",
        verb: "run",
      });
    });

    it("matches the first invocation when several are chained", () => {
      expect(
        parseLangwatchCommand(
          "langwatch trace search --format json && langwatch dataset list",
        ),
      ).toEqual({ resource: "trace", verb: "search" });
    });
  });

  describe("given the command does not run the LangWatch CLI", () => {
    it("returns null for an unrelated shell command", () => {
      expect(parseLangwatchCommand("ls -la /tmp && cat notes.md")).toBeNull();
    });

    it("returns null when langwatch is only an argument to another program", () => {
      expect(
        parseLangwatchCommand("echo langwatch trace search > note.txt"),
      ).toBeNull();
    });

    it("returns null when langwatch is a grep pattern", () => {
      expect(parseLangwatchCommand("grep langwatch trace search")).toBeNull();
    });

    it("returns null for an empty command", () => {
      expect(parseLangwatchCommand("   ")).toBeNull();
    });
  });

  describe("given a CLI call that names no resource and verb", () => {
    it("returns null for a bare meta command", () => {
      expect(parseLangwatchCommand("langwatch status")).toBeNull();
    });

    it("returns null for a global flag", () => {
      expect(parseLangwatchCommand("langwatch --version")).toBeNull();
    });

    it("returns null when the second word is a path, not a verb", () => {
      expect(
        parseLangwatchCommand("langwatch docs integration/python/guide"),
      ).toBeNull();
    });

    it("returns null when the verb position holds a flag", () => {
      expect(parseLangwatchCommand("langwatch trace --help")).toBeNull();
    });
  });
});
