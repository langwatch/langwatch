/**
 * @vitest-environment node
 *
 * The thinking line may only say TRUE things.
 *
 * It used to cycle whimsical verbs on a timer for as long as a turn was open,
 * whether or not anything was happening. On a turn whose worker never spawned it
 * spent ninety-seven seconds claiming "Writing a TODO list…", "Calling one more
 * tool…", "Reading the whole file…" — while nothing was running and not one
 * token had arrived. That is not a cosmetic bug: it made a DEAD turn read as a
 * healthy one, and "Langy is slow" was chased for a whole session before anyone
 * noticed the turn had never started.
 *
 * These tests are the guarantee that it cannot happen again.
 */
import { describe, expect, it } from "vitest";
import { LANGY_THINKING_VERBS } from "../components/langyThinkingVerbs";
import {
  LANGY_AWAITING_ANSWER_LINE,
  LANGY_AWAITING_APPROVAL_TERMINAL_LINE,
  langyThinkingLine,
  langyTurnActivityKey,
  TEXT_QUIET_MS,
  THINKING_SLOW_MS,
  THINKING_STILL_STARTING_MS,
  THINKING_STUCK_MS,
} from "../logic/langyThinkingLine";

const assistant = (parts: unknown[]) => ({
  role: "assistant",
  parts: parts as never,
});
const user = { role: "user", parts: [{ type: "text", text: "hi" }] };

describe("langyThinkingLine", () => {
  describe("given a card holding the turn for the reader's answer", () => {
    /** @scenario "A turn held by a card says it is waiting for me" */
    it("says it is waiting for that answer, however long the card is open", () => {
      const messages = [user, assistant([])];

      for (const elapsedMs of [1_000, THINKING_SLOW_MS, THINKING_STUCK_MS]) {
        const line = langyThinkingLine({
          messages,
          elapsedMs,
          awaitingAnswer: true,
        });
        expect(line?.text).toBe(LANGY_AWAITING_ANSWER_LINE);
        expect(line?.tone).toBe("waiting");
        expect(line?.text).not.toContain("taking longer");
        expect(line?.text).not.toContain("stuck");
      }
    });

    it("outranks the tool the card is holding", () => {
      const line = langyThinkingLine({
        messages: [
          user,
          assistant([
            { type: "tool-local_bash", state: "input-available", input: {} },
          ]),
        ],
        elapsedMs: 1_000,
        awaitingAnswer: true,
      });
      expect(line?.text).toBe(LANGY_AWAITING_ANSWER_LINE);
    });
  });

  describe("given a card holding the turn and a folder shared from a terminal", () => {
    /** @scenario "The panel names the terminal while the ask is open there too" */
    it("names the terminal as well, because the same ask is open there", () => {
      const line = langyThinkingLine({
        messages: [user, assistant([])],
        elapsedMs: 1_000,
        awaitingAnswer: true,
        terminalConnected: true,
      });

      expect(line?.text).toBe("Answer on the card above or in the terminal.");
      expect(line?.tone).toBe("waiting");
    });

    /** @scenario "A permission ask open in the terminal says the approval is waited for there" */
    it("says the approval is waited for in the terminal when the card is a permission ask", () => {
      const line = langyThinkingLine({
        messages: [user, assistant([])],
        elapsedMs: 1_000,
        awaitingAnswer: true,
        awaitingPermission: true,
        terminalConnected: true,
      });

      expect(line?.text).toBe(LANGY_AWAITING_APPROVAL_TERMINAL_LINE);
      expect(line?.text).toBe("Waiting for your approval in the terminal");
      expect(line?.tone).toBe("waiting");
    });

    it("keeps the card line for a permission ask when no folder is shared", () => {
      const line = langyThinkingLine({
        messages: [user, assistant([])],
        elapsedMs: 1_000,
        awaitingAnswer: true,
        awaitingPermission: true,
      });
      expect(line?.text).toBe(LANGY_AWAITING_ANSWER_LINE);
    });

    it("names only the card when no folder is shared", () => {
      const line = langyThinkingLine({
        messages: [user, assistant([])],
        elapsedMs: 1_000,
        awaitingAnswer: true,
      });

      expect(line?.text).toBe(LANGY_AWAITING_ANSWER_LINE);
      expect(line?.text).not.toContain("terminal");
    });
  });

  describe("given a turn where NOTHING has happened", () => {
    /** The 97-second lie, in one test. */
    it("never invents work — it says the workspace is being prepared", () => {
      const line = langyThinkingLine({
        messages: [user, assistant([])],
        elapsedMs: 3_000,
      });
      expect(line?.text).toBe("Preparing Langy's workspace…");
      expect(line?.tone).toBe("waiting");
      // And CRUCIALLY: no cycling. Cycling reads as progress.
      expect(line?.allowWhimsy).toBe(false);
    });

    it("says thinking on a follow-up, never the startup ladder", () => {
      // The conversation has answered before, so its worker is alive and the
      // wait is the model working. "Preparing Langy's workspace…" here would
      // claim a boot that is not happening.
      const line = langyThinkingLine({
        messages: [
          user,
          assistant([{ type: "text", text: "Yes, how can I help?" }]),
          user,
        ],
        elapsedMs: 3_000,
      });
      expect(line?.text).toBe("Thinking…");
      expect(line?.tone).toBe("waiting");
      expect(line?.allowWhimsy).toBe(false);
    });

    /** @scenario A warmed fresh chat says Thinking from the first frame */
    it("says thinking on a first message whose worker a warm proved alive", () => {
      // The panel-open warm answered `warmed: true`, so the workspace the
      // startup ladder would claim to be preparing already exists.
      const line = langyThinkingLine({
        messages: [user, assistant([])],
        elapsedMs: 500,
        workerReady: true,
      });
      expect(line?.text).toBe("Thinking…");
      expect(line?.tone).toBe("waiting");
      expect(line?.allowWhimsy).toBe(false);
    });

    it("still escalates a warmed first message that stays silent too long", () => {
      const line = langyThinkingLine({
        messages: [user, assistant([])],
        elapsedMs: THINKING_STUCK_MS,
        workerReady: true,
      });
      expect(line?.text).toBe("Langy still has not answered. It may be stuck.");
      expect(line?.tone).toBe("stuck");
    });

    it("never reads the previous reply as the current turn's output", () => {
      // The last assistant overall is the PREVIOUS completed reply. Its text
      // used to make the line claim "Writing…" for a turn that had produced
      // nothing.
      const line = langyThinkingLine({
        messages: [
          user,
          assistant([{ type: "text", text: "Done, anything else?" }]),
          user,
        ],
        elapsedMs: 1_000,
      });
      expect(line?.text).not.toBe("Writing…");
      expect(line?.tone).toBe("waiting");
    });

    it("still escalates a follow-up that stays silent too long", () => {
      const messages = [
        user,
        assistant([{ type: "text", text: "Sure." }]),
        user,
      ];
      const slow = langyThinkingLine({
        messages,
        elapsedMs: THINKING_SLOW_MS,
      });
      expect(slow?.text).toBe("This is taking longer than usual…");
      const stuck = langyThinkingLine({
        messages,
        elapsedMs: THINKING_STUCK_MS,
      });
      expect(stuck?.tone).toBe("stuck");
    });

    it("moves to starting Langy once the workspace phase should be over", () => {
      const line = langyThinkingLine({
        messages: [user, assistant([])],
        elapsedMs: 7_000,
      });
      expect(line?.text).toBe("Starting Langy…");
      expect(line?.tone).toBe("waiting");
      expect(line?.allowWhimsy).toBe(false);
    });

    it("admits it is still starting once the silence stops being normal", () => {
      const line = langyThinkingLine({
        messages: [user],
        elapsedMs: THINKING_STILL_STARTING_MS,
      });
      expect(line?.text).toBe("Still starting up…");
      expect(line?.allowWhimsy).toBe(false);
    });

    it("says it is slow when it is slow", () => {
      const line = langyThinkingLine({
        messages: [user],
        elapsedMs: THINKING_SLOW_MS,
      });
      expect(line?.text).toContain("longer than usual");
      expect(line?.allowWhimsy).toBe(false);
    });

    it("eventually LOOKS STUCK, because it is", () => {
      // The line that would have saved a session: at 97s, with nothing on the
      // wire, the honest word is "stuck" — not "Reading the whole file".
      const line = langyThinkingLine({ messages: [user], elapsedMs: 97_000 });
      expect(line?.tone).toBe("stuck");
      expect(line?.text).toContain("stuck");
      expect(line?.allowWhimsy).toBe(false);
      expect(THINKING_STUCK_MS).toBeLessThan(97_000);
    });

    it("escalates monotonically — it never gets less worried with time", () => {
      const tones = [
        0,
        THINKING_STILL_STARTING_MS,
        THINKING_SLOW_MS,
        THINKING_STUCK_MS,
      ].map(
        (elapsedMs) => langyThinkingLine({ messages: [user], elapsedMs })?.tone,
      );
      expect(tones).toEqual(["waiting", "waiting", "waiting", "stuck"]);
    });
  });

  describe("given a tool that is actually running", () => {
    it("says what it really is, read off the tool stream", () => {
      const line = langyThinkingLine({
        messages: [
          user,
          assistant([
            {
              type: "tool-bash",
              state: "input-available",
              input: { command: "langwatch trace search --limit 4" },
            },
          ]),
        ],
        elapsedMs: 5_000,
      });
      expect(line?.tone).toBe("working");
      // The real command, not a guess about it.
      expect(line?.text.toLowerCase()).toContain("trace");
      expect(line?.allowWhimsy).toBe(false);
    });

    it("ignores a tool that has already settled — that is not what is running", () => {
      const line = langyThinkingLine({
        messages: [
          user,
          assistant([
            {
              type: "tool-bash",
              state: "output-available",
              input: { command: "langwatch trace search" },
            },
          ]),
        ],
        elapsedMs: 5_000,
      });
      // The settled call must not be narrated as though it were still running.
      expect(line?.text.toLowerCase()).not.toContain("trace");
    });

    it("never claims the turn is starting up once a tool has settled", () => {
      // The bug this pins: `elapsedMs` runs from the START of the turn, so the
      // gap BETWEEN two tool calls — nothing running, no tokens, no reasoning —
      // fell through to the startup ladder. The panel claimed a startup
      // directly beneath "4 actions completed".
      const line = langyThinkingLine({
        messages: [
          user,
          assistant([
            {
              type: "tool-bash",
              state: "output-available",
              input: { command: "langwatch analytics query" },
            },
          ]),
        ],
        elapsedMs: 5_000,
      });
      expect(line?.text).not.toContain("Starting");
      expect(line?.text).not.toContain("Preparing");
      expect(line?.tone).toBe("working");
    });
  });

  describe("given the model is genuinely generating", () => {
    /** @scenario The streaming answer replaces the thinking line */
    it("renders no line at all, the streaming answer speaks for itself", () => {
      // The prose is on screen right above where this line would sit, so a
      // second row under it read as the panel still waiting for the reply
      // that was visibly arriving.
      const line = langyThinkingLine({
        messages: [
          user,
          assistant([{ type: "text", text: "Here are 4 traces" }]),
        ],
        elapsedMs: 5_000,
        proseArriving: true,
      });
      expect(line).toBeNull();
    });

    it("does not go stuck while tokens are still arriving", () => {
      const line = langyThinkingLine({
        messages: [user, assistant([{ type: "text", text: "still writing" }])],
        elapsedMs: 200_000,
        proseArriving: true,
      });
      expect(line).toBeNull();
    });

    /** @scenario "The activity row returns once the text has been quiet for a second" */
    it("cycles the verbs once the text has gone quiet, because a pause is the model working", () => {
      const line = langyThinkingLine({
        messages: [
          user,
          assistant([{ type: "text", text: "Here is the first paragraph." }]),
        ],
        elapsedMs: 5_000,
        proseArriving: false,
      });
      expect(line?.tone).toBe("working");
      expect(line?.allowWhimsy).toBe(true);
      expect(line?.text).not.toContain("Starting");
      expect(TEXT_QUIET_MS).toBe(1_000);
    });
  });

  describe("given a tool running, named in the reader's words", () => {
    const running = (type: string, input: unknown) => [
      user,
      assistant([{ type, state: "input-available", input }]),
    ];

    /** @scenario "The activity row names the running work in my words" */
    it("names the act the reader is waiting on, not the mechanism", () => {
      const lines = (
        [
          ["tool-local_bash", { command: "pnpm test" }],
          ["tool-local_read", { path: "src/agent.ts" }],
          ["tool-local_grep", { pattern: "openai" }],
          ["tool-read", { file_path: "src/agent.ts" }],
          ["tool-local_edit", { path: "src/agent.ts" }],
          ["tool-write", { file_path: "src/agent.ts" }],
          ["tool-local_langwatch_env", {}],
          ["tool-skill", { name: "guided-onboarding" }],
          ["tool-bash", { command: "langwatch scenario create --title x" }],
        ] as const
      ).map(
        ([type, input]) =>
          langyThinkingLine({
            messages: running(type, input),
            elapsedMs: 5_000,
          })?.text,
      );
      expect(lines).toEqual([
        "Running the command in your terminal",
        "Reading the code",
        "Reading the code",
        "Reading the code",
        "Editing the code",
        "Editing the code",
        "Writing your LangWatch credentials",
        "Loading a skill",
        "Creating scenario",
      ]);
    });

    it("shows an unknown sandbox command as it is, never a guess about it", () => {
      const line = langyThinkingLine({
        messages: running("tool-bash", { command: "pnpm typecheck" }),
        elapsedMs: 5_000,
      });
      expect(line?.text).toBe("Running a command: pnpm typecheck");
      expect(line?.allowWhimsy).toBe(false);
    });

    /** @scenario "A turn adopted from the record still names its running tool" */
    it("reads the running tool off the turn's record when the message carries nothing", () => {
      const line = langyThinkingLine({
        messages: [user, assistant([])],
        elapsedMs: 5_000,
        toolCalls: [
          {
            toolCallId: "call-1",
            toolName: "local_bash",
            command: "pnpm test",
            status: "initiated",
          },
        ],
      });
      expect(line?.text).toBe("Running the command in your terminal");
      expect(line?.tone).toBe("working");
    });

    it("treats a record with only finished calls as the turn working between steps", () => {
      const line = langyThinkingLine({
        messages: [user, assistant([])],
        elapsedMs: 5_000,
        toolCalls: [
          { toolCallId: "call-1", toolName: "local_read", status: "succeeded" },
        ],
      });
      expect(line?.allowWhimsy).toBe(true);
      expect(line?.text).not.toContain("Starting");
    });
  });

  describe("given the model's reasoning is streaming live, with no prose and no tool yet", () => {
    it("says the model is thinking — never that Langy is still starting up", () => {
      // Reasoning deltas are live-edge only (they never become message parts),
      // so the messages look empty. The signal is what proves work is real.
      const line = langyThinkingLine({
        messages: [user, assistant([])],
        elapsedMs: 3_000,
        hasLiveReasoning: true,
      });
      expect(line?.text).toBe("Thinking…");
      expect(line?.tone).toBe("working");
      // The reasoning stream itself is the show — no whimsy cycling on top.
      expect(line?.allowWhimsy).toBe(false);
    });

    it("does not escalate to stuck while reasoning keeps arriving", () => {
      const line = langyThinkingLine({
        messages: [user, assistant([])],
        elapsedMs: 200_000,
        hasLiveReasoning: true,
      });
      expect(line?.tone).toBe("working");
    });

    it("lets a running tool win — the tool line is more specific than Thinking…", () => {
      const line = langyThinkingLine({
        messages: [
          user,
          assistant([
            {
              type: "tool-bash",
              state: "input-available",
              input: { command: "langwatch trace search --limit 4" },
            },
          ]),
        ],
        elapsedMs: 5_000,
        hasLiveReasoning: true,
      });
      expect(line?.text.toLowerCase()).toContain("trace");
    });
  });

  /**
   * The escalation used to run off the time since the line MOUNTED, so it
   * measured turn length. A turn that had answered a permission card and was
   * running a local command, with output arriving in the terminal, was told
   * "Langy still has not answered. It may be stuck." while nothing was wrong.
   *
   * The caller restarts its clock whenever this key changes, so what the
   * ladder measures is silence. These pin what counts as the turn making
   * progress.
   */
  describe("given the turn's own account of what it has produced", () => {
    const RUNNING_CALL = [{ toolCallId: "call-1", status: "running" }];

    /** @scenario "Work that never reaches the message still counts as progress" */
    it("changes when a tool call in the record starts or finishes", () => {
      const messages = [user, assistant([])];
      const before = langyTurnActivityKey({ messages });
      const running = langyTurnActivityKey({
        messages,
        toolCalls: RUNNING_CALL,
      });
      const finished = langyTurnActivityKey({
        messages,
        toolCalls: [{ toolCallId: "call-1", status: "succeeded" }],
      });
      expect(running).not.toBe(before);
      expect(finished).not.toBe(running);
    });

    it("changes when the developer answers a card", () => {
      const messages = [user, assistant([])];
      const pending = langyTurnActivityKey({
        messages,
        waits: [{ waitId: "wait-1", status: "pending" }],
      });
      const answered = langyTurnActivityKey({
        messages,
        waits: [{ waitId: "wait-1", status: "answered" }],
      });
      expect(answered).not.toBe(pending);
    });

    it("changes when a plan step moves on", () => {
      const messages = [user, assistant([])];
      const before = langyTurnActivityKey({
        messages,
        planItems: [
          { content: "One", status: "in_progress" },
          { content: "Two", status: "pending" },
        ],
      });
      const after = langyTurnActivityKey({
        messages,
        planItems: [
          { content: "One", status: "completed" },
          { content: "Two", status: "in_progress" },
        ],
      });
      expect(after).not.toBe(before);
    });

    it("changes as reasoning and prose arrive", () => {
      const messages = [user, assistant([])];
      const quiet = langyTurnActivityKey({ messages });
      expect(langyTurnActivityKey({ messages, reasoning: "so far" })).not.toBe(
        quiet,
      );
      expect(
        langyTurnActivityKey({
          messages: [user, assistant([{ type: "text", text: "Here" }])],
        }),
      ).not.toBe(quiet);
      expect(
        langyTurnActivityKey({
          messages: [user, assistant([{ type: "text", text: "Here are 4" }])],
        }),
      ).not.toBe(
        langyTurnActivityKey({
          messages: [user, assistant([{ type: "text", text: "Here" }])],
        }),
      );
    });

    it("holds still while nothing happens, so real silence still escalates", () => {
      const messages = [user, assistant([])];
      const activity = {
        messages,
        toolCalls: RUNNING_CALL,
        planItems: [{ content: "One", status: "in_progress" }],
        reasoning: "a thought",
      };
      expect(langyTurnActivityKey(activity)).toBe(
        langyTurnActivityKey(activity),
      );
    });

    /** @scenario "The escalation measures silence, not how long the turn has run" */
    it("keeps a long-running turn off the stuck line once its clock restarts", () => {
      // What the caller does with the key: the elapsed time it passes is the
      // silence since the key last changed, so a turn twenty minutes old that
      // did something a moment ago reads as working, not as stuck.
      const messages = [
        user,
        assistant([{ type: "text", text: "Sure." }]),
        user,
      ];
      const silentTooLong = langyThinkingLine({
        messages,
        elapsedMs: THINKING_STUCK_MS,
      });
      expect(silentTooLong?.tone).toBe("stuck");

      const justDidSomething = langyThinkingLine({ messages, elapsedMs: 500 });
      expect(justDidSomething?.tone).not.toBe("stuck");
      expect(justDidSomething?.text).not.toContain("longer than usual");
    });

    /** @scenario "A turn that really is silent still ends up looking stuck" */
    it("still escalates a turn that has produced nothing at all", () => {
      const messages = [user, assistant([])];
      // Nothing to fingerprint, so the clock never restarts and the silence is
      // the whole turn.
      expect(langyTurnActivityKey({ messages })).toBe(
        langyTurnActivityKey({ messages }),
      );
      const line = langyThinkingLine({
        messages,
        elapsedMs: THINKING_STUCK_MS,
      });
      expect(line?.tone).toBe("stuck");
      expect(line?.text).toContain("stuck");
    });
  });

  describe("the whimsy pool itself", () => {
    /**
     * The pool is only ever shown while the model is genuinely thinking, so a
     * verb may joke about Langy's CHARACTER but must never CLAIM AN ACT.
     * "Bribing the GPUs" is a joke. "Reading the whole file" is a false
     * statement — and it was the one we told for 97 seconds.
     */
    it("contains no verb that claims work Langy might not be doing", () => {
      const claims = [
        "Writing a TODO list",
        "Calling one more tool",
        "Reading the whole file",
        "Chasing a span",
        "Untangling a trace",
        "Tailing the spans",
        "Counting the tokens",
        "Evaluating the eval",
      ];
      for (const claim of claims) {
        expect(LANGY_THINKING_VERBS, claim).not.toContain(claim);
      }
    });

    /** @scenario "The activity row cycles a verb while Langy works between steps" */
    it("shows Thinking more often than any other verb, and never twice in a row", () => {
      const counts = new Map<string, number>();
      for (const verb of LANGY_THINKING_VERBS) {
        counts.set(verb, (counts.get(verb) ?? 0) + 1);
      }
      const thinking = counts.get("Thinking") ?? 0;
      for (const [verb, count] of counts) {
        if (verb !== "Thinking") expect(count, verb).toBeLessThan(thinking);
      }
      for (let i = 1; i < LANGY_THINKING_VERBS.length; i++) {
        expect(LANGY_THINKING_VERBS[i]).not.toBe(LANGY_THINKING_VERBS[i - 1]);
      }
      expect(LANGY_THINKING_VERBS).toContain("Crunching");
      expect(LANGY_THINKING_VERBS).toContain("Langying");
    });
  });

  /**
   * The page Langy is driving holds a better truth than the turn does. While
   * it applies an action or streams a run's cells, it knows which column and
   * how far along, and the turn knows only that the agent is blocked on a
   * poll. Filming the optimization loop is what made the gap plain: minutes of
   * "Cooking…" over a page that was busy the whole time.
   */
  describe("given the open page reports what it is doing", () => {
    const RUN = "Running Version A — 12 of 20 rows";

    /** @scenario "A run streaming into the page names the column and the progress" */
    it("says it, and never a whimsical verb over it", () => {
      const line = langyThinkingLine({
        messages: [user, assistant([])],
        elapsedMs: 3_000,
        pageActivity: RUN,
      });
      expect(line?.text).toBe(RUN);
      expect(line?.tone).toBe("working");
      expect(line?.allowWhimsy).toBe(false);
    });

    /** @scenario "Page activity wins over the command the agent is blocked on" */
    it("outranks the tool the agent is blocked on", () => {
      const messages = [
        user,
        assistant([
          {
            type: "tool-bash",
            state: "input-available",
            input: {
              command: "sleep 45; langwatch experiment status NSFVA4mN",
            },
          },
        ]),
      ];
      const withoutPage = langyThinkingLine({ messages, elapsedMs: 3_000 });
      expect(withoutPage?.text).not.toBe(RUN);

      const line = langyThinkingLine({
        messages,
        elapsedMs: 3_000,
        pageActivity: RUN,
      });
      expect(line?.text).toBe(RUN);
    });

    /** @scenario "Page activity survives the turn falling quiet between steps" */
    it("outranks the between-steps thinking line", () => {
      const messages = [
        user,
        assistant([{ type: "tool-bash", state: "output-available" }]),
      ];
      expect(langyThinkingLine({ messages, elapsedMs: 3_000 })?.text).toBe(
        "Thinking…",
      );
      expect(
        langyThinkingLine({ messages, elapsedMs: 3_000, pageActivity: RUN })
          ?.text,
      ).toBe(RUN);
    });

    /** @scenario "A finished run releases the line" */
    it("goes back to the turn's own signals once the page falls silent", () => {
      const messages = [user, assistant([])];
      const line = langyThinkingLine({
        messages,
        elapsedMs: 3_000,
        pageActivity: null,
      });
      expect(line?.text).toBe("Preparing Langy's workspace…");
    });

    /** @scenario "A page with nothing to report leaves the line to the turn" */
    it("ignores an empty report rather than rendering a blank line", () => {
      const line = langyThinkingLine({
        messages: [user, assistant([])],
        elapsedMs: 3_000,
        pageActivity: "   ",
      });
      expect(line?.text).toBe("Preparing Langy's workspace…");
    });
  });
});
