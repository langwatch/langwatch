import {
  readClassifierVerdicts,
  type InstantEvalQuestion,
} from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import {
  decisionFailureOf,
  decisionRequestBodyOf,
  parseDecisionResponse,
} from "../instant-eval-decision-wire.rules.ts";

const QUESTIONS: InstantEvalQuestion[] = [
  { id: "polite", kind: "boolean", instructions: "Is it polite?", criteria: ["kind", "rude"] },
  { id: "quality", kind: "score", instructions: "Rate it", range: { min: 1, max: 3 } },
  {
    id: "topic",
    kind: "category",
    instructions: "Which topic?",
    options: [
      { name: "billing", description: "Money" },
      { name: "other", description: "Anything else" },
    ],
  },
];

describe("decisionRequestBodyOf", () => {
  describe("when the wire is OpenAI Decisions", () => {
    /** @scenario "OpenAI Decisions questions are sent as named questions and read back by name" */
    it("sends each question named, as a predicate, score or choice", () => {
      const body = decisionRequestBodyOf({
        wire: "openai_decisions",
        providerModel: "gpt-6-luna",
        text: "hello",
        questions: QUESTIONS,
      });

      expect(body).toEqual({
        model: "gpt-6-luna",
        input: "hello",
        questions: [
          {
            type: "predicate",
            name: "polite",
            instructions: "Is it polite?\nTrue when: kind\nFalse when: rude",
          },
          {
            type: "score",
            name: "quality",
            instructions: "Rate it",
            levels: [{ label: "1" }, { label: "2" }, { label: "3" }],
          },
          {
            type: "choice",
            name: "topic",
            instructions: "Which topic?",
            choices: [
              { value: "billing", description: "Money" },
              { value: "other", description: "Anything else" },
            ],
          },
        ],
      });
    });
  });

  describe("when the wire is the Jev body", () => {
    it("sends the state and the questions keyed by id", () => {
      const body = decisionRequestBodyOf({
        wire: "jev",
        providerModel: "mercury-decide",
        text: "hello",
        questions: QUESTIONS,
      });

      expect(body).toMatchObject({
        model: "mercury-decide",
        state: "hello",
        questions: {
          polite: { type: "noul" },
          quality: { type: "score" },
          topic: { type: "choice" },
        },
      });
    });
  });
});

describe("parseDecisionResponse", () => {
  /** @scenario "OpenAI Decisions questions are sent as named questions and read back by name" */
  it("reads OpenAI's named answers back into verdicts", () => {
    const response = parseDecisionResponse({
      wire: "openai_decisions",
      body: {
        model: "gpt-6-luna",
        answers: [
          { type: "predicate", name: "polite", probability: 0.9 },
          {
            type: "score",
            name: "quality",
            score: 2,
            confidence: 0.8,
            probabilities: [
              { value: 0, label: "1", probability: 0 },
              { value: 1, label: "2", probability: 0 },
              { value: 2, label: "3", probability: 1 },
            ],
          },
          {
            type: "choice",
            name: "topic",
            choice: "billing",
            confidence: 0.7,
            probabilities: [
              { value: "billing", probability: 0.7 },
              { value: "other", probability: 0.3 },
            ],
          },
        ],
        usage: { input_tokens: 42 },
      },
    });

    expect(response).toBeDefined();
    expect(readClassifierVerdicts({ questions: QUESTIONS, response: response! })).toEqual([
      { questionId: "polite", probability: 0.9 },
      { questionId: "quality", score: 3 },
      { questionId: "topic", label: "billing", probabilities: { billing: 0.7, other: 0.3 } },
    ]);
  });

  it("drops a refused question and keeps the rest", () => {
    const response = parseDecisionResponse({
      wire: "openai_decisions",
      body: {
        answers: [
          { type: "refusal", name: "polite" },
          { type: "choice", name: "topic", choice: "other" },
        ],
      },
    });

    expect(Object.keys(response?.answers ?? {})).toEqual(["topic"]);
  });

  /** @scenario "Cloudflare's answer is read from inside its result envelope" */
  it("unwraps Cloudflare's result envelope", () => {
    const response = parseDecisionResponse({
      wire: "cloudflare_jev",
      body: {
        success: true,
        errors: [],
        result: { answers: { polite: { type: "noul", noul: 0.2 } } },
      },
    });

    expect(response?.answers.polite?.noul).toBe(0.2);
  });

  it("answers undefined for a body that is not the provider's shape", () => {
    expect(parseDecisionResponse({ wire: "jev", body: { nope: true } })).toBeUndefined();
  });
});

describe("decisionFailureOf", () => {
  it.each([
    [401, "final", "classifier_key_invalid"],
    [402, "final", "classifier_key_invalid"],
    [403, "final", "classifier_key_invalid"],
    [413, "final", "classifier_input_too_large"],
    [422, "final", "classifier_failed"],
    [429, "retry", "classifier_rate_limited"],
    [503, "retry", "classifier_provider_unavailable"],
  ] as const)("maps %i to a %s %s", (status, kind, reason) => {
    expect(decisionFailureOf({ status })).toEqual({ kind, reason });
  });
});
