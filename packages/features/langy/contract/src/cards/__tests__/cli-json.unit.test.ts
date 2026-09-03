import { describe, expect, it } from "vitest";
import { parseCliJson } from "../cli-json.js";

describe("parseCliJson", () => {
  describe("given stdout that is exactly the JSON document", () => {
    it("parses the object", () => {
      expect(parseCliJson('{"traces":[],"pagination":{"totalHits":0}}')).toEqual({
        traces: [],
        pagination: { totalHits: 0 },
      });
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
      expect(parseCliJson('hint: use {curly} braces\n{"ok":true}')).toEqual({
        ok: true,
      });
    });

    it("lifts an array out of the noise", () => {
      expect(parseCliJson('✔ Listed\n[{"id":"ds_1"}]\n')).toEqual([{ id: "ds_1" }]);
    });

    it("lifts the document under a log line that opens a bracket it never closes", () => {
      const output = '[retrying request\n{"total": 2}\n';

      expect(parseCliJson(output)).toEqual({ total: 2 });
    });

    it("lifts the document under a log line that starts like a JSON literal", () => {
      const lines = [
        "[notice] using the cache",
        "[failed to reach the api",
        "[trying again",
      ];

      for (const line of lines) {
        expect(parseCliJson(`${line}\n{"total": 2}\n`)).toEqual({ total: 2 });
      }
    });

    it("lifts the document under a log line whose first word IS a JSON value", () => {
      const lines = [
        "[true retrying the request",
        "[null pointer while reading the cache",
        "[false start, reconnecting",
        "[2026-08-22 fetching traces",
      ];

      for (const line of lines) {
        expect(parseCliJson(`${line}\n{"total": 2}\n`)).toEqual({ total: 2 });
      }
    });

    it("lifts the document under a log line that pads its first word", () => {
      // The check used to read a fixed window, so the end anchor matched the
      // end of the WINDOW. A scalar padded that far from the prose after it
      // then read as a result cut short, and the document below it was lost.
      for (const padding of [1, 35, 36, 37, 200]) {
        const line = `[true${" ".repeat(padding)}retrying`;

        expect(parseCliJson(`${line}\n{"total": 2}\n`)).toEqual({ total: 2 });
      }
    });

    it("lifts the document under a log line numbered with a leading zero", () => {
      for (const line of ["[01,", "[-01,", "[007 retrying"]) {
        expect(parseCliJson(`${line}\n{"total": 2}\n`)).toEqual({ total: 2 });
      }
    });

    it("still reads an array of literals as the document", () => {
      expect(parseCliJson("✔ Done\n[true, false, null]\n")).toEqual([true, false, null]);
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

    it("still stops on a truncated array of scalars", () => {
      // `true` here is followed by a comma, which is what a document puts
      // after it, so the array is cut short rather than a sentence.
      expect(parseCliJson("reading…\n[true, false")).toBeNull();
    });

    it("still stops on a truncated array of numbers", () => {
      // These ARE numbers the way JSON writes them, so each array is a result
      // cut short rather than a sentence.
      expect(parseCliJson("reading…\n[0, 1")).toBeNull();
      expect(parseCliJson("reading…\n[0.5, 1")).toBeNull();
      expect(parseCliJson("reading…\n[-2e10, 1")).toBeNull();
    });

    it("still stops on a result cut off at its first scalar", () => {
      // Nothing follows the scalar because the output ends there. This is what
      // the end anchor is for, so it has to keep working from the real end.
      expect(parseCliJson("reading…\n[true")).toBeNull();
      expect(parseCliJson("reading…\n[true\n")).toBeNull();
    });

    it("still stops on a truncated array of results, log line or not", () => {
      const truncated =
        'reading…\n[{"trace_id":"trace_1","output":{"value":"unrelated nested answer"}},{"trace_id":"trace_2"';

      expect(parseCliJson(truncated)).toBeNull();
    });

    it("does not promote a nested value out of a TAIL-truncated result", () => {
      // pi's bash tool keeps the LAST lines of a big output, so the fragment
      // opens mid-document; its first balanced bracket is a nested
      // `"stacktrace": []`, which must not become the whole command's result.
      const tail = [
        '            "message": "Evaluator cannot be reached",',
        '            "stacktrace": []',
        "          },",
        '          "trace_id": "trace_44"',
        "        }",
        "      ],",
        '      "pagination": { "totalHits": 44 }',
        "    }",
      ].join("\n");

      expect(parseCliJson(tail)).toBeNull();
    });

    it("does not promote a complete pretty-printed array item out of a tail fragment", () => {
      // Pretty-printed items open their own line behind indentation; a tail
      // cut can leave one fully balanced. It is still not the document.
      const tail = [
        '          "value"',
        "        },",
        "        {",
        '          "trace_id": "trace_43",',
        '          "error": null',
        "        }",
        "      ],",
        '      "pagination": { "totalHits": 44 }',
        "    }",
      ].join("\n");

      expect(parseCliJson(tail)).toBeNull();
    });

    it("returns null for an empty output", () => {
      expect(parseCliJson("")).toBeNull();
    });

    // The scan decides "result cut short" from the first scalar after the
    // bracket, so its idea of a scalar has to be JSON's. Rather than restate
    // the grammar here, ask the parser that owns it.
    it("agrees with JSON.parse about what counts as a scalar", () => {
      const scalars = [
        "0",
        "-0",
        "1",
        "42",
        "-42",
        "0.5",
        "-0.5",
        "1e3",
        "1E3",
        "1e+3",
        "1e-3",
        "-2e10",
        "0.0",
        "123456789012345678901234567890",
        "01",
        "-01",
        "007",
        "00",
        "1.",
        ".5",
        "-",
        "+1",
        "1e",
        "1e+",
        "0x1f",
        "1_000",
        "Infinity",
        "NaN",
        "true",
        "false",
        "null",
        "tru",
        "nul",
      ];

      for (const scalar of scalars) {
        let isRealJson: boolean;
        try {
          JSON.parse(`[${scalar},1]`);
          isRealJson = true;
        } catch {
          isRealJson = false;
        }

        // A real scalar makes the bracket a result cut short, which stops the
        // scan. Anything else is prose, and the document below it is read.
        expect({
          scalar,
          cutShort: parseCliJson(`[${scalar},\n{"total": 2}\n`) === null,
        }).toEqual({ scalar, cutShort: isRealJson });
      }
    });
  });
});
