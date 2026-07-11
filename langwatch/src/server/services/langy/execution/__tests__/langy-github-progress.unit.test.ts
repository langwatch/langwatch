/**
 * @vitest-environment node
 *
 * PR-flow progress and PR accounting, driven by the TOOL STREAM.
 *
 * This replaces the `[langy:progress:<stage>]` protocol, in which the skill asked
 * the model to print markers into its reply and the server regexed them back out.
 * `git push` IS the push — there was never anything to announce, and asking an
 * LLM to narrate its own state machine meant it could paraphrase a marker, forget
 * one, or claim `opened` on a turn that opened nothing.
 *
 * The most important test in this file is the last one. `extractOpenedPrLinks`
 * used to reconcile the daily PR cap and the `langy.github.pr_opened` audit log
 * against the model's PROSE, so permit accounting depended on the model retyping
 * a URL correctly. Now it is read from the stdout of the `gh pr create` that
 * created it, which cannot be misremembered.
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

/** A bash tool call, start then settle, carrying `command` and its stdout. */
function bashCall(
  id: string,
  command: string,
  options: { output?: string; isError?: boolean } = {},
): string[] {
  return [
    JSON.stringify({
      type: "langy.tool",
      id,
      name: "bash",
      phase: "start",
      input: { command },
    }),
    JSON.stringify({
      type: "langy.tool",
      id,
      name: "bash",
      phase: "end",
      input: { command },
      output: options.output ?? "",
      isError: options.isError ?? false,
    }),
  ];
}

function delta(text: string): string {
  return JSON.stringify({
    type: "message.part.delta",
    properties: { field: "text", delta: text },
  });
}

function makeBuffer() {
  return {
    heartbeat: vi.fn(async () => {}),
    appendChunk: vi.fn(async () => {}),
    appendMilestone: vi.fn(async (_a: { kind: string; detail?: string }) => {}),
    appendTool: vi.fn(async () => {}),
    appendStatus: vi.fn(async () => {}),
    markEnd: vi.fn(async () => {}),
    markError: vi.fn(async () => {}),
    flush: vi.fn(async () => {}),
  };
}

function makeConversations() {
  return {
    recordTurnHandoff: vi.fn(async () => {}),
    finalizeTurn: vi.fn(
      async (_a: { parts: { type: string; text?: string }[] }) => ({
        messageId: "m",
      }),
    ),
    failTurn: vi.fn(async () => {}),
    recordToolCallStarted: vi.fn(async () => {}),
    recordToolCallCompleted: vi.fn(
      async (_a: { toolName: string; toolCallId: string }) => {},
    ),
  };
}

function makeEphemeral() {
  return { publish: vi.fn(async (_p: string, _e: { message?: string }) => {}) };
}

function job(): LangyTurnJobData {
  return {
    projectId: "p1",
    conversationId: "c1",
    turnId: "t1",
    actorUserId: "alice",
    prompt: "fix it and open a PR",
    system: "sys",
    permitReserved: true,
    credentials: {
      githubToken: "gho_live",
      githubLogin: "octocat",
    } as LangyTurnJobData["credentials"],
  } as LangyTurnJobData;
}

function deps(overrides: Partial<RunTurnDeps>): RunTurnDeps {
  return {
    conversations: makeConversations() as unknown as RunTurnDeps["conversations"],
    ephemeral: makeEphemeral() as unknown as RunTurnDeps["ephemeral"],
    buffer: makeBuffer() as unknown as RunTurnDeps["buffer"],
    fastPublisher: {
      publishToken: vi.fn(async () => {}),
      publishEnd: vi.fn(async () => {}),
    } as unknown as RunTurnDeps["fastPublisher"],
    agentUrl: "http://manager",
    internalSecret: "secret",
    sleepImpl: async () => {},
    ...overrides,
  } as RunTurnDeps;
}

const PR_URL = "https://github.com/acme/foo/pull/9";

describe("runTurn (PR-flow progress from the tool stream)", () => {
  describe("given the agent walks the whole PR flow", () => {
    it("reports each stage from the command that performed it", async () => {
      const ephemeral = makeEphemeral();
      const fetchImpl = vi.fn(async () =>
        ndjsonResponse([
          ...bashCall("1", "gh repo clone acme/foo -- --depth 1"),
          ...bashCall("2", "git checkout -b langy/fix-retry"),
          ...bashCall("3", 'git commit -m "fix the retry bug"'),
          ...bashCall("4", "git push -u origin HEAD"),
          ...bashCall("5", "gh pr create --fill", { output: PR_URL }),
        ]),
      ) as unknown as typeof fetch;

      await runTurn(
        job(),
        deps({
          ephemeral: ephemeral as unknown as RunTurnDeps["ephemeral"],
          fetchImpl,
        }),
      );

      const stages = ephemeral.publish.mock.calls.map(
        ([, event]) => (event.message ?? "").split(":")[0],
      );
      expect(stages).toEqual([
        "cloning",
        "cloned",
        "branched",
        "committed",
        "pushed",
        "opening_pr",
      ]);
    });

    it("carries the detail the command itself names", async () => {
      const ephemeral = makeEphemeral();
      const fetchImpl = vi.fn(async () =>
        ndjsonResponse([
          ...bashCall("1", "gh repo clone acme/foo"),
          ...bashCall("2", "git checkout -b langy/fix-retry"),
        ]),
      ) as unknown as typeof fetch;

      await runTurn(
        job(),
        deps({
          ephemeral: ephemeral as unknown as RunTurnDeps["ephemeral"],
          fetchImpl,
        }),
      );

      const messages = ephemeral.publish.mock.calls.map(
        ([, event]) => event.message,
      );
      expect(messages).toContain("cloned: acme/foo");
      expect(messages).toContain("branched: langy/fix-retry");
    });
  });

  describe("given a command FAILS", () => {
    it("does not mark its step complete — a rejected push has not pushed", async () => {
      // The prose protocol could not tell the difference: the model printed
      // `[langy:progress:pushed]` before running the push, so a rejected push
      // still lit the step green. The tool stream carries `isError`.
      const ephemeral = makeEphemeral();
      const fetchImpl = vi.fn(async () =>
        ndjsonResponse([
          ...bashCall("1", "git push -u origin HEAD", {
            isError: true,
            output: "! [rejected] main -> main (fetch first)",
          }),
        ]),
      ) as unknown as typeof fetch;

      await runTurn(
        job(),
        deps({
          ephemeral: ephemeral as unknown as RunTurnDeps["ephemeral"],
          fetchImpl,
        }),
      );

      const stages = ephemeral.publish.mock.calls.map(
        ([, event]) => (event.message ?? "").split(":")[0],
      );
      expect(stages).not.toContain("pushed");
    });
  });

  describe("when gh pr create settles", () => {
    it("records the PR from the command's OWN stdout", async () => {
      const buffer = makeBuffer();
      const conversations = makeConversations();
      const fetchImpl = vi.fn(async () =>
        ndjsonResponse([
          ...bashCall("1", "gh pr create --fill", { output: PR_URL }),
          // The model's prose says nothing useful. It does not need to.
          delta("All done!"),
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

      expect(conversations.recordToolCallCompleted).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: "github.open_pr",
          toolCallId: "acme/foo#9",
        }),
      );
      expect(buffer.appendMilestone).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "pr_opened", detail: "acme/foo#9" }),
      );
    });

    it("consumes the reserved permit — a real PR was opened", async () => {
      const releaseSpy = vi.fn(async () => {});
      vi.doMock("~/server/middleware/rate-limit-langy-github-prs", () => ({
        releaseLangyGithubPrPermit: releaseSpy,
        recordExtraLangyGithubPrs: vi.fn(async () => {}),
      }));
      vi.resetModules();
      const { runTurn: freshRunTurn } = await import("../langy-turn.processor");

      const fetchImpl = vi.fn(async () =>
        ndjsonResponse([...bashCall("1", "gh pr create --fill", { output: PR_URL })]),
      ) as unknown as typeof fetch;

      await freshRunTurn(job(), deps({ fetchImpl }));

      expect(releaseSpy).not.toHaveBeenCalled();
      vi.doUnmock("~/server/middleware/rate-limit-langy-github-prs");
    });
  });

  describe("given the turn only TALKS about pull requests", () => {
    /** @scenario A PR merely mentioned never burns the cap or forges an audit row */
    it("counts nothing — prose is not a PR", async () => {
      // THE invariant. It used to be enforced by requiring an
      // `[langy:progress:opened:...]` sentinel alongside the URL in the reply,
      // which meant permit accounting trusted the model's typing. Now it holds
      // structurally: a URL the model merely wrote is not the stdout of a
      // `gh pr create`, so there is nothing to count. A read-only chat that
      // summarises twenty PRs cannot exhaust the daily cap or forge twenty audit
      // rows, no matter what it writes.
      const buffer = makeBuffer();
      const conversations = makeConversations();
      const releaseSpy = vi.fn(async () => {});
      vi.doMock("~/server/middleware/rate-limit-langy-github-prs", () => ({
        releaseLangyGithubPrPermit: releaseSpy,
        recordExtraLangyGithubPrs: vi.fn(async () => {}),
      }));
      vi.resetModules();
      const { runTurn: freshRunTurn } = await import("../langy-turn.processor");

      const fetchImpl = vi.fn(async () =>
        ndjsonResponse([
          ...bashCall("1", "gh pr list --limit 20"),
          delta(
            `Here are the open PRs: ${PR_URL}, https://github.com/acme/foo/pull/10. ` +
              // Even if the model tries to claim it opened one — in prose, or by
              // typing the retired marker verbatim — it is inert text now.
              "[langy:progress:opened:acme/foo#9] I opened #9 for you.",
          ),
        ]),
      ) as unknown as typeof fetch;

      await freshRunTurn(
        job(),
        deps({
          buffer: buffer as unknown as RunTurnDeps["buffer"],
          conversations: conversations as unknown as RunTurnDeps["conversations"],
          fetchImpl,
        }),
      );

      expect(conversations.recordToolCallCompleted).not.toHaveBeenCalledWith(
        expect.objectContaining({ toolName: "github.open_pr" }),
      );
      expect(buffer.appendMilestone).not.toHaveBeenCalled();
      // No PR opened => the reserved permit goes back.
      expect(releaseSpy).toHaveBeenCalledWith({ userId: "alice" });
      vi.doUnmock("~/server/middleware/rate-limit-langy-github-prs");
    });

    it("leaves a retired progress marker in the prose as inert text", async () => {
      // The same guard the connect half has: nothing in the model's text may
      // steer the UI, so nothing in it is stripped either.
      const conversations = makeConversations();
      const fetchImpl = vi.fn(async () =>
        ndjsonResponse([delta("The old marker [langy:progress:pushed] is retired.")]),
      ) as unknown as typeof fetch;

      await runTurn(
        job(),
        deps({
          conversations: conversations as unknown as RunTurnDeps["conversations"],
          fetchImpl,
        }),
      );

      const finalized = conversations.finalizeTurn.mock.calls[0]![0];
      const persisted =
        finalized.parts.find((part) => part.type === "text")?.text ?? "";
      expect(persisted).toContain("[langy:progress:pushed]");
    });
  });
});

/**
 * RICH PR EVENTS. `gh pr create` prints only a URL, and it has no `--json`. The
 * alternative was to make the SKILL run `gh pr view --json …` afterwards — which
 * needs the model to remember a second command. That is
 * model-cooperation-as-protocol, the trap this codebase has now deleted three
 * times, so instead the CONTROL PLANE calls GitHub itself with the user's token,
 * off the identity stdout just handed it.
 */
describe("runTurn (rich PR events)", () => {
  const PR_API_BODY = {
    html_url: PR_URL,
    title: "Fix the retriever",
    state: "open",
    draft: false,
    head: { ref: "langy/fix" },
    base: { ref: "main" },
    user: { login: "octocat" },
    additions: 38,
    deletions: 12,
    changed_files: 3,
  };

  /** Agent stream, then the GitHub API call the control plane makes itself. */
  function fetchWithGithub(apiResponse: () => Response) {
    let call = 0;
    return vi.fn(async (url: string) => {
      call++;
      if (call === 1) {
        return ndjsonResponse([
          ...bashCall("1", "gh pr create --fill", { output: PR_URL }),
        ]);
      }
      expect(String(url)).toContain("api.github.com/repos/acme/foo/pulls/9");
      return apiResponse();
    }) as unknown as typeof fetch;
  }

  /** The `github.open_pr` tool part the card is drawn from. */
  function persistedPrCard(conversations: ReturnType<typeof makeConversations>) {
    const finalized = conversations.finalizeTurn.mock.calls[0]![0];
    const part = finalized.parts.find(
      (p) => (p as { type: string }).type === "tool-github.open_pr",
    ) as unknown as { output: string } | undefined;
    return part ? JSON.parse(part.output) : null;
  }

  describe("when a PR opens", () => {
    it("enriches it from GitHub — title, branches, author, diff stat", async () => {
      const conversations = makeConversations();
      const fetchImpl = fetchWithGithub(
        () =>
          ({
            ok: true,
            json: async () => PR_API_BODY,
            body: null,
          }) as unknown as Response,
      );

      await runTurn(
        job(),
        deps({
          conversations: conversations as unknown as RunTurnDeps["conversations"],
          fetchImpl,
        }),
      );

      expect(persistedPrCard(conversations)).toMatchObject({
        owner: "acme",
        repo: "foo",
        number: 9,
        url: PR_URL,
        state: "open",
        title: "Fix the retriever",
        headRef: "langy/fix",
        baseRef: "main",
        author: "octocat",
        additions: 38,
        deletions: 12,
        changedFiles: 3,
      });
    });

    it("persists it as a TOOL PART, so the card survives a refresh", async () => {
      // The prose card never did: the sentinels it needed were stripped before
      // persistence. A tool part is stored with the message.
      const conversations = makeConversations();
      const fetchImpl = fetchWithGithub(
        () =>
          ({ ok: true, json: async () => PR_API_BODY, body: null }) as unknown as Response,
      );

      await runTurn(
        job(),
        deps({
          conversations: conversations as unknown as RunTurnDeps["conversations"],
          fetchImpl,
        }),
      );

      const finalized = conversations.finalizeTurn.mock.calls[0]![0];
      expect(
        finalized.parts.some(
          (p) => (p as { type: string }).type === "tool-github.open_pr",
        ),
      ).toBe(true);
    });

    it("marks a draft PR as a draft", async () => {
      const conversations = makeConversations();
      const fetchImpl = fetchWithGithub(
        () =>
          ({
            ok: true,
            json: async () => ({ ...PR_API_BODY, draft: true }),
            body: null,
          }) as unknown as Response,
      );

      await runTurn(
        job(),
        deps({
          conversations: conversations as unknown as RunTurnDeps["conversations"],
          fetchImpl,
        }),
      );

      expect(persistedPrCard(conversations).state).toBe("draft");
    });
  });

  describe("when the GitHub lookup fails", () => {
    /**
     * FAILURE HONESTY. An expired token, a repo gone private, a rate limit —
     * none of it means "no PR". The turn must not fail, and the card must show
     * what we KNOW (the identity, from stdout) rather than half-populating or
     * rendering an error where a pull request should be.
     */
    it("still records the PR, degraded to what stdout gave us", async () => {
      const conversations = makeConversations();
      const buffer = makeBuffer();
      const fetchImpl = fetchWithGithub(
        () => ({ ok: false, status: 401, body: null }) as unknown as Response,
      );

      await runTurn(
        job(),
        deps({
          conversations: conversations as unknown as RunTurnDeps["conversations"],
          buffer: buffer as unknown as RunTurnDeps["buffer"],
          fetchImpl,
        }),
      );

      // The turn completed, the PR is on record, and the card has the identity.
      expect(buffer.markError).not.toHaveBeenCalled();
      expect(persistedPrCard(conversations)).toEqual({
        owner: "acme",
        repo: "foo",
        number: 9,
        url: PR_URL,
        state: "open",
      });
      // And the permit is still consumed — a real PR was opened.
      expect(conversations.recordToolCallCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: "github.open_pr" }),
      );
    });

    it("does not fail the turn when GitHub throws outright", async () => {
      const conversations = makeConversations();
      const buffer = makeBuffer();
      let call = 0;
      const fetchImpl = vi.fn(async () => {
        call++;
        if (call === 1) {
          return ndjsonResponse([
            ...bashCall("1", "gh pr create --fill", { output: PR_URL }),
          ]);
        }
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch;

      await runTurn(
        job(),
        deps({
          conversations: conversations as unknown as RunTurnDeps["conversations"],
          buffer: buffer as unknown as RunTurnDeps["buffer"],
          fetchImpl,
        }),
      );

      expect(buffer.markError).not.toHaveBeenCalled();
      expect(persistedPrCard(conversations).number).toBe(9);
    });
  });
});
