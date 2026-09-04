/**
 * What the terminal shows while a folder is shared.
 *
 * @see specs/typescript-sdk/cli-langy-share-control.feature
 */

import { describe, expect, it } from "vitest";
import type {
  BashOutput,
  LocalCall,
} from "../../../../agent/local-control-protocol";
import {
  answerLine,
  callLine,
  conversationLink,
  createUi,
  shortReason,
  shorten,
  terminalWidth,
  wrapWords,
} from "../ui";

/** The colour escapes, built rather than typed, so the source holds no ESC. */
const ANSI_COLOURS = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** A writer that keeps the lines, with the colours stripped. */
function recordingWriter() {
  const lines: string[] = [];
  return {
    lines,
    line: (text: string) => lines.push(text.replace(ANSI_COLOURS, "")),
  };
}

const envelope = {
  callId: "call_1",
  conversationId: "conv_1",
  turnId: "turn_1",
  deadlineAt: 0,
};

const bashCall = (command: string): LocalCall => ({
  ...envelope,
  tool: "local_bash",
  params: { command },
});

const editCall = (path: string): LocalCall => ({
  ...envelope,
  tool: "local_edit",
  params: { path, edits: [{ oldText: "a", newText: "b" }] },
});

const bashOutput = (over: Partial<BashOutput>): BashOutput => ({
  stdout: "",
  stderr: "",
  exitCode: 0,
  truncated: false,
  durationMs: 120,
  ...over,
});

describe("conversationLink", () => {
  describe("when the platform sends an absolute url", () => {
    it("keeps it as it is", () => {
      expect(
        conversationLink({
          url: "https://app.langwatch.ai/?langyConversation=conv_1",
          endpoint: "https://app.langwatch.ai",
        }),
      ).toBe("https://app.langwatch.ai/?langyConversation=conv_1");
    });
  });

  describe("when the platform sends a path", () => {
    it("joins it to the endpoint the CLI already talks to", () => {
      expect(
        conversationLink({
          url: "/?langyConversation=conv_1",
          endpoint: "http://localhost:5570",
        }),
      ).toBe("http://localhost:5570/?langyConversation=conv_1");
    });

    it("keeps the path when there is no endpoint to join it to", () => {
      expect(
        conversationLink({
          url: "/?langyConversation=conv_1",
          endpoint: undefined,
        }),
      ).toBe("/?langyConversation=conv_1");
    });
  });
});

describe("shorten", () => {
  describe("when the text fits", () => {
    it("keeps it as one line", () => {
      expect(shorten("git status", 60)).toBe("git status");
    });

    it("folds the newlines a shell argument can carry", () => {
      expect(shorten("git\n  status", 60)).toBe("git status");
    });
  });

  describe("when the text is longer than the limit", () => {
    it("cuts at a whole word and closes with an ellipsis", () => {
      const long = `pnpm run ${"build ".repeat(20)}`;
      const short = shorten(long, 40);

      expect(short.length).toBeLessThanOrEqual(41);
      expect(short.endsWith("\u2026")).toBe(true);
      expect(short).not.toMatch(/ \u2026$/);
    });
  });
});

describe("shortReason", () => {
  describe("when the failure text runs over several lines", () => {
    it("keeps only the first line", () => {
      expect(
        shortReason("old text not found\n\n--- README.md ---\nline one\nline two"),
      ).toBe("old text not found");
    });
  });

  describe("when the first line is long", () => {
    it("cuts it back", () => {
      const reason = shortReason("x".repeat(200));

      expect(reason.length).toBeLessThanOrEqual(71);
      expect(reason.endsWith("\u2026")).toBe(true);
    });
  });
});

describe("the terminal lines one call produces", () => {
  describe("when an edit fails", () => {
    it("names the tool, the path and a short reason", () => {
      const writer = recordingWriter();

      createUi(writer).callFailed({
        call: editCall("README.md"),
        message:
          "old text not found\nThe file holds:\n" + "a".repeat(400),
      });

      expect(writer.lines).toEqual([
        "  \u2022 edit README.md failed: old text not found",
      ]);
    });
  });

  describe("when a command ends with a status", () => {
    it("names the command and the exit code, and no output", () => {
      const writer = recordingWriter();

      createUi(writer).callOutcome({
        call: bashCall("git fetch origin"),
        output: bashOutput({
          exitCode: 128,
          stderr: "fatal: 'origin' does not appear to be a git repository",
        }),
      });

      expect(writer.lines).toEqual(["  \u2022 bash git fetch origin: exit 128"]);
    });
  });

  describe("when a command succeeds", () => {
    it("names the size and the time, and no output", () => {
      const writer = recordingWriter();

      createUi(writer).callOutcome({
        call: bashCall("pnpm test"),
        output: bashOutput({ stdout: "x".repeat(2048), durationMs: 1500 }),
      });

      expect(writer.lines).toEqual([
        "  \u2022 bash pnpm test (exit 0, 2.0 KB, 1.5 s)",
      ]);
    });
  });

  describe("when the command is longer than one line", () => {
    it("cuts it back", () => {
      expect(callLine(bashCall(`echo ${"word ".repeat(40)}`)).length)
        .toBeLessThanOrEqual(66);
    });
  });

  describe("when a line is wider than the terminal", () => {
    /** @scenario "The approval question wraps on word boundaries" */
    it("breaks it where the words end, never inside one", () => {
      const text =
        'Langy session "instrument my traces" (project acme, asked 2 min ago) is requesting control over /Users/dev/acme';
      const lines = wrapWords(text, 40);

      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(40);
        expect(line).toBe(line.trim());
      }
      expect(lines.join(" ")).toBe(text);
      expect(lines.length).toBeGreaterThan(2);
    });

    it("keeps a word that is wider than the terminal on its own line", () => {
      const path = "/Users/dev/" + "very-long-folder-name-".repeat(4);
      expect(wrapWords(`control over ${path}`, 20)).toEqual([
        "control over",
        path,
      ]);
    });

    it("falls back to eighty columns when the terminal does not report one", () => {
      expect(terminalWidth(undefined)).toBe(80);
      expect(terminalWidth(10)).toBe(80);
      expect(terminalWidth(132)).toBe(132);
    });
  });

  describe("when an answer arrives for a long command", () => {
    /** @scenario "A long command is printed once" */
    it("names the patterns rather than repeating the command", () => {
      expect(
        answerLine({
          summary: 'git add . && git commit -m "feat: add tracing" && git push',
          patterns: ["git add", "git commit", "git push"],
          decision: "allow_pattern",
        }),
      ).toBe("Allowed for this session: git add, git commit, git push.");

      expect(
        answerLine({
          summary: "pnpm typecheck",
          patterns: ["pnpm typecheck"],
          decision: "deny",
        }),
      ).toBe("pnpm typecheck: denied.");
    });
  });
});
