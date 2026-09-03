import { describe, expect, it } from "vitest";

import {
  type LangyLiveWait,
  langyPermissionCards,
  langyQuestionWaitsByToolCall,
  mergeLangyWaitStatus,
  routeLangyChoiceAnswer,
  toolCallIdOfQuestionBlock,
} from "../langyLocalWaits";

const permissionWait = (over: Record<string, unknown> = {}) => ({
  waitId: "wait-1",
  kind: "permission" as const,
  status: "pending" as const,
  expiresAt: 0,
  callId: "call-1",
  summary: "pnpm typecheck",
  pattern: "pnpm *",
  reason: "Runs the project's own type check",
  skipOffered: true,
  workspaceName: "acme-app",
  hostname: "rogerio-mbp",
  questions: null,
  decision: null,
  answers: null,
  answeredBy: null,
  answeredAt: null,
  ...over,
});

const toolCall = (over: Record<string, unknown> = {}) => ({
  toolCallId: "call-local-1",
  toolName: "local_bash",
  status: "initiated" as const,
  wait: permissionWait(),
  ...over,
});

describe("langyPermissionCards", () => {
  describe("given the folded turn document alone", () => {
    /** @scenario "A command outside the read-only set renders a permission card" */
    it("reads the machine, the folder and the exact command", () => {
      const [card] = langyPermissionCards({
        toolCalls: [toolCall()] as never,
      });

      expect(card).toMatchObject({
        waitId: "wait-1",
        status: "pending",
        command: "pnpm typecheck",
        pattern: "pnpm *",
        hostname: "rogerio-mbp",
        workspaceName: "acme-app",
        skipOffered: true,
      });
    });

    /** @scenario "The answered card is recorded, so a reload shows the same outcome" */
    it("keeps the answer that was recorded, so a reload marks it", () => {
      const [card] = langyPermissionCards({
        toolCalls: [
          toolCall({
            wait: permissionWait({
              status: "answered",
              decision: "allow_once",
            }),
          }),
        ] as never,
      });

      expect(card?.status).toBe("answered");
      expect(card?.decision).toBe("allow_once");
    });
  });

  describe("given only the live stream", () => {
    it("renders the card before the durable tail lands", () => {
      const live: Record<string, LangyLiveWait> = {
        "wait-9": {
          waitId: "wait-9",
          kind: "permission",
          status: "pending",
          summary: "pnpm build",
          hostname: "rogerio-mbp",
          workspaceName: "acme-app",
          skipOffered: false,
        },
      };

      const [card] = langyPermissionCards({ toolCalls: null, live });
      expect(card?.command).toBe("pnpm build");
      expect(card?.skipOffered).toBe(false);
    });

    it("drops an ask that names no command, because there is nothing to rule on", () => {
      const live: Record<string, LangyLiveWait> = {
        "wait-9": { waitId: "wait-9", kind: "permission", status: "pending" },
      };
      expect(langyPermissionCards({ live })).toEqual([]);
    });
  });

  describe("given both sources", () => {
    it("settles the card as soon as either side says it settled", () => {
      const cards = langyPermissionCards({
        toolCalls: [toolCall()] as never,
        live: {
          "wait-1": {
            waitId: "wait-1",
            kind: "permission",
            status: "answered",
            summary: "pnpm typecheck",
            decision: "deny",
          },
        },
      });

      expect(cards).toHaveLength(1);
      expect(cards[0]?.status).toBe("answered");
      expect(cards[0]?.decision).toBe("deny");
    });
  });
});

describe("mergeLangyWaitStatus", () => {
  describe("given one side still pending", () => {
    it("takes the terminal state, whichever side reported it", () => {
      expect(
        mergeLangyWaitStatus({ durable: "pending", live: "expired" }),
      ).toBe("expired");
      expect(
        mergeLangyWaitStatus({ durable: "cancelled", live: "pending" }),
      ).toBe("cancelled");
    });
  });

  describe("given both sides pending", () => {
    it("stays pending", () => {
      expect(
        mergeLangyWaitStatus({ durable: "pending", live: "pending" }),
      ).toBe("pending");
      expect(mergeLangyWaitStatus({})).toBe("pending");
    });
  });
});

describe("toolCallIdOfQuestionBlock", () => {
  describe("given a block id the question bridge minted", () => {
    it("reads the tool call back out of it", () => {
      expect(toolCallIdOfQuestionBlock("question:call-q1:0")).toBe("call-q1");
      expect(toolCallIdOfQuestionBlock("question:call:with:colons:2")).toBe(
        "call:with:colons",
      );
    });
  });

  describe("given anything else", () => {
    it("names no tool call", () => {
      expect(toolCallIdOfQuestionBlock("b-123")).toBeNull();
      expect(toolCallIdOfQuestionBlock("question:")).toBeNull();
    });
  });
});

describe("routeLangyChoiceAnswer", () => {
  const waits = new Map([
    ["call-q1", { waitId: "wait-q1", status: "pending" as const }],
    ["call-q2", { waitId: "wait-q2", status: "expired" as const }],
  ]);

  describe("given a question the tool is still waiting on", () => {
    /** @scenario "Selecting an option returns it to the tool and the turn continues" */
    it("returns the answer to the wait, not to the composer", () => {
      expect(
        routeLangyChoiceAnswer({ blockId: "question:call-q1:0", waits }),
      ).toEqual({ kind: "wait", waitId: "wait-q1" });
    });
  });

  describe("given a question whose wait already ended", () => {
    /** @scenario "A late answer starts the next turn as my message" */
    it("sends the answer as the next user message", () => {
      expect(
        routeLangyChoiceAnswer({ blockId: "question:call-q2:0", waits }),
      ).toEqual({ kind: "message" });
    });
  });

  describe("given a card that never had a wait", () => {
    it("sends the answer as the next user message", () => {
      expect(routeLangyChoiceAnswer({ blockId: "b-1", waits })).toEqual({
        kind: "message",
      });
    });
  });
});

describe("langyQuestionWaitsByToolCall", () => {
  describe("given a question wait on a tool call", () => {
    it("keys it by the call that asked", () => {
      const waits = langyQuestionWaitsByToolCall({
        toolCalls: [
          toolCall({
            toolCallId: "call-q1",
            toolName: "question",
            wait: permissionWait({
              waitId: "wait-q1",
              kind: "question",
              summary: null,
              questions: [{ question: "Which file?" }],
            }),
          }),
        ] as never,
      });

      expect(waits.get("call-q1")).toEqual({
        waitId: "wait-q1",
        status: "pending",
      });
    });
  });
});
