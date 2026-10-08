/**
 * The copy a customer reads when Instant Evals have no judge (ADR-174 decision 14): it points at
 * Connect, never at a key of one's own.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { explainSerializedError } from "@langwatch/handled-error/presentation";
import { describe, expect, it } from "vitest";

import {
  InstantEvalClassifierNotConfiguredError,
  InstantEvalOptInNotOfferedError,
} from "../instant-eval.errors.ts";

const ASKS_FOR_A_KEY = /\b(add|set|setting|adding|supply|provide|use)\b[^.]*\bkey\b/i;
const OWN_KEY = /\b(own|its|their)\b[^.]{0,20}\bkey\b/i;

describe("the self-hosted switch refusal copy", () => {
  /** @scenario "The self-hosted switch refusal names Connect and never a key of one's own" */
  it("names Connect and a license, and never a key of the install's own", () => {
    const error = new InstantEvalOptInNotOfferedError({ deployment: "self_hosted" });
    const { description } = explainSerializedError(error.serialize());
    const tips = error.tips ?? [];

    expect(tips.join(" ")).toMatch(/Connect/);
    expect(description).toMatch(/Connect/);
    expect(description).toMatch(/license/);
    for (const line of [error.message, ...tips, description]) {
      expect(line).not.toMatch(OWN_KEY);
      expect(line).not.toMatch(ASKS_FOR_A_KEY);
      expect(line).not.toContain("JEV_API_KEY");
    }
  });
});

describe("the not configured copy", () => {
  /** @scenario "The not configured copy never asks for a key of one's own" */
  it("never asks for a key of one's own, in the tip, the message or the customer copy", () => {
    const error = new InstantEvalClassifierNotConfiguredError();
    const { title, description } = explainSerializedError(error.serialize());
    const copy = [error.message, ...(error.tips ?? []), title, description];

    expect(description).toContain("connect it to LangWatch");
    for (const line of copy) {
      expect(line).not.toMatch(ASKS_FOR_A_KEY);
      expect(line).not.toContain("JEV_API_KEY");
    }
  });
});
