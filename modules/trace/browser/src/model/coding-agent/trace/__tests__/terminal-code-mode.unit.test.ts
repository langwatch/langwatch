import { describe, expect, it } from "vitest";

import { codeModeResultText, readCodeModeScript } from "../terminal-code-mode.ts";
import { toolPrimaryArg } from "../terminal-session.ts";

describe("readCodeModeScript", () => {
  it("reads the description and counts the script's lines", () => {
    expect(
      readCodeModeScript({ code: "const a = 1;\nreturn a;\n", description: " Sum things " }),
    ).toEqual({ description: "Sum things", code: "const a = 1;\nreturn a;\n", lineCount: 2 });
  });

  it("reads nothing from a metadata-only call", () => {
    expect(readCodeModeScript(null)).toEqual({ description: null, code: null, lineCount: null });
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
