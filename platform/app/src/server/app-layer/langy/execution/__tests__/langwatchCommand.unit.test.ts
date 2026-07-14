import { describe, expect, it } from "vitest";
import { parseLangwatchCommand } from "../langwatchCommand";

describe("parseLangwatchCommand", () => {
  describe("given a plain CLI invocation", () => {
    it("reads the resource and the verb", () => {
      expect(
        parseLangwatchCommand("langwatch trace search --format json"),
      ).toMatchObject({ resource: "trace", verb: "search" });
    });

    it("reads a verb that carries an argument", () => {
      expect(parseLangwatchCommand("langwatch trace get abc123")).toMatchObject({
        resource: "trace",
        verb: "get",
      });
    });

    it("reads a kebab-case verb", () => {
      expect(
        parseLangwatchCommand("langwatch experiment list-runs my-experiment"),
      ).toMatchObject({ resource: "experiment", verb: "list-runs" });
    });

    it("reads a kebab-case resource", () => {
      expect(parseLangwatchCommand("langwatch simulation-run list")).toMatchObject({
        resource: "simulation-run",
        verb: "list",
      });
    });

    it("reads a sub-command group as the verb", () => {
      expect(
        parseLangwatchCommand("langwatch dataset records list --format json"),
      ).toMatchObject({ resource: "dataset", verb: "records" });
    });
  });

  describe("given the invocation is wrapped in other shell", () => {
    it("finds it after a directory change", () => {
      expect(
        parseLangwatchCommand("cd /tmp/work && langwatch dataset list -f json"),
      ).toMatchObject({ resource: "dataset", verb: "list" });
    });

    it("finds it before a pipe", () => {
      expect(
        parseLangwatchCommand(
          "langwatch trace search --format json | jq '.traces[0]'",
        ),
      ).toMatchObject({ resource: "trace", verb: "search" });
    });

    it("finds it behind env-var prefixes", () => {
      expect(
        parseLangwatchCommand(
          "LANGWATCH_API_KEY=sk-123 NODE_ENV=production langwatch monitor list",
        ),
      ).toMatchObject({ resource: "monitor", verb: "list" });
    });

    it("finds it behind a runner", () => {
      expect(parseLangwatchCommand("npx langwatch prompt list")).toMatchObject({
        resource: "prompt",
        verb: "list",
      });
    });

    it("finds it when invoked by path", () => {
      expect(
        parseLangwatchCommand("/opt/homebrew/bin/langwatch analytics query"),
      ).toMatchObject({ resource: "analytics", verb: "query" });
    });

    it("finds it across multiple lines and continuations", () => {
      expect(
        parseLangwatchCommand(
          'set -euo pipefail\nlangwatch trace search -q "refund policy" \\\n  --format json\n',
        ),
      ).toMatchObject({ resource: "trace", verb: "search" });
    });

    it("does not read a quoted argument as the resource", () => {
      expect(parseLangwatchCommand('langwatch "scenario" run scn_123')).toMatchObject({
        resource: "scenario",
        verb: "run",
      });
    });

    it("matches the first invocation when several are chained", () => {
      expect(
        parseLangwatchCommand(
          "langwatch trace search --format json && langwatch dataset list",
        ),
      ).toMatchObject({ resource: "trace", verb: "search" });
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

  describe("given an invocation carrying flags and positionals", () => {
    it("parses long flags, short flags and positionals into args", () => {
      expect(
        parseLangwatchCommand(
          'langwatch trace search -q "refund policy" --start-date 1720000000000 --limit 5 --format json',
        )?.args,
      ).toEqual({
        q: "refund policy",
        "start-date": "1720000000000",
        limit: "5",
        format: "json",
      });
    });

    it("parses --flag=value and keeps the positional under _", () => {
      expect(
        parseLangwatchCommand("langwatch dataset get golden-set --format=json")
          ?.args,
      ).toEqual({ _: ["golden-set"], format: "json" });
    });

    it("reads a bare flag as true and collects a repeated flag into an array", () => {
      expect(
        parseLangwatchCommand(
          "langwatch experiment run my-exp --wait --label a --label b",
        )?.args,
      ).toEqual({ _: ["my-exp"], wait: true, label: ["a", "b"] });
    });

    it("stops at a shell separator so the next command's flags stay out", () => {
      expect(
        parseLangwatchCommand(
          "langwatch trace search --limit 3 | jq '.traces[0]'",
        )?.args,
      ).toEqual({ limit: "3" });
    });

    it("parses no args as an empty record", () => {
      expect(parseLangwatchCommand("langwatch monitor list")?.args).toEqual({});
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
