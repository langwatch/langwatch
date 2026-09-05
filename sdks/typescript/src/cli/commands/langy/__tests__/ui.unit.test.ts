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
  callHeadline,
  conversationLink,
  createConsoleWriter,
  createUi,
  editCounts,
  elapsedLabel,
  fileOutcome,
  settledLine,
  shortReason,
  shorten,
  tailLines,
  terminalWidth,
  wrapWords,
} from "../ui";

/** The colour escapes, built rather than typed, so the source holds no ESC. */
const ANSI_COLOURS = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const plain = (text: string): string => text.replace(ANSI_COLOURS, "");

/** A writer that keeps the lines and the block, with the colours stripped. */
function recordingWriter({ interactive = false } = {}) {
  const lines: string[] = [];
  let drawn: string[] = [];
  return {
    lines,
    get drawn() {
      return drawn;
    },
    line: (text: string) => {
      drawn = [];
      lines.push(plain(text));
    },
    draw: (block: string[]) => {
      drawn = block.map(plain);
    },
    erase: () => {
      drawn = [];
    },
    interactive,
  };
}

const ESC = String.fromCharCode(27);
const ERASE = new RegExp(`^${ESC}\\[(\\d+)A${ESC}\\[0J`);

/**
 * A terminal that keeps the rows that are on it.
 *
 * The real writer is driven, rather than a copy of its rules, so the row
 * counting and the cursor movement are what the test reads back.
 */
function fakeTty() {
  const rows: string[] = [];
  const stream = {
    isTTY: true,
    write: (chunk: string): boolean => {
      let text = chunk;
      const erased = ERASE.exec(text);
      if (erased) {
        rows.splice(rows.length - Number(erased[1]), Number(erased[1]));
        text = text.slice(erased[0].length);
      }
      for (const row of text.split("\n").slice(0, -1)) rows.push(plain(row));
      return true;
    },
  } as unknown as NodeJS.WriteStream;
  return { stream, rows };
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

    /** @scenario "The follow-along link names the project the conversation belongs to" */
    it("joins a project home page to the endpoint", () => {
      expect(
        conversationLink({
          url: "/acme-support?langyConversation=conv_1",
          endpoint: "http://localhost:5570",
        }),
      ).toBe("http://localhost:5570/acme-support?langyConversation=conv_1");
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
      expect(short.endsWith("…")).toBe(true);
      expect(short).not.toMatch(/ …$/);
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
      expect(reason.endsWith("…")).toBe(true);
    });
  });
});

describe("the headline one call produces", () => {
  const headlines: Array<[string, LocalCall, string]> = [
    ["a command", bashCall("uv run pytest"), "Bash(uv run pytest)"],
    [
      "a read",
      { ...envelope, tool: "local_read", params: { path: "app/main.py" } },
      "Read(app/main.py)",
    ],
    [
      "a write",
      {
        ...envelope,
        tool: "local_write",
        params: { path: "app/main.py", content: "" },
      },
      "Write(app/main.py)",
    ],
    ["an edit", editCall("app/main.py"), "Edit(app/main.py)"],
    [
      "a search",
      {
        ...envelope,
        tool: "local_grep",
        params: { pattern: "langwatch", path: "src" },
      },
      "Grep(langwatch in src)",
    ],
    [
      "a file search",
      { ...envelope, tool: "local_find", params: { pattern: "**/*.py" } },
      "Find(**/*.py)",
    ],
    [
      "a listing",
      { ...envelope, tool: "local_ls", params: {} },
      "List(.)",
    ],
  ];

  for (const [what, call, expected] of headlines) {
    describe(`when the call is ${what}`, () => {
      /** @scenario "Each call prints as one line" */
      it(`reads ${expected}`, () => {
        expect(callHeadline(call)).toBe(expected);
      });
    });
  }

  describe("when the command is longer than one line", () => {
    it("cuts it back", () => {
      expect(
        callHeadline(bashCall(`echo ${"word ".repeat(40)}`)).length,
      ).toBeLessThanOrEqual(68);
    });
  });
});

describe("the result of a file call", () => {
  const cases: Array<[string, LocalCall, string, string]> = [
    [
      "a read",
      { ...envelope, tool: "local_read", params: { path: "a.py" } },
      "1\tone\n2\ttwo\n3\tthree\n[8 more lines. Read again with offset 4.]",
      "Read 3 lines",
    ],
    [
      "a write",
      {
        ...envelope,
        tool: "local_write",
        params: { path: "a.py", content: "one\ntwo\n" },
      },
      "Wrote a.py (3 lines).",
      "Wrote 3 lines",
    ],
    [
      "an edit that swaps one line for three",
      {
        ...envelope,
        tool: "local_edit",
        params: {
          path: "a.py",
          edits: [{ oldText: "old", newText: "new\nnew\nnew" }],
        },
      },
      "Applied 1 edit to a.py.",
      "Added 3 lines, removed 1 line",
    ],
    [
      "a search with no match",
      { ...envelope, tool: "local_grep", params: { pattern: "nope" } },
      "No line matches nope.",
      "No match",
    ],
    [
      "a search with matches",
      { ...envelope, tool: "local_grep", params: { pattern: "def" } },
      "a.py:1:def one\na.py:4:def two",
      "Found 2 lines",
    ],
    [
      "a file search",
      { ...envelope, tool: "local_find", params: { pattern: "*.py" } },
      "a.py\nb.py\nc.py",
      "Found 3 files",
    ],
    [
      "a listing",
      { ...envelope, tool: "local_ls", params: {} },
      "src:\napp/\nmain.py",
      "2 entries",
    ],
  ];

  for (const [what, call, text, expected] of cases) {
    describe(`when the call is ${what}`, () => {
      /** @scenario "A file call reports what it did, not what it read" */
      it(`reads ${expected}, never the content`, () => {
        expect(fileOutcome({ call, text })).toBe(expected);
      });
    });
  }

  describe("when an edit only adds lines", () => {
    it("counts what went in and what came out", () => {
      expect(
        editCounts([{ oldText: "one\ntwo", newText: "one\nmiddle\ntwo" }]),
      ).toEqual({ added: 1, removed: 0 });
    });
  });
});

describe("the transcript one call produces", () => {
  describe("when a read finishes", () => {
    /** @scenario "Each call prints as one line" */
    it("prints the tool line and the count under it", () => {
      const writer = recordingWriter();
      const ui = createUi(writer);
      const call: LocalCall = {
        ...envelope,
        tool: "local_read",
        params: { path: "app/main.py" },
      };

      ui.call(call);
      ui.callResult({ call, text: "1\tprint('hi')" });

      expect(writer.lines).toEqual([
        "⏺ Read(app/main.py)",
        "  ⎿  Read 1 line",
      ]);
    });
  });

  describe("when an edit fails", () => {
    it("names a short reason under the call", () => {
      const writer = recordingWriter();

      createUi(writer).callFailed({
        message: `old text not found\nThe file holds:\n${"a".repeat(400)}`,
      });

      expect(writer.lines).toEqual([
        "  ⎿  Failed: old text not found",
      ]);
    });
  });

  describe("when the policy refuses a call", () => {
    /** @scenario "A refused call reads as a refusal" */
    it("reads as a refusal", () => {
      const writer = recordingWriter();

      createUi(writer).callRefused({
        message: "The folder is shared without administrator rights, so sudo cannot run.",
      });

      expect(writer.lines[0]).toContain("Refused: The folder is shared without");
    });
  });

  describe("when a command ends with a status", () => {
    /** @scenario "A failed command prints its exit code" */
    it("names the exit code and the last lines of the output", () => {
      const writer = recordingWriter();

      createUi(writer).callOutcome({
        call: bashCall("git fetch origin"),
        output: bashOutput({
          exitCode: 128,
          stderr: "fatal: 'origin' does not appear to be a git repository",
        }),
      });

      expect(writer.lines).toEqual([
        "  ⎿  Exit code 128",
        "     fatal: 'origin' does not appear to be a git repository",
      ]);
    });
  });

  describe("when a command succeeds", () => {
    /** @scenario "Each call prints as one line" */
    it("prints what it wrote and nothing else", () => {
      const writer = recordingWriter();

      createUi(writer).callOutcome({
        call: bashCall("pnpm test"),
        output: bashOutput({ stdout: "2 passed in 3.1s", durationMs: 1500 }),
      });

      expect(writer.lines).toEqual(["  ⎿  2 passed in 3.1s"]);
    });

    describe("when it wrote nothing", () => {
      it("says how long it took", () => {
        const writer = recordingWriter();

        createUi(writer).callOutcome({
          call: bashCall("true"),
          output: bashOutput({ durationMs: 1500 }),
        });

        expect(writer.lines).toEqual(["  ⎿  Finished in 1.5 s, no output"]);
      });
    });
  });

  describe("when a command prints more than eight lines", () => {
    /** @scenario "A long command result keeps its last lines and counts the rest" */
    it("keeps the last eight and counts the rest", () => {
      const writer = recordingWriter();
      const output = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join(
        "\n",
      );

      createUi(writer).callOutcome({
        call: bashCall("pnpm test"),
        output: bashOutput({ stdout: output }),
      });

      expect(writer.lines).toHaveLength(9);
      expect(writer.lines[0]).toContain("line 33");
      expect(writer.lines[7]).toContain("line 40");
      expect(writer.lines[8]).toContain("… +32 lines");
      expect(writer.lines.join("\n")).not.toContain("line 1\n");
    });

    it("counts nothing when the output fits", () => {
      expect(tailLines("one\ntwo\n")).toEqual({
        lines: ["one", "two"],
        hidden: 0,
      });
    });
  });

  describe("when a command runs in the background", () => {
    /** @scenario "A background command prints its process and its log" */
    it("names the process and the log path", () => {
      const writer = recordingWriter();

      createUi(writer).callOutcome({
        call: bashCall("pnpm dev"),
        output: bashOutput({
          pid: 4242,
          exitCode: null,
          logPath: ".langwatch/langy-logs/call_1.log",
        }),
      });

      expect(writer.lines).toEqual([
        "  ⎿  Running in the background as process 4242, log .langwatch/langy-logs/call_1.log",
      ]);
    });
  });

  describe("when a platform notice is printed", () => {
    /** @scenario "A platform notice has no tool name" */
    it("carries no tool name", () => {
      const writer = recordingWriter();

      createUi(writer).disconnected({ reason: "the conversation closed the folder" });

      expect(writer.lines).toEqual([
        "",
        "⏺ LangWatch disconnected the folder: the conversation closed the folder",
      ]);
      expect(writer.lines.join("\n")).not.toMatch(/\(.*\)/);
    });
  });
});

describe("the line a running command draws", () => {
  describe("when the terminal can redraw", () => {
    /** @scenario "A running command says how long it has run" */
    it("draws the elapsed time and erases it when the command ends", () => {
      const writer = recordingWriter({ interactive: true });
      const ui = createUi(writer);

      const stop = ui.startRunning();
      expect(writer.drawn).toEqual(["  ⎿  Running… 0s"]);

      stop();
      expect(writer.drawn).toEqual([]);
    });
  });

  describe("when the output is piped", () => {
    it("draws nothing at all", () => {
      const writer = { lines: [] as string[], line: () => undefined };

      createUi(writer).startRunning()();

      expect(writer.lines).toEqual([]);
    });
  });

  const elapsed: Array<[number, string]> = [
    [0, "0s"],
    [12_400, "12s"],
    [59_999, "59s"],
    [60_000, "1m 00s"],
    [125_000, "2m 05s"],
  ];
  for (const [ms, label] of elapsed) {
    describe(`when ${ms} milliseconds have passed`, () => {
      it(`reads ${label}`, () => {
        expect(elapsedLabel(ms)).toBe(label);
      });
    });
  }
});

describe("holding the transcript", () => {
  /** @scenario "Transcript lines are held while the selector is open" */
  it("prints the held lines only after the question is answered", () => {
    const writer = recordingWriter({ interactive: true });
    const ui = createUi(writer);

    ui.hold();
    ui.call(bashCall("pnpm test"));
    ui.callOutcome({ call: bashCall("pnpm test"), output: bashOutput({}) });
    expect(writer.lines).toEqual([]);

    ui.release();
    expect(writer.lines[0]).toBe("⏺ Bash(pnpm test)");
    expect(writer.lines).toHaveLength(2);
  });
});

describe("the line a settled answer produces", () => {
  const cases: Array<[string, Parameters<typeof settledLine>[0], string]> = [
    [
      "a session grant from the terminal",
      { decision: "allow_pattern", patterns: ["uv run"] },
      'Allowed "uv run" for this session',
    ],
    [
      "a session grant over a chain",
      {
        decision: "allow_pattern",
        patterns: ["git add", "git commit", "git push"],
      },
      'Allowed "git add", "git commit" and "git push" for this session',
    ],
    ["a single allowance", { decision: "allow_once" }, "Allowed once"],
    [
      "a denial with a reason",
      { decision: "deny", reason: "use the staging database" },
      "Denied: use the staging database",
    ],
    ["a denial with no reason", { decision: "deny" }, "Denied"],
    [
      "an answer from the card",
      { decision: "allow_once", source: "panel" },
      "Allowed once on the card in LangWatch",
    ],
    [
      "a grant from the card",
      { decision: "allow_pattern", patterns: ["uv run"], source: "panel" },
      'Allowed "uv run" for this session on the card in LangWatch',
    ],
    [
      "a wait that ran out",
      { decision: "expired" },
      "No answer arrived, so the call was dropped",
    ],
  ];

  for (const [what, input, expected] of cases) {
    describe(`when the answer is ${what}`, () => {
      /** @scenario "The card can answer first and the settled line names it" */
      it(`reads ${expected}`, () => {
        expect(settledLine(input)).toBe(expected);
      });
    });
  }
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
    const path = `/Users/dev/${"very-long-folder-name-".repeat(4)}`;
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

describe("when there is no selector on this screen", () => {
  /** @scenario "Without a terminal there is no selector" */
  it("prints the command and points at the card", () => {
    const writer = recordingWriter();
    const ui = createUi(writer);

    ui.connected({
      root: "/Users/dev/acme",
      conversationTitle: "Instrument my traces",
      conversationUrl: "http://localhost:5570/acme?langyConversation=conv_1",
    });
    const afterConnect = writer.lines.length;
    ui.permissionAsked({ summary: "git push" });

    const asked = writer.lines.slice(afterConnect).join("\n");
    expect(asked).toContain("git push");
    expect(asked).toContain("Answer on the card in LangWatch.");
    expect(asked).not.toContain("langyConversation");
    expect(
      writer.lines.filter((line) => line.includes("langyConversation")).length,
    ).toBe(1);
  });
});

describe("the notice that says the folder connected", () => {
  /** @scenario "The command line prints the follow-along link once" */
  it("prints the link and where to answer once, and never repeats them", () => {
    const writer = recordingWriter({ interactive: true });
    const ui = createUi(writer);
    const url = "http://localhost:5570/acme?langyConversation=conv_1";
    const read: LocalCall = {
      ...envelope,
      tool: "local_read",
      params: { path: "app/main.py" },
    };

    ui.connected({
      root: "/Users/dev/acme",
      conversationTitle: "Instrument my traces",
      conversationUrl: url,
    });
    const connected = writer.lines.join("\n");
    expect(connected).toContain(`Follow along at ${url}`);
    expect(connected).toContain(
      "Permission questions are answered here, or on the card in LangWatch.",
    );

    ui.call(read);
    ui.callResult({ call: read, text: "1\tprint('hi')" });
    ui.call(bashCall("pnpm test"));
    ui.callOutcome({
      call: bashCall("pnpm test"),
      output: bashOutput({ stdout: "2 passed in 3.1s" }),
    });

    expect(writer.lines.slice(-4)).toEqual([
      "⏺ Read(app/main.py)",
      "  ⎿  Read 1 line",
      "⏺ Bash(pnpm test)",
      "  ⎿  2 passed in 3.1s",
    ]);
    expect(
      writer.lines.filter((line) => line.includes("langyConversation")),
    ).toHaveLength(1);
    expect(
      writer.lines.filter((line) => line.includes("Permission questions")),
    ).toHaveLength(1);
  });
});

describe("given a question and a running command on the same screen", () => {
  /** @scenario "A question on the screen survives a command that finishes under it" */
  it("keeps the question on the screen and prints the result after the answer", () => {
    const { stream, rows } = fakeTty();
    const writer = createConsoleWriter(stream);
    const ui = createUi(writer);
    const call = bashCall("pnpm test");

    ui.call(call);
    const stopSpinner = ui.startRunning();
    expect(rows).toEqual(["⏺ Bash(pnpm test)", "  ⎿  Running… 0s"]);

    // The question takes the bottom of the screen while the command runs.
    writer.draw?.(["╭─ question ─╮", "│ answer me │", "╰───────────╯"], "box");
    ui.hold();
    expect(rows.slice(-3)).toEqual([
      "╭─ question ─╮",
      "│ answer me │",
      "╰───────────╯",
    ]);

    // The command finishes under it: the spinner erases its own row and no
    // more, and the result waits for the answer.
    stopSpinner();
    ui.callOutcome({
      call,
      output: bashOutput({ stdout: "2 passed in 3.1s" }),
    });
    expect(rows.slice(-3)).toEqual([
      "╭─ question ─╮",
      "│ answer me │",
      "╰───────────╯",
    ]);

    writer.erase?.("box");
    ui.release();
    expect(rows.join("\n")).not.toContain("answer me");
    expect(rows[rows.length - 1]).toBe("  ⎿  2 passed in 3.1s");
  });

  it("draws no spinner while the question owns the screen", () => {
    const { stream, rows } = fakeTty();
    const writer = createConsoleWriter(stream);
    const ui = createUi(writer);

    writer.draw?.(["│ answer me │"], "box");
    const stop = ui.startRunning();
    expect(rows).toEqual(["│ answer me │"]);

    stop();
    expect(rows).toEqual(["│ answer me │"]);
  });
});

describe("when the conversation title is wider than the terminal", () => {
  /** @scenario "A notice wraps on word boundaries at the terminal width" */
  it("breaks the connected notice where the words end", () => {
    const writer = recordingWriter({ interactive: true });
    const ui = createUi(writer, { width: () => 40 });

    ui.connected({
      root: "/Users/dev/acme-support-dogfood",
      conversationTitle: "Instrument traces with LangWatch",
      conversationUrl: "http://localhost:5570/acme?langyConversation=conv_1",
    });

    const words = "Instrument traces with LangWatch";
    expect(writer.lines.join(" ").replace(/\s+/g, " ")).toContain(words);
    for (const line of writer.lines) {
      // A single word wider than the terminal keeps its own line, and only
      // such a line may be longer than the terminal.
      if (line.trim().split(" ").length > 1) {
        expect(line.length).toBeLessThanOrEqual(40);
      }
    }
    // The link is one word, so it keeps its own line rather than being cut.
    expect(writer.lines).toContainEqual(
      "     http://localhost:5570/acme?langyConversation=conv_1",
    );
  });
});

describe("when results arrive in another order than the calls", () => {
  /** @scenario "A result of a call that is not the last one repeats its call line" */
  it("prints the call line again for a result that is not under its own call", () => {
    const writer = recordingWriter();
    const ui = createUi(writer);
    const first = { ...bashCall("git log -8 --oneline"), callId: "call_1" };
    const second = { ...bashCall("pnpm test"), callId: "call_2" };

    ui.call(first);
    ui.call(second);
    ui.callOutcome({ call: second, output: bashOutput({ stdout: "2 passed" }) });
    ui.callOutcome({ call: first, output: bashOutput({ stdout: "252c7d4 first" }) });

    expect(writer.lines).toEqual([
      "⏺ Bash(git log -8 --oneline)",
      "⏺ Bash(pnpm test)",
      "  ⎿  2 passed",
      "⏺ Bash(git log -8 --oneline)",
      "  ⎿  252c7d4 first",
    ]);
  });

  it("prints no second call line when the result is under its own call", () => {
    const writer = recordingWriter();
    const ui = createUi(writer);
    const call = { ...bashCall("pnpm test"), callId: "call_9" };

    ui.call(call);
    ui.callOutcome({ call, output: bashOutput({ stdout: "2 passed" }) });

    expect(writer.lines).toEqual(["⏺ Bash(pnpm test)", "  ⎿  2 passed"]);
  });
});
