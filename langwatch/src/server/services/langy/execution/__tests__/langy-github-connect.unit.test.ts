/**
 * @vitest-environment node
 *
 * The connect card, driven by the TOOL STREAM instead of the model's prose.
 *
 * This replaces `routes/__tests__/langy-connect-card.test.ts`, which pinned two
 * things that no longer exist: the route POSTing to the agent (that moved to the
 * worker in ADR-044) and the `[langy:connect-github]` sentinel — a marker we
 * asked the model to print into its reply so we could regex it back out and draw
 * a card. That made the LLM a state machine it cannot reliably be: it could
 * paraphrase the marker, forget it, or emit it on a turn that never touched
 * GitHub.
 *
 * Now the control plane watches what the agent actually RUNS. The moment it
 * reaches for `gh` (or a `git` command that talks to the remote) on a turn whose
 * credentials carry no GitHub token, the turn stops with a structured
 * `langy_github_not_connected` error. The browser renders that as the in-chat
 * Connect card — never a red one — and connecting re-drives the turn through the
 * non-duplicating `regenerate()` seam.
 *
 * @see specs/langy/langy-turn-recovery.feature
 */
import { describe, expect, it, vi } from "vitest";
import { runTurn, type RunTurnDeps } from "../langy-turn.processor";
import type { LangyTurnJobData } from "../langy-worker-pool";

function ndjsonResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + "\n"));
      controller.close();
    },
  });
  return { ok: true, body: stream } as unknown as Response;
}

/** A `langy.tool` start frame for a bash call running `command`. */
function bashFrame(id: string, command: string): string {
  return JSON.stringify({
    type: "langy.tool",
    id,
    name: "bash",
    phase: "start",
    input: { command },
  });
}

function makeBuffer() {
  return {
    heartbeat: vi.fn(async () => {}),
    appendChunk: vi.fn(async () => {}),
    appendMilestone: vi.fn(async () => {}),
    appendTool: vi.fn(async () => {}),
    appendStatus: vi.fn(async () => {}),
    markEnd: vi.fn(async () => {}),
    markError: vi.fn(
      async (_args: { conversationId: string; turnId: string; error: string }) => {},
    ),
    flush: vi.fn(async () => {}),
  };
}

function makeConversations() {
  return {
    recordTurnHandoff: vi.fn(async () => {}),
    finalizeTurn: vi.fn(async () => ({ messageId: "m" })),
    failTurn: vi.fn(async () => {}),
    recordToolCallStarted: vi.fn(async () => {}),
    recordToolCallCompleted: vi.fn(async () => {}),
  };
}

function job(githubToken?: string): LangyTurnJobData {
  return {
    projectId: "p1",
    conversationId: "c1",
    turnId: "t1",
    actorUserId: "alice",
    prompt: "fix the bug in acme/foo and open a PR",
    system: "sys",
    permitReserved: true,
    credentials: (githubToken
      ? { githubToken, githubLogin: "octocat" }
      : {}) as LangyTurnJobData["credentials"],
  } as LangyTurnJobData;
}

function deps(overrides: Partial<RunTurnDeps>): RunTurnDeps {
  return {
    conversations: makeConversations() as unknown as RunTurnDeps["conversations"],
    ephemeral: { publish: vi.fn(async () => {}) } as unknown as RunTurnDeps["ephemeral"],
    buffer: makeBuffer() as unknown as RunTurnDeps["buffer"],
    agentUrl: "http://manager",
    internalSecret: "secret",
    sleepImpl: async () => {},
    ...overrides,
  } as RunTurnDeps;
}

/** The kind the worker wrote onto the buffer's terminal `error` entry. */
function markedErrorKind(buffer: ReturnType<typeof makeBuffer>): string {
  const call = buffer.markError.mock.calls[0]?.[0] as { error: string } | undefined;
  return JSON.parse(call!.error).kind as string;
}

describe("runTurn (GitHub not connected)", () => {
  describe("given the user has not connected GitHub", () => {
    describe("when the agent reaches for the gh CLI", () => {
      it("stops the turn with a structured langy_github_not_connected error", async () => {
        const buffer = makeBuffer();
        const fetchImpl = vi.fn(async () =>
          ndjsonResponse([bashFrame("1", "gh repo clone acme/foo -- --depth 1")]),
        ) as unknown as typeof fetch;

        await runTurn(
          job(),
          deps({ buffer: buffer as unknown as RunTurnDeps["buffer"], fetchImpl }),
        );

        expect(markedErrorKind(buffer)).toBe("langy_github_not_connected");
      });

      it("does not need the model to announce anything", async () => {
        // The whole point. The agent says NOTHING about GitHub — it just runs the
        // command — and the card still appears, because we watched the tool call.
        const buffer = makeBuffer();
        const fetchImpl = vi.fn(async () =>
          ndjsonResponse([
            '{"type":"message.part.delta","properties":{"field":"text","delta":"Sure, on it."}}',
            bashFrame("1", "gh pr create --fill"),
          ]),
        ) as unknown as typeof fetch;

        await runTurn(
          job(),
          deps({ buffer: buffer as unknown as RunTurnDeps["buffer"], fetchImpl }),
        );

        expect(markedErrorKind(buffer)).toBe("langy_github_not_connected");
      });

      it("returns the reserved PR permit — a stalled turn must not eat a daily slot", async () => {
        // The turn opened no PR. The permit it reserved up front goes back, so the
        // user can still open their allowance once they've connected. The re-drive
        // after connecting reserves its own.
        const releaseSpy = vi.fn(async () => {});
        vi.doMock("~/server/middleware/rate-limit-langy-github-prs", () => ({
          releaseLangyGithubPrPermit: releaseSpy,
          recordExtraLangyGithubPrs: vi.fn(),
        }));
        vi.resetModules();
        const { runTurn: freshRunTurn } = await import("../langy-turn.processor");

        const buffer = makeBuffer();
        const fetchImpl = vi.fn(async () =>
          ndjsonResponse([bashFrame("1", "gh repo clone acme/foo")]),
        ) as unknown as typeof fetch;

        await freshRunTurn(
          job(),
          deps({ buffer: buffer as unknown as RunTurnDeps["buffer"], fetchImpl }),
        );

        expect(releaseSpy).toHaveBeenCalledWith({ userId: "alice" });
        vi.doUnmock("~/server/middleware/rate-limit-langy-github-prs");
      });
    });

    describe("when the agent only does local git work", () => {
      it("does NOT stop the turn — a local commit needs no GitHub account", async () => {
        // The false-positive guard, and the reason this is not a blanket
        // pre-flight: most turns never touch GitHub, and killing them all to
        // demand a connection would be a regression on every other request.
        const buffer = makeBuffer();
        const conversations = makeConversations();
        const fetchImpl = vi.fn(async () =>
          ndjsonResponse([
            bashFrame("1", "git checkout -b langy/fix"),
            bashFrame("2", 'git commit -m "fix"'),
            '{"type":"message.part.delta","properties":{"field":"text","delta":"Committed locally."}}',
          ]),
        ) as unknown as typeof fetch;

        await runTurn(
          job(),
          deps({
            buffer: buffer as unknown as RunTurnDeps["buffer"],
            conversations: conversations as unknown as RunTurnDeps["conversations"],
            fetchImpl,
          }),
        );

        expect(buffer.markError).not.toHaveBeenCalled();
        expect(conversations.finalizeTurn).toHaveBeenCalledWith(
          expect.objectContaining({ outcome: "completed" }),
        );
      });
    });

    describe("when the turn never touches GitHub at all", () => {
      it("runs to completion untouched", async () => {
        const buffer = makeBuffer();
        const conversations = makeConversations();
        const fetchImpl = vi.fn(async () =>
          ndjsonResponse([
            bashFrame("1", "langwatch trace search --format json"),
            '{"type":"message.part.delta","properties":{"field":"text","delta":"Found 3 traces."}}',
          ]),
        ) as unknown as typeof fetch;

        await runTurn(
          job(),
          deps({
            buffer: buffer as unknown as RunTurnDeps["buffer"],
            conversations: conversations as unknown as RunTurnDeps["conversations"],
            fetchImpl,
          }),
        );

        expect(buffer.markError).not.toHaveBeenCalled();
        expect(conversations.finalizeTurn).toHaveBeenCalled();
      });
    });
  });

  describe("given the user HAS connected GitHub", () => {
    it("lets the agent clone and push freely", async () => {
      const buffer = makeBuffer();
      const conversations = makeConversations();
      const fetchImpl = vi.fn(async () =>
        ndjsonResponse([
          bashFrame("1", "gh repo clone acme/foo -- --depth 1"),
          bashFrame("2", "git push -u origin HEAD"),
          bashFrame("3", "gh pr create --fill"),
        ]),
      ) as unknown as typeof fetch;

      await runTurn(
        job("gho_live_token"),
        deps({
          buffer: buffer as unknown as RunTurnDeps["buffer"],
          conversations: conversations as unknown as RunTurnDeps["conversations"],
          fetchImpl,
        }),
      );

      expect(buffer.markError).not.toHaveBeenCalled();
      expect(conversations.finalizeTurn).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "completed" }),
      );
    });
  });
});
