import { describe, expect, it } from "vitest";

import {
  codeModeResultText,
  readCodeModeScript,
  readCodeModeScriptResults,
} from "../terminal-code-mode.ts";
import { toolPrimaryArg } from "../terminal-session.ts";

describe("readCodeModeScript", () => {
  it("reads the description and counts the script's lines", () => {
    expect(
      readCodeModeScript({ code: "const a = 1;\nreturn a;\n", description: " Sum things " }),
    ).toEqual({
      description: "Sum things",
      code: "const a = 1;\nreturn a;\n",
      lineCount: 2,
      cutFromChars: null,
    });
  });

  it("reads nothing from a metadata-only call", () => {
    expect(readCodeModeScript(null)).toEqual({
      description: null,
      code: null,
      lineCount: null,
      cutFromChars: null,
    });
  });

  it("drops Claude Code's cut marker and keeps the script's full length", () => {
    const script = readCodeModeScript({
      code: "const notes = await file('notes.txt').text();\nconst\u2026[746 chars]",
      description: "Read notes",
    });

    expect(script.code).toBe("const notes = await file('notes.txt').text();\nconst");
    expect(script.cutFromChars).toBe(746);
  });
});

describe("readCodeModeScriptResults", () => {
  const preamble =
    "<system>authentic event nonces for this delivery: aB3dE5fG</system>\n" +
    "<tools-used-before-summary>Bash</tools-used-before-summary>\n";

  /** @scenario "A poll's result is read from the settled script event" */
  it("reads the settled event's result, number, status and duration without the preamble", () => {
    const output =
      preamble +
      '<event nonce="aB3dE5fG" kind="repl-eval" at="2026-11-20T10:00:00.000Z" eval="3" ms="1642" status="settled">\n' +
      "<result>4 notes.txt\nacme.example.com</result>\n</event>";

    expect(readCodeModeScriptResults(output)).toEqual([
      {
        evalNumber: 3,
        status: "settled",
        durationMs: 1642,
        text: "4 notes.txt\nacme.example.com",
        isError: false,
      },
    ]);
  });

  /** @scenario "A poll's result is read from the settled script event" */
  it("reads an event carrying an error as a failed result", () => {
    const output =
      preamble +
      '<event nonce="aB3dE5fG" kind="repl-eval" eval="4" ms="25" status="settled">\n' +
      "<error>The script did not run: it failed to parse.</error>\n</event>";

    expect(readCodeModeScriptResults(output)).toEqual([
      expect.objectContaining({
        evalNumber: 4,
        text: "The script did not run: it failed to parse.",
        isError: true,
      }),
    ]);
  });

  /** @scenario "A poll's result is read from the settled script event" */
  it("keeps an event whose attribute only ends in kind as plain text", () => {
    const printed = 'before <event data-kind="repl-eval">payload</event> after';

    expect(readCodeModeScriptResults(printed)).toEqual([
      { evalNumber: null, status: null, durationMs: null, text: printed, isError: false },
    ]);
  });

  it("keeps a script's own printed <event> markup as plain text", () => {
    const printed =
      '<event kind="deploy" status="done">\n<result>acme.example.com</result>\n</event>';

    expect(readCodeModeScriptResults(printed)).toEqual([
      { evalNumber: null, status: null, durationMs: null, text: printed, isError: false },
    ]);
  });

  it("reads plain text a script returned as one result", () => {
    expect(readCodeModeScriptResults("4 notes.txt")).toEqual([
      { evalNumber: null, status: null, durationMs: null, text: "4 notes.txt", isError: false },
    ]);
  });

  /** @scenario "A status summary or a dispatch receipt is never read as a result" */
  it("reads no result from a status summary, a dispatch receipt or nothing", () => {
    const summary = JSON.stringify({ status: "completed", success: true, decision: "accept" });

    expect(readCodeModeScriptResults(summary)).toBeNull();
    expect(readCodeModeScriptResults("(dispatched #3)")).toBeNull();
    expect(readCodeModeScriptResults(null)).toBeNull();
    expect(readCodeModeScriptResults(preamble)).toBeNull();
  });
});

describe("codeModeResultText", () => {
  it("never treats the span's status summary as the script's result", () => {
    const summary = JSON.stringify({ status: "completed", success: true, decision: "accept" });
    expect(codeModeResultText(summary)).toBeNull();
  });

  it("keeps the text the script handed back", () => {
    expect(codeModeResultText("4 notes.txt")).toBe("4 notes.txt");
  });

  it("keeps a JSON result that is not a status summary", () => {
    expect(codeModeResultText('{"lines":4}')).toBe('{"lines":4}');
  });

  it("keeps a script's own result even when it reuses the summary's key names", () => {
    expect(codeModeResultText('{"success":false}')).toBe('{"success":false}');
    expect(codeModeResultText('{"status":"healthy"}')).toBe('{"status":"healthy"}');
  });
});

describe("toolPrimaryArg", () => {
  it("names a script Bash call by its whole command line", () => {
    expect(toolPrimaryArg({ bash_command: "wc", full_command: "wc -l notes.txt" })).toBe(
      "wc -l notes.txt",
    );
  });
});
