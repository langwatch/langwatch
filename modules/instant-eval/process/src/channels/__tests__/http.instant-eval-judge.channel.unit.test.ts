/**
 * The shipped judge's transport: what it retries, what it cuts, what it
 * refuses. Driven through undici's MockAgent, so the real request is built
 * and the real response handling runs; only the socket is replaced.
 * @see specs/instant-evals/classifier.feature
 */

import {
  INSTANT_EVAL_CLASSIFIER_LIMITS,
  InstantEvalClassifierUnavailableError,
  type InstantEvalQuestion,
} from "@langwatch/instant-eval-contract";
import { MockAgent } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  estimateJudgedTextTokens,
  estimateTokensFromBytes,
  instantEvalQuestionTokens,
  instantEvalTextBudget,
} from "../../rules/instant-eval-token-budget.rules.ts";
import {
  HttpInstantEvalJudgeChannel,
  JEV_DEFAULT_BASE_URL,
} from "../http/http.instant-eval-judge.channel.ts";
import type {
  InstantEvalPermit,
  InstantEvalRateLimiterChannel,
} from "../instant-eval-judge.channel.ts";
import {
  MemoryInstantEvalJudgeChannel,
  MemoryInstantEvalRateLimiterChannel,
} from "../memory/memory.instant-eval-judge.channel.ts";

const QUESTION: InstantEvalQuestion = {
  id: "annoyed",
  kind: "boolean",
  instructions: "The customer sounds annoyed",
};

const ANSWER = {
  model: "jev-1.13.0",
  answers: { annoyed: { type: "noul", noul: 0.9 } },
  usage: { input_tokens: 120, output_tokens: 4 },
};

const TOO_LARGE = { detail: { error_type: "max_tokens_exceeded" } };

let agent: MockAgent;
let waits: number[];

function judge(
  limiter: InstantEvalRateLimiterChannel = MemoryInstantEvalRateLimiterChannel.create(),
) {
  return HttpInstantEvalJudgeChannel.create({
    apiKey: "test-key",
    limiter,
    dispatcher: agent,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  });
}

const endpoint = () => agent.get(JEV_DEFAULT_BASE_URL);

/** The request body the mock hands back, which is a string for every send here. */
const sentText = (body: unknown): string => (typeof body === "string" ? body : "");

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  waits = [];
});

afterEach(async () => {
  await agent.close();
});

describe("given a judge that answers", () => {
  describe("when a question is asked", () => {
    it("sends the key, the model and the question, and reads the verdict back", async () => {
      let sentBody = "";
      let sentAuthorization = "";
      endpoint()
        .intercept({ path: "/v1/systemone", method: "POST" })
        .reply(200, (options) => {
          sentBody = sentText(options.body);
          sentAuthorization = String(Object(options.headers).authorization);
          return ANSWER;
        });

      const judgement = await judge().classify({
        projectId: "project-1",
        text: "the customer wrote in again",
        questions: [QUESTION],
      });

      expect(sentAuthorization).toBe("Bearer test-key");
      expect(JSON.parse(sentBody)).toEqual({
        state: "the customer wrote in again",
        model: "jev-latest",
        questions: { annoyed: { type: "noul", instructions: "The customer sounds annoyed" } },
      });
      expect(judgement.verdicts).toEqual([{ questionId: "annoyed", probability: 0.9 }]);
      expect(judgement.inputTokens).toBe(120);
    });
  });
});

describe("given a judge that is rate limiting", () => {
  describe("when it asks for a wait it will honour", () => {
    /** @scenario "A rate-limited request waits the interval the classifier asked for" */
    it("waits that long and then gets its answer", async () => {
      endpoint()
        .intercept({ path: "/v1/systemone", method: "POST" })
        .reply(429, "", { headers: { "retry-after": "2" } });
      endpoint().intercept({ path: "/v1/systemone", method: "POST" }).reply(200, ANSWER);

      const judgement = await judge().classify({
        projectId: "project-1",
        text: "text",
        questions: [QUESTION],
      });

      expect(waits).toEqual([2_000]);
      expect(judgement.verdicts).toHaveLength(1);
    });
  });

  describe("when it asks for a wait past the cap", () => {
    /** @scenario "A Retry-After longer than the cap waits the cap instead" */
    it("waits the cap rather than the interval it was given", async () => {
      endpoint()
        .intercept({ path: "/v1/systemone", method: "POST" })
        .reply(429, "", { headers: { "retry-after": "300" } });
      endpoint().intercept({ path: "/v1/systemone", method: "POST" }).reply(200, ANSWER);

      await judge().classify({ projectId: "project-1", text: "text", questions: [QUESTION] });

      expect(waits).toEqual([30_000]);
    });
  });

  describe("when it never lets up", () => {
    /** @scenario "A request gives up after the fifth attempt" */
    it("tries five times and then skips the text", async () => {
      let attempts = 0;
      endpoint()
        .intercept({ path: "/v1/systemone", method: "POST" })
        .reply(429, () => {
          attempts += 1;
          return "";
        })
        .times(5);

      const judgement = await judge().classify({
        projectId: "project-1",
        text: "text",
        questions: [QUESTION],
      });

      expect(attempts).toBe(5);
      expect(judgement.skippedReason).toBe("classifier_rate_limited");
      expect(judgement.verdicts).toEqual([]);
    });
  });
});

describe("given a judge that keeps failing with no Retry-After", () => {
  describe("when every attempt answers 500", () => {
    /** @scenario "A failing request backs off longer on each attempt" */
    it("doubles the wait between attempts", async () => {
      endpoint()
        .intercept({ path: "/v1/systemone", method: "POST" })
        .reply(500, "upstream down")
        .times(5);

      const judgement = await judge().classify({
        projectId: "project-1",
        text: "text",
        questions: [QUESTION],
      });

      expect(waits).toEqual([1_000, 2_000, 4_000, 8_000]);
      expect(judgement.skippedReason).toBe("classifier_failed");
    });
  });
});

describe("given a limiter that records what each permit asks for", () => {
  describe("when a text is classified", () => {
    /** @scenario "A classification takes its estimated tokens from one bucket shared by every pod" */
    it("takes the tokens the request will really carry, not the generic estimate", async () => {
      const permits: InstantEvalPermit[] = [];
      const limiter: InstantEvalRateLimiterChannel = {
        acquire: async (permit) => {
          permits.push(permit);
        },
      };
      endpoint().intercept({ path: "/v1/systemone", method: "POST" }).reply(200, ANSWER);
      const text = "User: where is my order\nAssistant: let me check\n".repeat(40);

      await judge(limiter).classify({ projectId: "project-1", text, questions: [QUESTION] });

      const expected = estimateJudgedTextTokens({ text }) + instantEvalQuestionTokens([QUESTION]);

      expect(permits).toEqual([{ tokens: expected, tenantId: "project-1" }]);
      expect(expected).toBeGreaterThan(
        estimateTokensFromBytes(text) + instantEvalQuestionTokens([QUESTION]),
      );
    });
  });
});

describe("given a text the judge refuses as too large", () => {
  describe("when it is refused once", () => {
    /** @scenario "A text the classifier refuses as too large is cut once and retried" */
    it("sends it again at three quarters of its length, keeping both ends", async () => {
      const sent: string[] = [];
      endpoint()
        .intercept({ path: "/v1/systemone", method: "POST" })
        .reply(400, (options) => {
          sent.push(JSON.parse(sentText(options.body)).state);
          return TOO_LARGE;
        });
      endpoint()
        .intercept({ path: "/v1/systemone", method: "POST" })
        .reply(200, (options) => {
          sent.push(JSON.parse(sentText(options.body)).state);
          return ANSWER;
        });

      const judgement = await judge().classify({
        projectId: "project-1",
        text: `OPENING ${"x".repeat(385)} ENDING`,
        questions: [QUESTION],
      });

      expect(sent.map((text) => text.length)).toEqual([400, expect.any(Number)]);
      expect(sent[1]!.length).toBeLessThan(400);
      expect(sent[1]!.length).toBeLessThanOrEqual(300);
      expect(sent[1]!.startsWith("OPENING")).toBe(true);
      expect(sent[1]!.endsWith("ENDING")).toBe(true);
      expect(judgement.verdicts).toHaveLength(1);
      expect(judgement.isTextTruncated).toBe(true);
    });
  });

  describe("when it is refused twice", () => {
    /** @scenario "A text refused twice as too large is skipped rather than cut again" */
    it("skips the text rather than cutting it a second time", async () => {
      endpoint()
        .intercept({ path: "/v1/systemone", method: "POST" })
        .reply(400, TOO_LARGE)
        .times(2);

      const judgement = await judge().classify({
        projectId: "project-1",
        text: "x".repeat(400),
        questions: [QUESTION],
      });

      expect(judgement.skippedReason).toBe("classifier_input_too_large");
    });
  });
});

/**
 * A support transcript as the extraction functions render it: turn headings,
 * prose, and tool calls with JSON arguments and results. About 250 KB.
 */
function longSupportTranscript(): string {
  const turns: string[] = ["## User (2026-09-20T10:00:00.000Z)\nI want a refund for order 1234."];
  for (let i = 0; i < 700; i++) {
    turns.push(
      `## Assistant (2026-09-20T10:${String(i % 60).padStart(2, "0")}:00.000Z)\n` +
        `Let me check order ${1000 + i} for you.\n\n### Tool call search_orders\n` +
        "```json\n" +
        JSON.stringify({ order_id: 1000 + i, include: ["lines", "payments", "refunds"] }) +
        "\n```\n\n### Tool result\n```json\n" +
        JSON.stringify({
          id: 1000 + i,
          status: "processing",
          lines: [{ sku: `SKU-${i}-A`, qty: 1, price_cents: 1999 }],
          payments: [{ id: `pay_${i}`, amount_cents: 1999, method: "card" }],
        }) +
        "\n```",
    );
  }
  turns.push(
    "## Assistant (2026-09-20T11:00:00.000Z)\nYour refund for order 1234 was issued today.",
  );
  return turns.join("\n\n");
}

/**
 * A judge that counts the state at `bytesPerToken` and refuses it past the
 * state cap less the questions, as the live API does.
 */
function judgeCountingAt(bytesPerToken: number, sent: string[]) {
  const capBytes =
    (INSTANT_EVAL_CLASSIFIER_LIMITS.stateTokens - instantEvalQuestionTokens([QUESTION])) *
    bytesPerToken;
  for (let send = 0; send < 3; send++) {
    endpoint()
      .intercept({ path: "/v1/systemone", method: "POST" })
      .reply((options) => {
        const state: string = JSON.parse(sentText(options.body)).state;
        sent.push(state);
        const fits = new TextEncoder().encode(state).length <= capBytes;
        const data: object = fits ? ANSWER : TOO_LARGE;
        return { statusCode: fits ? 200 : 400, data };
      });
  }
}

describe("given a long transcript that tokenises densely", () => {
  describe("when it is judged at the densest measured ratio", () => {
    /** @scenario "A long transcript that tokenises densely is judged on the first send" */
    it("fits on the first send and marks the row truncated", async () => {
      const sent: string[] = [];
      judgeCountingAt(INSTANT_EVAL_CLASSIFIER_LIMITS.fitBytesPerInputToken, sent);
      const transcript = longSupportTranscript();

      const judgement = await judge().classify({
        projectId: "project-1",
        text: transcript,
        questions: [QUESTION],
      });

      expect(new TextEncoder().encode(transcript).length).toBeGreaterThan(200_000);
      expect(sent).toHaveLength(1);
      expect(judgement.skippedReason).toBeUndefined();
      expect(judgement.verdicts).toHaveLength(1);
      expect(judgement.isTextTruncated).toBe(true);
      expect(sent[0]!.endsWith("Your refund for order 1234 was issued today.")).toBe(true);
    });
  });

  describe("when the judge counts it denser than any measured ratio", () => {
    /** @scenario "The too-large retry cuts enough for a text denser than any measured" */
    it("is refused once, then the retry fits and the verdict comes back", async () => {
      const sent: string[] = [];
      judgeCountingAt(1.7, sent);

      const judgement = await judge().classify({
        projectId: "project-1",
        text: longSupportTranscript(),
        questions: [QUESTION],
      });

      expect(sent).toHaveLength(2);
      expect(judgement.skippedReason).toBeUndefined();
      expect(judgement.verdicts).toHaveLength(1);
      expect(judgement.isTextTruncated).toBe(true);
    });
  });
});

describe("given a judge that refuses the credential", () => {
  describe("when a question is asked", () => {
    /** @scenario "A refusal that is not retryable is not retried" */
    it("gives up at once and reports the judge as unavailable", async () => {
      let attempts = 0;
      endpoint()
        .intercept({ path: "/v1/systemone", method: "POST" })
        .reply(401, () => {
          attempts += 1;
          return { detail: "unauthorized" };
        });

      await expect(
        judge().classify({ projectId: "project-1", text: "text", questions: [QUESTION] }),
      ).rejects.toBeInstanceOf(InstantEvalClassifierUnavailableError);
      expect(attempts).toBe(1);
    });
  });
});

describe("given a deployment with no judge", () => {
  describe("when a question is asked", () => {
    /** @scenario "The null classifier answers every question as skipped" */
    it("skips it without sending anything", async () => {
      const judgement = await MemoryInstantEvalJudgeChannel.create().classify();

      expect(judgement).toEqual({
        verdicts: [],
        skippedReason: "classifier_not_configured",
        inputTokens: 0,
        isTextTruncated: false,
      });
    });
  });
});

describe("given an unbounded conversation larger than the judge takes", () => {
  describe("when it is judged", () => {
    /** @scenario "An unbounded conversation past the judge's state cap is cut to the budget and marked truncated" */
    it("cuts it to the budget, answers, and marks the row truncated", async () => {
      const conversation = "a".repeat(400_000);
      let sentState = "";
      endpoint()
        .intercept({ path: "/v1/systemone", method: "POST" })
        .reply(200, (options) => {
          sentState = JSON.parse(sentText(options.body)).state;
          return ANSWER;
        });

      const judgement = await judge().classify({
        projectId: "project-under-test",
        text: conversation,
        questions: [QUESTION],
      });

      expect(judgement.skippedReason).toBeUndefined();
      expect(judgement.verdicts).toHaveLength(1);
      expect(judgement.isTextTruncated).toBe(true);
      expect(sentState.length).toBeLessThan(conversation.length);
      expect(estimateTokensFromBytes(sentState)).toBeLessThanOrEqual(
        instantEvalTextBudget({ questions: [QUESTION] }),
      );
    });

    /** @scenario "A conversation inside the judge's state cap is sent whole and not marked truncated" */
    it("sends a conversation inside the cap whole", async () => {
      const conversation = "a".repeat(1_000);
      let sentState = "";
      endpoint()
        .intercept({ path: "/v1/systemone", method: "POST" })
        .reply(200, (options) => {
          sentState = JSON.parse(sentText(options.body)).state;
          return ANSWER;
        });

      const judgement = await judge().classify({
        projectId: "project-under-test",
        text: conversation,
        questions: [QUESTION],
      });

      expect(judgement.isTextTruncated).toBe(false);
      expect(sentState).toBe(conversation);
    });
  });
});
