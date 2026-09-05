/**
 * The permission selector: what the box says, and what each key answers.
 *
 * The box is rendered through a fake writer and driven through a fake
 * keypress source, so the test reads the words and the answer rather than the
 * escape sequences.
 *
 * @see specs/typescript-sdk/cli-langy-share-control.feature
 */

import { describe, expect, it } from "vitest";
import type { LocalCall } from "../../../../agent/local-control-protocol";
import {
  approvalCardFor,
  approvalOptions,
  askApproval,
  createTerminalApprovals,
  renderApprovalBox,
  timeLimitSentence,
  type ApprovalCard,
  type KeyEvent,
  type KeySource,
} from "../approval";
import type { UiWriter } from "../ui";

const ANSI_COLOURS = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const plain = (text: string): string => text.replace(ANSI_COLOURS, "");

/** A screen that keeps the block that is drawn on it. */
function fakeScreen({ interactive = true } = {}) {
  let drawn: string[] = [];
  const lines: string[] = [];
  const writer: UiWriter = {
    line: (text) => lines.push(plain(text)),
    draw: (block) => {
      drawn = block.map(plain);
    },
    erase: () => {
      drawn = [];
    },
    interactive,
  };
  return {
    writer,
    lines,
    get drawn() {
      return drawn;
    },
  };
}

/** A keyboard the test presses. */
function fakeKeys(): KeySource & { press: (key: KeyEvent) => void } {
  let listener: ((key: KeyEvent) => void) | null = null;
  return {
    listen: (onKey) => {
      listener = onKey;
      return () => {
        listener = null;
      };
    },
    press: (key) => listener?.(key),
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

const card: ApprovalCard = approvalCardFor({
  call: bashCall("uv run pytest"),
  workspaceName: "acme-support-dogfood",
  summary: "uv run pytest",
  reason: "This runs checks.",
  patterns: ["uv run"],
  timeoutSeconds: 300,
});

describe("the options a permission ask offers", () => {
  describe("when one pattern would be granted", () => {
    /** @scenario "The selector offers the session grant first" */
    it("puts the session grant first and names the pattern", () => {
      expect(approvalOptions(["uv run"])).toEqual([
        {
          value: "allow_pattern",
          label: 'Yes, allow "uv run" for this session',
        },
        { value: "allow_once", label: "Yes, this time only" },
        { value: "deny", label: "No, and tell Langy what to do instead" },
      ]);
    });
  });

  describe("when a chain would grant several patterns", () => {
    /** @scenario "A chain names every pattern the grant would cover" */
    it("names every one of them", () => {
      expect(approvalOptions(["git fetch", "git checkout"])[0]?.label).toBe(
        'Yes, allow "git fetch" and "git checkout" for this session',
      );
    });
  });

  const limits: Array<[number, string]> = [
    [30, "Stops after 30 seconds if it has not finished."],
    [60, "Stops after 1 minute if it has not finished."],
    [300, "Stops after 5 minutes if it has not finished."],
    [900, "Stops after 15 minutes if it has not finished."],
  ];
  for (const [seconds, sentence] of limits) {
    describe(`when the command stops after ${seconds} seconds`, () => {
      it(`reads ${sentence}`, () => {
        expect(timeLimitSentence(seconds)).toBe(sentence);
      });
    });
  }
});

describe("the box the selector draws", () => {
  /** @scenario "The selector says what the command is and what it changes" */
  it("frames the folder, the command, the reason and the three answers", () => {
    const drawn = renderApprovalBox({ card, selected: 0, width: 79 }).map(plain);

    expect(drawn[0]).toContain("Langy wants to run in acme-support-dogfood");
    expect(drawn.join("\n")).toContain("uv run pytest");
    expect(drawn.join("\n")).toContain(
      "This runs checks. Stops after 5 minutes if it has not finished.",
    );
    expect(drawn.join("\n")).toContain("Do you want to allow this?");
    expect(drawn).toContainEqual(
      expect.stringContaining('❯ 1. Yes, allow "uv run" for this session'),
    );
    expect(drawn).toContainEqual(
      expect.stringContaining("2. Yes, this time only"),
    );
    expect(drawn).toContainEqual(
      expect.stringContaining("3. No, and tell Langy what to do instead"),
    );
    expect(drawn.join("\n")).toContain("Enter to confirm");
    for (const line of drawn) expect(line.length).toBe(79);
  });

  describe("when the selection moves", () => {
    it("moves the marker and nothing else", () => {
      const first = renderApprovalBox({ card, selected: 0, width: 79 }).map(plain);
      const second = renderApprovalBox({ card, selected: 1, width: 79 }).map(plain);

      expect(first).toHaveLength(second.length);
      expect(second.filter((line) => line.includes("❯"))).toHaveLength(1);
      expect(
        second.find((line) => line.includes("❯")),
      ).toContain("2. Yes, this time only");
    });
  });

  describe("when the heading is wider than the box", () => {
    it("cuts the heading rather than the frame", () => {
      const wide = renderApprovalBox({
        card: { ...card, title: `Langy wants to run in ${"folder-".repeat(20)}` },
        selected: 0,
        width: 60,
      }).map(plain);

      for (const line of wide) expect(line.length).toBe(60);
    });
  });
});

describe("given a permission selector open in the terminal", () => {
  const open = (
    over: { card?: ApprovalCard; reason?: string } = {},
  ) => {
    const screen = fakeScreen();
    const keys = fakeKeys();
    const asked: string[] = [];
    const prompt = askApproval({
      card: over.card ?? card,
      writer: screen.writer,
      keys,
      readReason: async (question) => {
        asked.push(question);
        return over.reason ?? "";
      },
      width: () => 79,
    });
    return { screen, keys, prompt, asked };
  };

  describe("when the first option is confirmed", () => {
    /** @scenario "Allowing the pattern runs the call and settles the line" */
    it("answers with the session grant and erases the box", async () => {
      const { screen, keys, prompt } = open();
      expect(screen.drawn.length).toBeGreaterThan(0);

      keys.press({ name: "return" });

      await expect(prompt.answer).resolves.toEqual({
        decision: "allow_pattern",
      });
      expect(screen.drawn).toEqual([]);
    });
  });

  describe("when the second option is chosen and confirmed", () => {
    /** @scenario "Allowing once runs the call and grants nothing" */
    it("answers once only", async () => {
      const { keys, prompt } = open();

      keys.press({ name: "down" });
      keys.press({ name: "return" });

      await expect(prompt.answer).resolves.toEqual({ decision: "allow_once" });
    });
  });

  describe("when a digit is pressed", () => {
    it("moves the marker there and waits for Enter", async () => {
      const { screen, keys, prompt } = open();

      keys.press({ name: "3", sequence: "3" });
      expect(screen.drawn.find((line) => line.includes("❯"))).toContain(
        "3. No, and tell Langy",
      );
      expect(screen.drawn.length).toBeGreaterThan(0);

      keys.press({ name: "return" });
      await expect(prompt.answer).resolves.toEqual({ decision: "deny" });
    });
  });

  describe("when the third option is chosen and a line is typed", () => {
    /** @scenario "Denying reads one line of text and sends it back to Langy" */
    it("answers with the typed reason", async () => {
      const { keys, prompt, asked } = open({ reason: " use the staging database " });

      keys.press({ name: "up" });
      keys.press({ name: "return" });

      await expect(prompt.answer).resolves.toEqual({
        decision: "deny",
        reason: "use the staging database",
      });
      expect(asked).toHaveLength(1);
      expect(asked[0]).toContain("Tell Langy what to do instead");
    });
  });

  describe("when Escape is pressed", () => {
    /** @scenario "Escape denies with no reason" */
    it("denies with no reason and asks for none", async () => {
      const { keys, prompt, asked } = open();

      keys.press({ name: "escape" });

      await expect(prompt.answer).resolves.toEqual({ decision: "deny" });
      expect(asked).toEqual([]);
    });
  });

  describe("when the card in the panel answers first", () => {
    /** @scenario "The card can answer first and the settled line names it" */
    it("closes with no answer and erases the box", async () => {
      const { screen, prompt } = open();

      prompt.close();

      await expect(prompt.answer).resolves.toBeNull();
      expect(screen.drawn).toEqual([]);
    });

    it("ignores every key that arrives after it closed", async () => {
      const { keys, prompt } = open();

      prompt.close();
      keys.press({ name: "return" });

      await expect(prompt.answer).resolves.toBeNull();
    });
  });

  describe("when Ctrl-C is pressed", () => {
    it("leaves the answer to the signal handler", () => {
      const { screen, keys } = open();

      keys.press({ name: "c", ctrl: true });

      expect(screen.drawn.length).toBeGreaterThan(0);
    });
  });
});

describe("createTerminalApprovals", () => {
  describe("when the output is a terminal", () => {
    it("builds a selector", () => {
      expect(
        createTerminalApprovals({
          writer: fakeScreen().writer,
          keys: fakeKeys(),
          readReason: async () => "",
        }),
      ).not.toBeNull();
    });
  });

  describe("when the output is piped rather than a terminal", () => {
    /** @scenario "Without a terminal there is no selector" */
    it("builds none, so the card is the only way to answer", () => {
      expect(
        createTerminalApprovals({
          writer: fakeScreen({ interactive: false }).writer,
          keys: fakeKeys(),
          readReason: async () => "",
        }),
      ).toBeNull();
    });
  });
});

describe("the card a file call produces", () => {
  const titles: Array<[LocalCall["tool"], string]> = [
    ["local_bash", "Langy wants to run in acme"],
    ["local_edit", "Langy wants to change a file in acme"],
    ["local_read", "Langy wants to read a file in acme"],
  ];
  for (const [tool, title] of titles) {
    describe(`when the call is ${tool}`, () => {
      it(`the heading reads ${title}`, () => {
        const call = {
          ...envelope,
          tool,
          params:
            tool === "local_bash"
              ? { command: "x" }
              : tool === "local_edit"
                ? { path: ".env", edits: [] }
                : { path: ".env" },
        } as LocalCall;

        expect(
          approvalCardFor({
            call,
            workspaceName: "acme",
            summary: "read .env",
            reason: ".env may hold secrets.",
            patterns: ["local_read .env"],
          }).title,
        ).toBe(title);
      });
    });
  }

  describe("when the call has no time limit", () => {
    it("says nothing about one", () => {
      expect(
        approvalCardFor({
          call: { ...envelope, tool: "local_read", params: { path: ".env" } },
          workspaceName: "acme",
          summary: "read .env",
          reason: ".env may hold secrets.",
          patterns: ["local_read .env"],
        }).description,
      ).toBe(".env may hold secrets.");
    });
  });
});
