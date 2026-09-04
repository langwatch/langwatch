/**
 * The harness reads of the local-control suite.
 *
 * These pin the pure part of the fixture. The rest of it needs a live stack,
 * so it is only ever exercised by the scenario files.
 */

import { describe, expect, it } from "vitest";
import {
  answerOfTurn,
  demoReposToPrune,
  listeningPids,
  permissionAnswerNote,
  pidsRunningIn,
  questionAnswerNote,
  type StoredMessage,
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
});

describe("questionAnswerNote", () => {
  describe("when the developer picks an option", () => {
    it("carries the question and the option that was picked", () => {
      const note = questionAnswerNote({
        waitId: "wait_2",
        questions: [
          { question: "Which branch?", options: [{ label: "main" }] },
        ],
        answered: [{ question: "Which branch?", selected: ["main"] }],
        turnId: "langyturn_1",
      });

      expect(note).toBe(
        '[developer answered in the panel: "Which branch?" -> main]',
      );
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
      expect(
        demoReposToPrune({ existing: [`code-access-${stamp(0)}`], keep: 4 }),
      ).toEqual([]);
    });
  });

  describe("when a folder carries no timestamp", () => {
    it("treats it as the oldest, so it is pruned first", () => {
      const folders = ["leftover", `code-access-${stamp(0)}`];

      expect(demoReposToPrune({ existing: folders, keep: 1 })).toEqual([
        "leftover",
      ]);
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
