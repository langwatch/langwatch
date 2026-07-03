import { describe, expect, it } from "vitest";
import {
  blockCategoryCostAttr,
  blockCategoryTokensAttr,
  InputCategory,
} from "../../block-classification/categories";
import type { CodingAgentHarness } from "../../block-classification/harnessDetection";
import {
  detectCompactionEvents,
  rollupSessions,
  type SessionRollupTraceInput,
} from "../sessionRollup.service";
import {
  SESSION_HARNESS_ATTR,
  SESSION_STEPS_ATTR,
  type SessionStep,
} from "../sessionSteps";

/**
 * Build a lean trace-summary input the way the fold leaves it: harness marker,
 * thread id, the JSON step series, and any per-category blockcat totals.
 */
function makeTrace({
  harness,
  threadId,
  steps = [],
  categoryTotals = {},
}: {
  harness: CodingAgentHarness;
  threadId: string;
  steps?: SessionStep[];
  categoryTotals?: Partial<Record<string, { tokens: number; costUsd: number }>>;
}): SessionRollupTraceInput {
  const attributes: Record<string, string> = {
    [SESSION_HARNESS_ATTR]: harness,
    "langwatch.thread.id": threadId,
    [SESSION_STEPS_ATTR]: JSON.stringify(steps),
  };
  for (const [category, total] of Object.entries(categoryTotals)) {
    if (!total) continue;
    attributes[blockCategoryTokensAttr(category as never)] = String(
      total.tokens,
    );
    attributes[blockCategoryCostAttr(category as never)] = String(
      total.costUsd,
    );
  }
  return { attributes };
}

const stepsOf = (...inputs: number[]): SessionStep[] =>
  inputs.map((inputTokens, i) => ({ startMs: i * 1000, inputTokens }));

describe("rollupSessions", () => {
  describe("given multiple coding-agent traces sharing one session id", () => {
    describe("when they are rolled up", () => {
      it("counts every step and sums the per-category cost totals", () => {
        const traces = [
          makeTrace({
            harness: "claude",
            threadId: "sess-1",
            steps: stepsOf(1000, 2000),
            categoryTotals: {
              [InputCategory.SYSTEM_PROMPT]: { tokens: 100, costUsd: 0.001 },
            },
          }),
          makeTrace({
            harness: "claude",
            threadId: "sess-1",
            steps: stepsOf(3000),
            categoryTotals: {
              [InputCategory.SYSTEM_PROMPT]: { tokens: 40, costUsd: 0.0004 },
            },
          }),
        ];

        const [view, ...rest] = rollupSessions({ traces });

        expect(rest).toHaveLength(0);
        expect(view!.stepCount).toBe(3);
        expect(view!.categoryTotals[InputCategory.SYSTEM_PROMPT]).toEqual({
          tokens: 140,
          costUsd: expect.closeTo(0.0014, 9),
        });
      });
    });
  });

  describe("given a session whose steps arrive out of chronological order", () => {
    describe("when it is rolled up", () => {
      /** @scenario "Steps are ordered by start time regardless of arrival order" */
      it("orders the context-growth sequence by span start time", () => {
        const traces = [
          makeTrace({
            harness: "codex",
            threadId: "sess-x",
            steps: [
              { startMs: 3000, inputTokens: 30 },
              { startMs: 1000, inputTokens: 10 },
            ],
          }),
          makeTrace({
            harness: "codex",
            threadId: "sess-x",
            steps: [{ startMs: 2000, inputTokens: 20 }],
          }),
        ];

        const [view] = rollupSessions({ traces });

        expect(view!.steps.map((s) => s.startMs)).toEqual([1000, 2000, 3000]);
        expect(view!.steps.map((s) => s.inputTokens)).toEqual([10, 20, 30]);
      });
    });
  });

  describe("given a session that grows, drops sharply, then grows from the lower base", () => {
    describe("when it is rolled up", () => {
      it("records one compaction event", () => {
        const traces = [
          makeTrace({
            harness: "claude",
            threadId: "sess-c",
            steps: stepsOf(
              10_000,
              50_000,
              100_000,
              150_000,
              180_000,
              60_000,
              65_000,
              70_000,
            ),
          }),
        ];

        const [view] = rollupSessions({ traces });

        expect(view!.compactionEvents).toBe(1);
      });
    });
  });

  describe("given large main-thread steps with one small interleaved subagent step", () => {
    describe("when it is rolled up", () => {
      it("records no compaction event", () => {
        const traces = [
          makeTrace({
            harness: "claude",
            threadId: "sess-p",
            steps: [
              { startMs: 1000, inputTokens: 150_000 },
              { startMs: 2000, inputTokens: 180_000 },
              // interleaved small subagent step
              { startMs: 3000, inputTokens: 8_000 },
              { startMs: 4000, inputTokens: 185_000 },
            ],
          }),
        ];

        const [view] = rollupSessions({ traces });

        expect(view!.compactionEvents).toBe(0);
      });
    });
  });

  describe("given a Claude session and a Codex session in the same project", () => {
    describe("when they are rolled up", () => {
      /** @scenario "Sessions from different harnesses are keyed independently" */
      it("keys each view by its own harness session id and does not mix steps", () => {
        const traces = [
          makeTrace({
            harness: "claude",
            threadId: "shared-id",
            steps: stepsOf(1000, 2000),
          }),
          makeTrace({
            harness: "codex",
            threadId: "shared-id",
            steps: stepsOf(9000),
          }),
        ];

        const views = rollupSessions({ traces });

        expect(views).toHaveLength(2);
        const claude = views.find((v) => v.harness === "claude");
        const codex = views.find((v) => v.harness === "codex");
        expect(claude!.stepCount).toBe(2);
        expect(codex!.stepCount).toBe(1);
        // Same thread-id string, different harness → independent sessions.
        expect(claude!.threadId).toBe("shared-id");
        expect(codex!.threadId).toBe("shared-id");
      });
    });
  });

  describe("given codex traces sharing a session but with per-turn conversation ids", () => {
    it("re-joins them into one session by the stable thread id, not the per-turn id", () => {
      // Codex stamps gen_ai.conversation.id with a fresh PER-TURN id and the
      // stable session id onto langwatch.thread.id. Preferring the conversation
      // id (as the Claude path does) would fragment the codex session into one
      // bucket per turn, defeating the rollup. So codex must key on thread.id.
      const codexTurn = (
        turnId: string,
        step: number,
      ): SessionRollupTraceInput => ({
        attributes: {
          [SESSION_HARNESS_ATTR]: "codex",
          "langwatch.thread.id": "codex-session-1",
          "gen_ai.conversation.id": turnId,
          [SESSION_STEPS_ATTR]: JSON.stringify(stepsOf(step)),
        },
      });

      const views = rollupSessions({
        traces: [codexTurn("turn-a", 1000), codexTurn("turn-b", 2000)],
      });

      expect(views).toHaveLength(1);
      expect(views[0]!.threadId).toBe("codex-session-1");
      expect(views[0]!.stepCount).toBe(2);
    });
  });

  describe("given a trace with no harness marker or thread id", () => {
    describe("when it is rolled up", () => {
      it("is skipped and produces no session view", () => {
        const traces: SessionRollupTraceInput[] = [
          { attributes: { "gen_ai.request.model": "claude-sonnet-4" } },
        ];
        expect(rollupSessions({ traces })).toHaveLength(0);
      });
    });
  });

  describe("given the log-path thread id under gen_ai.conversation.id", () => {
    describe("when it is rolled up", () => {
      it("keys the session by the conversation id fallback", () => {
        const traces: SessionRollupTraceInput[] = [
          {
            attributes: {
              [SESSION_HARNESS_ATTR]: "codex",
              "gen_ai.conversation.id": "conv-9",
              [SESSION_STEPS_ATTR]: JSON.stringify(stepsOf(5000)),
            },
          },
        ];
        const [view] = rollupSessions({ traces });
        expect(view!.threadId).toBe("conv-9");
        expect(view!.stepCount).toBe(1);
      });
    });
  });

  describe("given a trace carrying both thread ids with disagreeing values", () => {
    describe("when it is rolled up", () => {
      it("keys by the semconv-stable gen_ai.conversation.id, not langwatch.thread.id", () => {
        // A disagreement must resolve to ONE session, not split into two buckets.
        const [view] = rollupSessions({
          traces: [
            {
              attributes: {
                [SESSION_HARNESS_ATTR]: "claude",
                "gen_ai.conversation.id": "conv-canonical",
                "langwatch.thread.id": "thread-other",
                [SESSION_STEPS_ATTR]: JSON.stringify(stepsOf(5000)),
              },
            },
          ],
        });
        expect(view!.threadId).toBe("conv-canonical");
      });
    });
  });

  describe("given a whitespace-only thread id", () => {
    describe("when it is rolled up", () => {
      it("is treated as absent — no phantom mega-session", () => {
        expect(
          rollupSessions({
            traces: [
              {
                attributes: {
                  [SESSION_HARNESS_ATTR]: "claude",
                  "langwatch.thread.id": "   ",
                  [SESSION_STEPS_ATTR]: JSON.stringify(stepsOf(5000)),
                },
              },
            ],
          }),
        ).toHaveLength(0);
      });
    });
  });

  describe("given a trace whose blockcat totals carry a negative value", () => {
    describe("when it is rolled up", () => {
      it("drops the negative rather than subtracting it from the session total", () => {
        const [view] = rollupSessions({
          traces: [
            makeTrace({
              harness: "claude",
              threadId: "s1",
              steps: stepsOf(1000),
              categoryTotals: {
                system_prompt: { tokens: -50, costUsd: -0.01 },
                user_input: { tokens: 100, costUsd: 0.02 },
              },
            }),
          ],
        });
        expect(view!.categoryTotals.system_prompt).toBeUndefined();
        expect(view!.categoryTotals.user_input).toEqual({
          tokens: 100,
          costUsd: 0.02,
        });
      });
    });
  });
});

describe("detectCompactionEvents", () => {
  describe("given an empty or single-step series", () => {
    it("returns zero events", () => {
      expect(detectCompactionEvents({ steps: [] }).events).toBe(0);
      expect(detectCompactionEvents({ steps: stepsOf(100_000) }).events).toBe(
        0,
      );
    });
  });

  describe("given steadily growing steps", () => {
    it("returns zero events", () => {
      expect(
        detectCompactionEvents({
          steps: stepsOf(10_000, 40_000, 90_000, 150_000, 200_000),
        }).events,
      ).toBe(0);
    });
  });

  describe("given a confirmed re-base below the running max", () => {
    it("counts one event once two subsequent steps stay below the old max", () => {
      expect(
        detectCompactionEvents({
          steps: stepsOf(200_000, 60_000, 65_000, 70_000),
        }).events,
      ).toBe(1);
    });
  });

  describe("given a drop with only one confirming step before the size returns", () => {
    it("counts no event — the drop is unconfirmed noise", () => {
      expect(
        detectCompactionEvents({
          steps: stepsOf(200_000, 60_000, 210_000),
        }).events,
      ).toBe(0);
    });
  });

  describe("given a main-thread turn interleaved with subagent steps then resumed", () => {
    // The dominant coding-agent pattern (ADR-033 Decision 5): a big main-thread
    // turn, several tiny subagent steps under the same session id, then the main
    // thread resuming near its original size. None is a compaction — the context
    // was never re-based. The old below-old-max confirmation false-fired on all
    // three; the near-the-compacted-floor confirmation must read them as 0.
    it("counts no event when the resume is two steps out", () => {
      expect(
        detectCompactionEvents({
          steps: stepsOf(200_000, 8_000, 10_000, 190_000),
        }).events,
      ).toBe(0);
    });

    it("counts no event when the resume is three steps out", () => {
      expect(
        detectCompactionEvents({
          steps: stepsOf(200_000, 8_000, 10_000, 12_000, 190_000),
        }).events,
      ).toBe(0);
    });

    it("counts no event when the resume is four steps out", () => {
      expect(
        detectCompactionEvents({
          steps: stepsOf(200_000, 8_000, 10_000, 12_000, 14_000, 190_000),
        }).events,
      ).toBe(0);
    });

    it("counts no event when a real candidate is confirmed only by sub-floor subagent steps", () => {
      // 100k IS a measurement-grade candidate (above the subagent floor), but the
      // only steps before the main thread resumes at 200k are sub-floor subagent
      // calls (8k, 8.5k) — not context measurements. The context was never
      // re-based, so the confirmation window must skip them and read a recovery.
      expect(
        detectCompactionEvents({
          steps: stepsOf(200_000, 100_000, 8_000, 8_500, 200_000),
        }).events,
      ).toBe(0);
    });

    it("counts no event when a candidate is followed only by one sub-floor step at end of session", () => {
      // A candidate (100k) then a lone subagent step (8k), then the session ends
      // — the end-of-session rule must require at least one measurement-grade
      // confirmer, which a sub-floor step is not.
      expect(
        detectCompactionEvents({ steps: stepsOf(200_000, 100_000, 8_000) })
          .events,
      ).toBe(0);
    });
  });

  describe("given a genuine compaction at the very end of a session", () => {
    it("counts the event even with fewer than the full confirmation window left", () => {
      // User compacts (200k → 40k), checks the summary (45k), closes the
      // terminal. A real event that must not be dropped just for running out of
      // confirmation runway — one confirming step that stays compacted is enough.
      expect(
        detectCompactionEvents({ steps: stepsOf(200_000, 40_000, 45_000) })
          .events,
      ).toBe(1);
    });
  });

  describe("given two separate confirmed re-bases", () => {
    it("counts both events", () => {
      expect(
        detectCompactionEvents({
          steps: stepsOf(
            // grow, compact, confirm, grow, compact, confirm
            100_000,
            200_000,
            60_000,
            65_000,
            70_000,
            180_000,
            40_000,
            45_000,
            50_000,
          ),
        }).events,
      ).toBe(2);
    });
  });

  describe("given shallow dips that stay above the drop threshold", () => {
    it("counts no event", () => {
      // Every dip is ≥ 65% of the 200k max — above the (1 − 0.4) = 60%
      // threshold (120k), so none is even a candidate drop.
      expect(
        detectCompactionEvents({
          steps: stepsOf(200_000, 130_000, 125_000, 122_000),
        }).events,
      ).toBe(0);
    });
  });

  describe("given a plateaued session with zero-token steps mixed in", () => {
    it("skips the zeros and records no event", () => {
      // Without the defensive zero-skip, each 0 is below every drop threshold
      // and the trailing zeros confirm it — a phantom compaction. Filtering
      // zero-input steps leaves a flat 100k plateau: no drop, no event.
      expect(
        detectCompactionEvents({
          steps: stepsOf(100_000, 0, 0, 0),
        }).events,
      ).toBe(0);
      expect(
        detectCompactionEvents({
          steps: stepsOf(100_000, 100_000, 0, 100_000, 100_000),
        }).events,
      ).toBe(0);
    });
  });
});

describe("accumulateCategoryTotals (via rollupSessions)", () => {
  describe("given a trace carrying an unknown blockcat category suffix", () => {
    it("skips the unknown category and keeps the known ones", () => {
      const traces: SessionRollupTraceInput[] = [
        {
          attributes: {
            [SESSION_HARNESS_ATTR]: "claude",
            "langwatch.thread.id": "sess-cats",
            [SESSION_STEPS_ATTR]: JSON.stringify(stepsOf(1000)),
            [blockCategoryTokensAttr(InputCategory.SYSTEM_PROMPT)]: "100",
            [blockCategoryCostAttr(InputCategory.SYSTEM_PROMPT)]: "0.001",
            // Not a member of the CATEGORIES enum — must be ignored.
            "langwatch.reserved.blockcat.bogus_category.tokens": "999",
            "langwatch.reserved.blockcat.bogus_category.cost_usd": "9.99",
          },
        },
      ];

      const [view] = rollupSessions({ traces });

      expect(view!.categoryTotals[InputCategory.SYSTEM_PROMPT]).toEqual({
        tokens: 100,
        costUsd: expect.closeTo(0.001, 9),
      });
      expect(
        (view!.categoryTotals as Record<string, unknown>).bogus_category,
      ).toBeUndefined();
    });
  });
});
