/**
 * The shipped classifier's transport: what it retries, what it cuts, and what
 * it refuses.
 *
 * Driven through undici's `MockAgent` as the dispatcher, so the client's real
 * request is built and its real response handling runs — the only thing
 * replaced is the socket.
 *
 * @see ../jev.client.ts
 * @see specs/instant-evals/classifier.feature
 */

import { MockAgent } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estimateTokensFromBytes } from "~/shared/traces/tokenBudget";
import { InstantEvalClassifierUnavailableError } from "../../errors";
import type { InstantEvalQuestion } from "../classifier";
import { UnlimitedInstantEvalRateLimiter } from "../globalRateLimiter";
import { JEV_DEFAULT_BASE_URL, JevInstantEvalClassifier } from "../jev.client";
import { NullInstantEvalClassifier } from "../null.client";
import { instantEvalTextBudget } from "../token-budget";

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

function classifier() {
  return new JevInstantEvalClassifier({
    apiKey: "test-key",
    limiter: new UnlimitedInstantEvalRateLimiter(),
    dispatcher: agent,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
}

function endpoint() {
  return agent.get(JEV_DEFAULT_BASE_URL);
}

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  waits = [];
});

afterEach(async () => {
  await agent.close();
});

describe("given a classifier that answers", () => {
  describe("when a question is asked", () => {
    it("sends the key, the model and the question, and reads the verdict back", async () => {
      let sentBody = "";
      let sentAuthorization = "";
      endpoint()
        .intercept({ path: "/v1/systemone", method: "POST" })
        .reply(200, (options) => {
          sentBody = String(options.body);
          sentAuthorization = String(
            (options.headers as Record<string, string>).authorization,
          );
          return ANSWER;
        });

      const judgement = await classifier().classify({
        projectId: "project-1",
        text: "the customer wrote in again",
        questions: [QUESTION],
      });

      expect(sentAuthorization).toBe("Bearer test-key");
      expect(JSON.parse(sentBody)).toEqual({
        state: "the customer wrote in again",
        model: "jev-latest",
        questions: {
          annoyed: {
            type: "noul",
            instructions: "The customer sounds annoyed",
          },
        },
      });
      expect(judgement.verdicts).toEqual([
        { questionId: "annoyed", probability: 0.9 },
      ]);
      expect(judgement.inputTokens).toBe(120);
    });
  });
});

describe("given a classifier that is rate limiting", () => {
  describe("when it asks for a wait it will honour", () => {
    /** @scenario "A rate-limited request waits the interval the classifier asked for" */
    it("waits that long and then gets its answer", async () => {
      endpoint()
        .intercept({ path: "/v1/systemone", method: "POST" })
        .reply(429, "", { headers: { "retry-after": "2" } });
      endpoint()
        .intercept({ path: "/v1/systemone", method: "POST" })
        .reply(200, ANSWER);

      const judgement = await classifier().classify({
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
      endpoint()
        .intercept({ path: "/v1/systemone", method: "POST" })
        .reply(200, ANSWER);

      await classifier().classify({
        projectId: "project-1",
        text: "text",
        questions: [QUESTION],
      });

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

      const judgement = await classifier().classify({
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

describe("given a text the classifier refuses as too large", () => {
  describe("when it is refused once", () => {
    /** @scenario "A text the classifier refuses as too large is cut once and retried" */
    it("sends it again at three quarters of its length", async () => {
      const lengths: number[] = [];
      endpoint()
        .intercept({ path: "/v1/systemone", method: "POST" })
        .reply(400, (options) => {
          lengths.push(JSON.parse(String(options.body)).state.length);
          return TOO_LARGE;
        });
      endpoint()
        .intercept({ path: "/v1/systemone", method: "POST" })
        .reply(200, (options) => {
          lengths.push(JSON.parse(String(options.body)).state.length);
          return ANSWER;
        });

      const judgement = await classifier().classify({
        projectId: "project-1",
        text: "x".repeat(400),
        questions: [QUESTION],
      });

      expect(lengths).toEqual([400, 300]);
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

      const judgement = await classifier().classify({
        projectId: "project-1",
        text: "x".repeat(400),
        questions: [QUESTION],
      });

      expect(judgement.skippedReason).toBe("classifier_input_too_large");
    });
  });
});

describe("given a classifier that refuses the credential", () => {
  describe("when a question is asked", () => {
    /** @scenario "A refusal that is not retryable is not retried" */
    it("gives up at once and reports the classifier as unavailable", async () => {
      let attempts = 0;
      endpoint()
        .intercept({ path: "/v1/systemone", method: "POST" })
        .reply(401, () => {
          attempts += 1;
          return { detail: "unauthorized" };
        });

      await expect(
        classifier().classify({
          projectId: "project-1",
          text: "text",
          questions: [QUESTION],
        }),
      ).rejects.toBeInstanceOf(InstantEvalClassifierUnavailableError);
      expect(attempts).toBe(1);
    });
  });
});

describe("given a deployment with no classifier", () => {
  describe("when a question is asked", () => {
    /** @scenario "The null classifier answers every question as skipped" */
    it("skips it without sending anything", async () => {
      const judgement = await new NullInstantEvalClassifier().classify();

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
      // What `--target threads` now sends: `conversation(ConversationId)` with
      // no budget of its own, so a thread longer than the classifier's state
      // arrives here whole and the budget is the only thing that cuts it.
      const conversation = "a".repeat(400_000);
      let sentState = "";
      endpoint()
        .intercept({ path: "/v1/systemone", method: "POST" })
        .reply(200, (options) => {
          sentState = JSON.parse(String(options.body)).state;
          return ANSWER;
        });

      const judgement = await classifier().classify({
        projectId: "project-under-test",
        text: conversation,
        questions: [QUESTION],
      });

      // Cut rather than refused: the run judges the conversation it can see
      // instead of losing the row.
      expect(judgement.skippedReason).toBeUndefined();
      expect(judgement.verdicts).toHaveLength(1);
      expect(judgement.isTextTruncated).toBe(true);

      // And the cut happened before the send, so the request is inside the cap
      // rather than being refused by the API as max_tokens_exceeded.
      expect(sentState.length).toBeLessThan(conversation.length);
      expect(instantEvalTextBudget({ questions: [QUESTION] })).not.toBeNull();
      expect(estimateTokensFromBytes(sentState)).toBeLessThanOrEqual(
        instantEvalTextBudget({ questions: [QUESTION] }) ?? 0,
      );

      // This is the last-resort cut, for a text that reaches the classifier
      // already over budget. A conversation never arrives here that way: the
      // hydration stage re-renders one through the bounded renderer first,
      // which keeps both ends and names the turns it dropped
      // (../../../../analytics/lwql/appFunctions/hydration/evaluate.ts).
    });

    /** @scenario "A conversation inside the judge's state cap is sent whole and not marked truncated" */
    it("sends a conversation inside the cap whole", async () => {
      const conversation = "a".repeat(1_000);
      let sentState = "";
      endpoint()
        .intercept({ path: "/v1/systemone", method: "POST" })
        .reply(200, (options) => {
          sentState = JSON.parse(String(options.body)).state;
          return ANSWER;
        });

      const judgement = await classifier().classify({
        projectId: "project-under-test",
        text: conversation,
        questions: [QUESTION],
      });

      expect(judgement.isTextTruncated).toBe(false);
      expect(sentState).toBe(conversation);
    });
  });
});
