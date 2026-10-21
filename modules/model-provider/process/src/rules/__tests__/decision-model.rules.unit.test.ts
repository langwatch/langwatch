import { describe, expect, it } from "vitest";

import { decisionModelResolutionOf, picksOwnDecisionModel } from "../decision-model.rules.ts";

const CLEF = "cloudflare/decisions:clef";

describe("decisionModelResolutionOf", () => {
  /** @scenario "An unset column runs on LangWatch Instant Preview" */
  it("answers langwatch when nothing is stored", () => {
    expect(
      decisionModelResolutionOf({ model: undefined, isOwnModelAllowed: true, row: undefined }),
    ).toEqual({ kind: "langwatch" });
  });

  it("answers langwatch for the hosted entry", () => {
    expect(
      decisionModelResolutionOf({
        model: "langwatch/instant-evals",
        isOwnModelAllowed: true,
        row: undefined,
      }),
    ).toEqual({ kind: "langwatch" });
  });

  /** @scenario "An own decision model with a key resolves with its endpoint and key" */
  it("fills the account id into the endpoint and carries the key", () => {
    const resolved = decisionModelResolutionOf({
      model: CLEF,
      isOwnModelAllowed: true,
      row: {
        enabled: true,
        customKeys: { CLOUDFLARE_ACCOUNT_ID: "acct 1", CLOUDFLARE_API_TOKEN: "token" },
      },
    });

    expect(resolved).toEqual({
      kind: "own",
      model: CLEF,
      wire: "cloudflare_jev",
      providerModel: "clef",
      endpoint: "https://api.cloudflare.com/client/v4/accounts/acct%201/ai/run/@cf/cloudflare/clef",
      apiKey: "token",
    });
  });

  /** @scenario "An own decision model with no provider row cannot run" */
  it("answers provider_missing without a row", () => {
    expect(
      decisionModelResolutionOf({
        model: "inception/decisions:mercury-decide",
        isOwnModelAllowed: true,
        row: undefined,
      }),
    ).toEqual({
      kind: "own_unavailable",
      model: "inception/decisions:mercury-decide",
      reason: "provider_missing",
    });
  });

  /** @scenario "An own decision model whose row is switched off cannot run" */
  it("answers provider_disabled for a switched-off row", () => {
    const resolved = decisionModelResolutionOf({
      model: "perplexity/decisions:pplx-decider-v1.2",
      isOwnModelAllowed: true,
      row: { enabled: false, customKeys: { PERPLEXITY_API_KEY: "key" } },
    });

    expect(resolved).toMatchObject({ kind: "own_unavailable", reason: "provider_disabled" });
  });

  /** @scenario "An own decision model with no key cannot run" */
  it("answers key_missing when the account id is absent", () => {
    const resolved = decisionModelResolutionOf({
      model: CLEF,
      isOwnModelAllowed: true,
      row: { enabled: true, customKeys: { CLOUDFLARE_API_TOKEN: "token" } },
    });

    expect(resolved).toMatchObject({ kind: "own_unavailable", reason: "key_missing" });
  });

  describe("when the flag is off", () => {
    it("answers not_enabled rather than the billed classifier", () => {
      const resolved = decisionModelResolutionOf({
        model: "openai/decisions:gpt-6-luna",
        isOwnModelAllowed: false,
        row: { enabled: true, customKeys: { OPENAI_API_KEY: "key" } },
      });

      expect(resolved).toMatchObject({ kind: "own_unavailable", reason: "not_enabled" });
    });
  });
});

describe("picksOwnDecisionModel", () => {
  it("is true for a newly picked own model", () => {
    expect(picksOwnDecisionModel({ config: { INSTANT_EVALS: CLEF } })).toBe(true);
  });

  it("is false for a value kept as it was", () => {
    expect(
      picksOwnDecisionModel({
        config: { INSTANT_EVALS: CLEF, FAST: "openai/gpt-5.4-mini" },
        stored: { INSTANT_EVALS: CLEF },
      }),
    ).toBe(false);
  });

  it("is false for the hosted model", () => {
    expect(picksOwnDecisionModel({ config: { INSTANT_EVALS: "langwatch/instant-evals" } })).toBe(
      false,
    );
  });
});
