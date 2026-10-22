/**
 * An own decision model's transport: what it retries, what it names, and that it never reads
 * the provider's error text. Driven through undici's MockAgent; only the socket is replaced.
 * @see specs/model-providers/instant-evals-decision-model.feature
 */

import type {
  InstantEvalOwnDecisionModel,
  InstantEvalQuestion,
} from "@langwatch/instant-eval-judge-contract";
import { MockAgent } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HttpInstantEvalDecisionModelChannel } from "../http/http.instant-eval-decision-model.channel.ts";

const ORIGIN = "https://api.inceptionlabs.ai";
const PATH = "/v1/decisions";

const MODEL: InstantEvalOwnDecisionModel = {
  model: "inception/decisions:mercury-decide",
  wire: "jev",
  providerModel: "mercury-decide",
  endpoint: `${ORIGIN}${PATH}`,
  apiKey: "customer-key",
};

const QUESTION: InstantEvalQuestion = {
  id: "annoyed",
  kind: "boolean",
  instructions: "The customer sounds annoyed",
};

let agent: MockAgent;
let waits: number[];

function channel() {
  return HttpInstantEvalDecisionModelChannel.create({
    dispatcher: agent,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  });
}

function classify() {
  return channel().classify({ text: "I am fed up", questions: [QUESTION], decisionModel: MODEL });
}

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
  waits = [];
});

afterEach(async () => {
  await agent.close();
});

describe("HttpInstantEvalDecisionModelChannel", () => {
  describe("when the provider answers", () => {
    /** @scenario "An own decision model's answer bills nothing to LangWatch" */
    it("reads the verdict and reports no billed tokens", async () => {
      agent
        .get(ORIGIN)
        .intercept({ path: PATH, method: "POST" })
        .reply(200, {
          answers: { annoyed: { type: "noul", noul: 0.8 } },
          usage: { input_tokens: 99 },
        });

      const judgement = await classify();

      expect(judgement.verdicts).toEqual([{ questionId: "annoyed", probability: 0.8 }]);
      expect(judgement.inputTokens).toBe(0);
      expect(judgement.skippedReason).toBeUndefined();
    });

    it("sends the organization's key", async () => {
      let authorization: unknown;
      agent
        .get(ORIGIN)
        .intercept({ path: PATH, method: "POST" })
        .reply(200, (request) => {
          authorization = (request.headers as Record<string, string>).authorization;
          return { answers: {} };
        });

      await classify();

      expect(authorization).toBe("Bearer customer-key");
    });
  });

  describe("when a local stack names a stand-in origin", () => {
    it("sends the catalogue path to that origin instead of the provider", async () => {
      const standIn = "http://127.0.0.1:21000";
      agent
        .get(standIn)
        .intercept({ path: PATH, method: "POST" })
        .reply(200, { answers: { annoyed: { type: "noul", noul: 0.3 } } });

      const judgement = await HttpInstantEvalDecisionModelChannel.create({
        dispatcher: agent,
        baseUrl: standIn,
      }).classify({ text: "I am fed up", questions: [QUESTION], decisionModel: MODEL });

      expect(judgement.verdicts).toEqual([{ questionId: "annoyed", probability: 0.3 }]);
    });
  });

  describe("when the key is refused", () => {
    /** @scenario "A refused key is not retried and names the key as the reason" */
    it("skips as classifier_key_invalid after one attempt", async () => {
      agent
        .get(ORIGIN)
        .intercept({ path: PATH, method: "POST" })
        .reply(401, { error: { message: "sk-live-secret is not valid" } });

      const judgement = await classify();

      expect(judgement.skippedReason).toBe("classifier_key_invalid");
      expect(waits).toEqual([]);
      expect(JSON.stringify(judgement)).not.toContain("sk-live-secret");
    });
  });

  describe("when the provider rate limits every attempt", () => {
    /** @scenario "A rate limited provider is retried, then named as rate limited" */
    it("retries, then skips as classifier_rate_limited", async () => {
      agent
        .get(ORIGIN)
        .intercept({ path: PATH, method: "POST" })
        .reply(429, {}, { headers: { "retry-after": "1" } })
        .times(3);

      const judgement = await classify();

      expect(judgement.skippedReason).toBe("classifier_rate_limited");
      expect(waits).toEqual([1_000, 1_000]);
    });
  });

  describe("when the provider is down on every attempt", () => {
    /** @scenario "A provider outage is retried, then named as unavailable" */
    it("retries, then skips as classifier_provider_unavailable", async () => {
      agent.get(ORIGIN).intercept({ path: PATH, method: "POST" }).reply(503, {}).times(3);

      const judgement = await classify();

      expect(judgement.skippedReason).toBe("classifier_provider_unavailable");
      expect(waits).toHaveLength(2);
    });
  });

  describe("when the provider answers with an unreadable body", () => {
    it("skips as classifier_provider_unavailable", async () => {
      agent.get(ORIGIN).intercept({ path: PATH, method: "POST" }).reply(200, { unexpected: true });

      const judgement = await classify();

      expect(judgement.skippedReason).toBe("classifier_provider_unavailable");
    });
  });
});
