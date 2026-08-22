import { describe, expect, it } from "vitest";
import { parseCliJson } from "./cliJson.js";

describe("parseCliJson", () => {
  describe("given stdout that is exactly the JSON document", () => {
    it("parses the object", () => {
      expect(parseCliJson('{"traces":[],"pagination":{"totalHits":0}}')).toEqual(
        { traces: [], pagination: { totalHits: 0 } },
      );
    });

    it("parses a top-level array", () => {
      expect(parseCliJson('[{"id":"ds_1"},{"id":"ds_2"}]')).toEqual([
        { id: "ds_1" },
        { id: "ds_2" },
      ]);
    });
  });

  describe("given stdout with console noise around the JSON", () => {
    it("lifts the document out of the noise", () => {
      const stdout = [
        "⠋ Searching traces...",
        "✔ Found 2 traces (showing 2)",
        '{"traces":[{"trace_id":"trace_1"}],"pagination":{"totalHits":2}}',
        "Use langwatch trace get <traceId> to view full details",
      ].join("\n");

      expect(parseCliJson(stdout)).toEqual({
        traces: [{ trace_id: "trace_1" }],
        pagination: { totalHits: 2 },
      });
    });

    it("is not fooled by a brace inside a JSON string value", () => {
      const stdout =
        'note: starting\n{"traces":[{"input":"what is {this}?"}],"pagination":{"totalHits":1}}\ndone';

      expect(parseCliJson(stdout)).toEqual({
        traces: [{ input: "what is {this}?" }],
        pagination: { totalHits: 1 },
      });
    });

    it("skips a brace that opens no valid document", () => {
      expect(parseCliJson("hint: use {curly} braces\n{\"ok\":true}")).toEqual({
        ok: true,
      });
    });

    it("lifts an array out of the noise", () => {
      expect(parseCliJson('✔ Listed\n[{"id":"ds_1"}]\n')).toEqual([
        { id: "ds_1" },
      ]);
    });

    it("lifts a document a spinner frame left on the same line", () => {
      expect(parseCliJson('⠋ Searching traces...\r{"traces":[]}')).toEqual({
        traces: [],
      });
    });
  });

  describe("given stdout that is the command's own usage text", () => {
    /** @scenario A rejected command is never read as an empty result */
    it("returns null for help that documents a jq path", () => {
      const help = [
        "Usage: langwatch trace search [options]",
        "",
        "Options:",
        "  --limit <n>            Max results to return (default: 25)",
        "  --jq <expr>            Filter output with a path expression (e.g.",
        "                         .traces[].traceId)",
      ].join("\n");

      expect(parseCliJson(help)).toBeNull();
    });

    /** @scenario A rejected command is never read as an empty result */
    it("returns null for a rejected flag and the usage under it", () => {
      const rejected = [
        "error: unknown option '--start'",
        "",
        "Usage: langwatch trace search [options]",
        "  --jq <expr>  Filter output with a path expression (e.g.",
        "               .traces[].traceId)",
      ].join("\n");

      expect(parseCliJson(rejected)).toBeNull();
    });
  });

  describe("given stdout that holds no JSON", () => {
    it("returns null for a human table", () => {
      expect(
        parseCliJson("Trace ID   Input   Output\ntrace_1    hi      hello"),
      ).toBeNull();
    });

    it("returns null for an unterminated document", () => {
      expect(parseCliJson('{"traces": [')).toBeNull();
    });

    it("does not mistake a nested object inside a truncated result for the document", () => {
      const truncated =
        '{"traces":[{"trace_id":"trace_1","output":{"value":"unrelated nested answer"}},{"trace_id":"trace_2"';

      expect(parseCliJson(truncated)).toBeNull();
    });

    it("returns null for an empty output", () => {
      expect(parseCliJson("")).toBeNull();
    });
  });
});
