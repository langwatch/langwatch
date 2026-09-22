/**
 * Pins the pure part of local-control-fixture.ts. The rest needs a live
 * stack, so it is only exercised by the scenario files.
 */

import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  answerOfTurn,
  demoReposToPrune,
  judgeMessages,
  listeningPids,
  pendingWaitDispatches,
  permissionAnswerNote,
  pidsRunningIn,
  questionAnswerNote,
  REPO_ROOT,
  type RecordWait,
  SCENARIO_REPO_DIR,
  type StoredMessage,
  shareControlProfile,
  turnFailureMessage,
} from "./local-control-fixture";

const TURN = "langyturn_783c8761d92af366b9b8da09f8920c21";

const message = (id: string, role: string): StoredMessage => ({
  id,
  role,
  parts: [{ type: "text", text: id }],
});

describe("answerOfTurn", () => {
  describe("when the turn's answer is stored", () => {
    it("takes that answer and not the last one", () => {
      const messages = [
        message("langymsg_turn-langyturn_first", "assistant"),
        message(`langymsg_turn-${TURN}`, "assistant"),
        message("langymsg_user", "user"),
      ];

      expect(answerOfTurn(messages, TURN)?.id).toBe(`langymsg_turn-${TURN}`);
    });
  });

  describe("when only the previous turn's answer is stored", () => {
    it("finds nothing, so the read waits instead of grading the turn before", () => {
      const messages = [
        message("langymsg_turn-langyturn_first", "assistant"),
        message(`langymsg_${TURN.slice("langyturn_".length)}`, "user"),
      ];

      expect(answerOfTurn(messages, TURN)).toBeNull();
    });
  });

  describe("when a message other than an answer carries the turn id", () => {
    it("takes the assistant message, never the other role", () => {
      const messages = [
        message(`langymsg_turn-${TURN}`, "tool"),
        message(`langymsg_turn-${TURN}`, "assistant"),
      ];

      expect(answerOfTurn(messages, TURN)?.role).toBe("assistant");
    });
  });
});

describe("permissionAnswerNote", () => {
  const ask = {
    waitId: "wait_1",
    callId: "call_1",
    summary: "uv run pytest",
    pattern: "uv run pytest*",
    reason: "run the tests",
    skipOffered: false,
    answeredIn: "panel" as const,
    turnId: "langyturn_1",
    askedAt: 0,
  };

  describe("when the developer allows the pattern for the session", () => {
    it("names the pattern, which is what the next turn relies on", () => {
      const note = permissionAnswerNote({ ...ask, decision: "allow_pattern" });

      expect(note).toContain("uv run pytest*");
      expect(note).toContain("for this session");
    });
  });

  describe("when the developer allows one command", () => {
    it("says the grant covered that command only", () => {
      expect(permissionAnswerNote({ ...ask, decision: "allow_once" })).toBe(
        "[developer allowed once in the panel: uv run pytest]",
      );
    });
  });

  describe("when the developer denies", () => {
    it("says so, so a later run of the same command reads as a violation", () => {
      expect(
        permissionAnswerNote({
          ...ask,
          summary: "rm -rf tests",
          decision: "deny",
        }),
      ).toBe("[developer denied in the panel: rm -rf tests]");
    });
  });

  describe("when the developer answers in the terminal", () => {
    it("says the terminal, so the judge reads it as an answer given there", () => {
      expect(
        permissionAnswerNote({
          ...ask,
          decision: "allow_pattern",
          answeredIn: "terminal",
        }),
      ).toBe(
        "[developer allowed the pattern `uv run pytest*` for this session in the terminal: uv run pytest]",
      );
    });
  });
});

describe("questionAnswerNote", () => {
  describe("when the developer picks an option", () => {
    it("carries the question and the option that was picked", () => {
      const note = questionAnswerNote({
        waitId: "wait_2",
        questions: [{ question: "Which branch?", options: [{ label: "main" }] }],
        answered: [{ question: "Which branch?", selected: ["main"] }],
        turnId: "langyturn_1",
      });

      expect(note).toBe('[developer answered in the panel: "Which branch?" -> main]');
    });
  });
});

describe("demoReposToPrune", () => {
  const stamp = (offsetMs: number) => (Date.now() + offsetMs).toString(36);

  describe("when more folders exist than a run keeps", () => {
    /** @scenario "A run cleans up the demo folders the runs before it left" */
    it("names the oldest ones, keeping the most recent few", () => {
      const folders = [
        `code-access-${stamp(-5000)}`,
        `permissions-${stamp(-4000)}`,
        `disconnect-${stamp(-3000)}`,
        `connected-agent-${stamp(-2000)}`,
        `code-access-${stamp(-1000)}`,
        `permissions-${stamp(0)}`,
      ];

      const pruned = demoReposToPrune({ existing: folders, keep: 4 });

      expect(pruned).toEqual([folders[1], folders[0]]);
    });
  });

  describe("when the folders fit inside what a run keeps", () => {
    it("names none", () => {
      expect(demoReposToPrune({ existing: [`code-access-${stamp(0)}`], keep: 4 })).toEqual([]);
    });
  });

  describe("when a folder carries no timestamp", () => {
    it("treats it as the oldest, so it is pruned first", () => {
      const folders = ["leftover", `code-access-${stamp(0)}`];

      expect(demoReposToPrune({ existing: folders, keep: 1 })).toEqual(["leftover"]);
    });
  });
});

describe("turnFailureMessage", () => {
  describe("when the turn a scenario was grading failed", () => {
    it("names the turn and carries the reason the record stored", () => {
      const message = turnFailureMessage({
        turnId: TURN,
        failure: '{"kind":"langy_worker_stopped"}',
      });

      expect(message).toContain(TURN);
      expect(message).toContain("langy_worker_stopped");
    });
  });

  describe("when no turn was named", () => {
    it("still says a turn failed, so none is graded in its place", () => {
      expect(turnFailureMessage({ failure: "out of memory" })).toBe(
        "The last turn failed, so there is no answer to grade: out of memory",
      );
    });
  });
});

describe("listeningPids", () => {
  const lsofOutput = [
    "COMMAND   PID    USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
    "python  40321 rogerio    7u  IPv4 0x1234      0t0  TCP *:8765 (LISTEN)",
    "python  40321 rogerio    8u  IPv6 0x5678      0t0  TCP *:8765 (LISTEN)",
    "node    40999 rogerio    3u  IPv4 0x9abc      0t0  TCP *:8765 (LISTEN)",
    "",
  ].join("\n");

  describe("when processes hold the scenario's port", () => {
    it("names each one once, so the teardown ends both", () => {
      expect(listeningPids(lsofOutput)).toEqual([40321, 40999]);
    });
  });

  describe("when nothing holds the port", () => {
    it("names none", () => {
      expect(listeningPids("")).toEqual([]);
    });
  });
});

describe("pidsRunningIn", () => {
  const lsofOutput = [
    "p40321",
    "fcwd",
    "n/tmp/scenario-repos/code-access-1/app",
    "p40999",
    "fcwd",
    "n/tmp/scenario-repos/code-access-11",
    "p41000",
    "fcwd",
    "n/Users/rogerio",
    "",
  ].join("\n");

  describe("when a process runs from the scenario's folder", () => {
    it("names it, and leaves a folder that only shares its prefix alone", () => {
      expect(
        pidsRunningIn({
          lsofOutput,
          root: "/tmp/scenario-repos/code-access-1",
        }),
      ).toEqual([40321]);
    });
  });
});

describe("judgeMessages", () => {
  const say = (text: string, id: string) => ({
    type: "tool-say",
    toolCallId: id,
    input: { text },
    state: "output-available",
    output: "",
  });
  const call = (name: string, id: string) => ({
    type: `tool-${name}`,
    toolCallId: id,
    input: { command: name },
    state: "output-available",
    output: "done",
  });
  /** The reply the judge reads last: an assistant message carrying one line. */
  const lastReply = (parts: Record<string, unknown>[]): string => {
    const messages = judgeMessages({ role: "assistant", parts });
    const last = messages[messages.length - 1];
    return last?.role === "assistant" && typeof last.content === "string" ? last.content : "";
  };

  // The shape the whole llmops path ends on: the closing line, then the two
  // `navigate open` calls that open what was made, then an empty text part.
  describe("when the turn ends on tool calls and an empty text part", () => {
    const parts = [
      say("I found a FastAPI agent in app/main.py.", "c1"),
      call("local_bash", "c2"),
      say("All ready! Let me know if there is anything I can help with.", "c3"),
      call("langwatch.navigate.open", "c4"),
      call("langwatch.navigate.open", "c5"),
      { type: "text", role: "assistant", text: "" },
    ];

    it("still ends on a reply, and that reply is the closing line", () => {
      expect(lastReply(parts)).toBe("All ready! Let me know if there is anything I can help with.");
    });

    it("keeps the earlier passages in front of the calls they introduce", () => {
      const messages = judgeMessages({ role: "assistant", parts });
      const said = messages.flatMap((message) =>
        Array.isArray(message.content)
          ? message.content
              .filter((piece) => piece.type === "text")
              .map((piece) => (piece as { text: string }).text)
          : [],
      );
      expect(said).toEqual([
        "I found a FastAPI agent in app/main.py.",
        "All ready! Let me know if there is anything I can help with.",
      ]);
    });
  });

  describe("when the turn ends on its passages", () => {
    it("replies with the last line alone, not every line joined", () => {
      expect(
        lastReply([
          call("local_bash", "c1"),
          say("I found a FastAPI agent in app/main.py.", "c2"),
          say("No pull request was opened, since the folder has no remote.", "c3"),
          say("I left branch langy/acme checked out.", "c4"),
        ]),
      ).toBe("I left branch langy/acme checked out.");
    });
  });

  describe("when the turn said nothing at all", () => {
    it("replies with empty text, which is the failure the rubric names", () => {
      expect(lastReply([call("local_bash", "c1")])).toBe("");
    });
  });
});

describe("SCENARIO_REPO_DIR", () => {
  /**
   * The one property that matters: a folder git can walk out of is a folder
   * Langy can make a branch in, and it made one on the lane's own checkout.
   */
  it("is outside this checkout, so no walk up reaches a repository of ours", () => {
    const inside =
      SCENARIO_REPO_DIR === REPO_ROOT || SCENARIO_REPO_DIR.startsWith(`${REPO_ROOT}${path.sep}`);
    expect(inside).toBe(false);
  });

  it("is an absolute path, which a cd into it and a git ceiling both need", () => {
    expect(path.isAbsolute(SCENARIO_REPO_DIR)).toBe(true);
  });

  it("is not the home directory itself, which the CLI refuses to share", () => {
    expect(SCENARIO_REPO_DIR).not.toBe(process.env.HOME);
  });
});

describe("shareControlProfile", () => {
  const profile = (pathDirs?: string[]) =>
    shareControlProfile({
      root: "/tmp/scenario-repos/acme-notes",
      configPath: "/tmp/scenario-repos/acme-config.json",
      binDir: "/tmp/scenario-repos/acme-bin",
      shimDir: "/tmp/scenario-repos/acme-shims",
      ceiling: "/tmp/scenario-repos",
      appBase: "http://localhost:5610",
      cliEntry: "/checkout/cli.js",
      ...(pathDirs ? { pathDirs } : {}),
    });

  describe("the git ceiling", () => {
    it("stops the repository walk at the folder the scenarios live in", () => {
      expect(profile()).toContain('export GIT_CEILING_DIRECTORIES="/tmp/scenario-repos"');
    });

    it("is exported before the command line starts, so it inherits it", () => {
      const lines = profile().split("\n");
      const ceiling = lines.findIndex((line) => line.startsWith("export GIT_CEILING_DIRECTORIES="));
      const exec = lines.findIndex((line) => line.startsWith("exec node "));
      expect(ceiling).toBeGreaterThan(-1);
      expect(exec).toBeGreaterThan(ceiling);
    });
  });

  describe("the PATH it builds", () => {
    it("puts the scenario's own shims first and keeps the machine's after", () => {
      expect(profile(["/tmp/scenario-repos/acme-python/bin"])).toContain(
        'export PATH="/tmp/scenario-repos/acme-shims":"/tmp/scenario-repos/acme-bin":"/tmp/scenario-repos/acme-python/bin":"$PATH"',
      );
    });
  });

  describe("the project key", () => {
    it("is unset, so the terminal acts as the person and not the project", () => {
      expect(profile()).toContain("unset LANGWATCH_API_KEY");
    });
  });
});

describe("pendingWaitDispatches", () => {
  const wait = (over: Partial<RecordWait> = {}): RecordWait => ({
    waitId: "wait_1",
    kind: "permission",
    status: "pending",
    turnId: TURN,
    summary: "pip install langwatch",
    ...over,
  });

  describe("when the turn's stream ended before the card went up", () => {
    it("still finds the card, because the record outlives the stream", () => {
      const dispatches = pendingWaitDispatches({
        waits: [wait()],
        answered: new Set<string>(),
      });
      expect(dispatches).toHaveLength(1);
      expect(dispatches[0]?.entry.summary).toBe("pip install langwatch");
      expect(dispatches[0]?.turnId).toBe(TURN);
    });

    it("sends a question card and a permission card down their own paths", () => {
      const dispatches = pendingWaitDispatches({
        waits: [
          wait({ waitId: "wait_1", kind: "permission" }),
          wait({ waitId: "wait_2", kind: "question" }),
        ],
        answered: new Set<string>(),
      });
      expect(dispatches.map((dispatch) => dispatch.kind)).toEqual(["permission", "question"]);
    });
  });

  describe("when a card needs nothing", () => {
    it("leaves an answered card alone, so one answer is sent once", () => {
      expect(
        pendingWaitDispatches({
          waits: [wait()],
          answered: new Set(["wait_1"]),
        }),
      ).toEqual([]);
    });

    it("leaves a card that already settled alone", () => {
      expect(
        pendingWaitDispatches({
          waits: [
            wait({ waitId: "wait_1", status: "answered" }),
            wait({ waitId: "wait_2", status: "expired" }),
            wait({ waitId: "wait_3", status: "cancelled" }),
          ],
          answered: new Set<string>(),
        }),
      ).toEqual([]);
    });

    it("leaves a card with no id alone rather than answering nothing", () => {
      expect(
        pendingWaitDispatches({
          waits: [wait({ waitId: "" })],
          answered: new Set<string>(),
        }),
      ).toEqual([]);
    });
  });

  describe("the order it hands them over", () => {
    it("keeps the record's order, so the first card asked is answered first", () => {
      const dispatches = pendingWaitDispatches({
        waits: [wait({ waitId: "wait_1" }), wait({ waitId: "wait_2" }), wait({ waitId: "wait_3" })],
        answered: new Set<string>(),
      });
      expect(dispatches.map((dispatch) => dispatch.entry.waitId)).toEqual([
        "wait_1",
        "wait_2",
        "wait_3",
      ]);
    });
  });
});
