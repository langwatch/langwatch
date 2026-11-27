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

  describe("when the wire is Gemini Decisions", () => {
    /** @scenario "Gemini Decisions questions are sent keyed by id and read back by id" */
    it("sends the text as input, each question by id, and the sides as descriptions", () => {
      const body = decisionRequestBodyOf({
        wire: "gemini_decisions",
        providerModel: "gemini-decision-1",
        text: "hello",
        questions: QUESTIONS,
      });

      expect(body).toEqual({
        model: "gemini-decision-1",
        input: "hello",
        questions: {
          polite: {
            type: "noul",
            instructions: "Is it polite?",
            criteria: { true_description: "kind", false_description: "rude" },
          },
          quality: { type: "score", instructions: "Rate it", criteria: ["1", "2", "3"] },
          topic: {
            type: "choice",
            instructions: "Which topic?",
            criteria: { billing: "Money", other: "Anything else" },
          },
        },
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
      { questionId: "quality", score: 3, spread: 0 },
      { questionId: "topic", label: "billing", probabilities: { billing: 0.7, other: 0.3 } },
    ]);
  });

  /** @scenario "A decision-model leg is billed for its output tokens too" */
  it("keeps the output tokens OpenAI reports beside the input tokens", () => {
    const response = parseDecisionResponse({
      wire: "openai_decisions",
      body: {
        answers: [{ type: "predicate", name: "polite", probability: 0.9 }],
        usage: { input_tokens: 42, output_tokens: 7 },
      },
    });

    expect(response?.usage).toEqual({ input_tokens: 42, output_tokens: 7 });
  });

  /** @scenario "Gemini Decisions questions are sent keyed by id and read back by id" */
  it("reads Gemini's answers by id, with the input tokens it reports", () => {
    const response = parseDecisionResponse({
      wire: "gemini_decisions",
      body: {
        answers: {
          polite: { type: "noul", noul: 0.99, confidence: 0.99 },
          topic: {
            type: "choice",
            choice: "billing",
            probabilities: { billing: 0.8, other: 0.2 },
            confidence: 0.8,
          },
        },
        usage: {
          total_input_tokens: 100,
          input_tokens_by_modality: [{ modality: "text", tokens: 100 }],
          total_output_tokens: 0,
          total_tokens: 100,
        },
      },
    });

    expect(response).toBeDefined();
    expect(response?.usage).toEqual({ input_tokens: 100, output_tokens: 0 });
    expect(
      readClassifierVerdicts({
        questions: QUESTIONS.filter((question) => question.id !== "quality"),
        response: response!,
      }),
    ).toEqual([
      { questionId: "polite", probability: 0.99 },
      { questionId: "topic", label: "billing", probabilities: { billing: 0.8, other: 0.2 } },
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
    [404, "final", "classifier_failed"],
    [413, "final", "classifier_input_too_large"],
    [422, "final", "classifier_failed"],
    [429, "retry", "classifier_rate_limited"],
    [503, "retry", "classifier_provider_unavailable"],
  ] as const)("maps %i on LangWatch's key to a %s %s", (status, kind, reason) => {
    expect(decisionFailureOf({ status, isOwnModel: false })).toEqual({ kind, reason });
  });

  /** @scenario "A model or deployment the account does not hold is skipped as not configured" */
  it("maps an own model's 404 to a final classifier_not_configured, not a failure", () => {
    expect(decisionFailureOf({ status: 404, isOwnModel: true })).toEqual({
      kind: "final",
      reason: "classifier_not_configured",
    });
  });
});
