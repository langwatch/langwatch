import { describe, expect, it } from "vitest";

import { decisionModelResolutionOf, picksOwnDecisionModel } from "../decision-model.rules.ts";

const CLEF = "cloudflare/decisions:clef";

describe("decisionModelResolutionOf", () => {
  /** @scenario "An unset column runs on LangWatch Evals Preview" */
  it("answers langwatch when nothing is stored", () => {
    expect(decisionModelResolutionOf({ model: undefined, row: undefined })).toEqual({
      kind: "langwatch",
    });
  });

  it("answers langwatch for the hosted entry", () => {
    expect(
      decisionModelResolutionOf({
        model: "langwatch/instant-evals",
        row: undefined,
      }),
    ).toEqual({ kind: "langwatch" });
  });

  /** @scenario "An own decision model with a key resolves with its endpoint and key" */
  it("fills the account id into the endpoint and carries the key", () => {
    const resolved = decisionModelResolutionOf({
      model: CLEF,
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
      authHeader: "bearer",
      apiKey: "token",
    });
  });

  /** @scenario "An own decision model with no provider row cannot run" */
  it("answers provider_missing without a row", () => {
    expect(
      decisionModelResolutionOf({
        model: "inception/decisions:mercury-decide",
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
      row: { enabled: false, customKeys: { PERPLEXITY_API_KEY: "key" } },
    });

    expect(resolved).toMatchObject({ kind: "own_unavailable", reason: "provider_disabled" });
  });

  /** @scenario "An own decision model with no key cannot run" */
  it("answers key_missing when the account id is absent", () => {
    const resolved = decisionModelResolutionOf({
      model: CLEF,
      row: { enabled: true, customKeys: { CLOUDFLARE_API_TOKEN: "token" } },
    });

    expect(resolved).toMatchObject({ kind: "own_unavailable", reason: "key_missing" });
  });
  describe("given an Azure decision model", () => {
    const AZURE_DECISIONS = "azure/decisions:gpt-6-luna";
    const DECISION_1 = "azure/decisions:microsoft-decision-1";
    const azureRow = (customKeys: Record<string, string>) => ({ enabled: true, customKeys });

    /** @scenario "An Azure decision model is sent to the project's own Azure resource" */
    it("builds the endpoint from the row's resource and sends the key as api-key", () => {
      const resolved = decisionModelResolutionOf({
        model: AZURE_DECISIONS,
        row: azureRow({
          AZURE_OPENAI_API_KEY: "azure-key",
          AZURE_OPENAI_ENDPOINT: "https://Acme-East.openai.azure.com/",
        }),
      });

      expect(resolved).toEqual({
        kind: "own",
        model: AZURE_DECISIONS,
        wire: "openai_decisions",
        providerModel: "gpt-6-luna",
        endpoint: "https://acme-east.openai.azure.com/openai/v1/decisions",
        authHeader: "api_key",
        apiKey: "azure-key",
      });
    });

    /** @scenario "An Azure decision model is sent to the project's own Azure resource" */
    it("sends Microsoft Decision 1 to the same resource's Foundry host, under its deployment name", () => {
      const resolved = decisionModelResolutionOf({
        model: DECISION_1,
        row: azureRow({
          AZURE_OPENAI_API_KEY: "azure-key",
          AZURE_OPENAI_ENDPOINT: "https://acme.cognitiveservices.azure.com",
          AZURE_DECISION_1_DEPLOYMENT: "decider-prod",
        }),
      });

      expect(resolved).toMatchObject({
        kind: "own",
        wire: "jev",
        providerModel: "decider-prod",
        endpoint: "https://acme.services.ai.azure.com/providers/microsoft/v1/systemone",
        authHeader: "api_key",
      });
    });

    /** @scenario "An Azure key is never sent to a host outside Azure" */
    it.each([
      ["a gateway in front of Azure", "https://llm-gateway.acme.example/openai"],
      ["a lookalike domain", "https://acme.openai.azure.com.evil.example"],
      ["plain http", "http://acme.openai.azure.com"],
      ["a custom port", "https://acme.openai.azure.com:8443"],
      ["credentials in the URL", "https://user@acme.openai.azure.com"],
      ["not a URL", "acme"],
    ])("answers endpoint_invalid for %s", (_, endpoint) => {
      expect(
        decisionModelResolutionOf({
          model: AZURE_DECISIONS,
          row: azureRow({ AZURE_OPENAI_API_KEY: "azure-key", AZURE_OPENAI_ENDPOINT: endpoint }),
        }),
      ).toEqual({ kind: "own_unavailable", model: AZURE_DECISIONS, reason: "endpoint_invalid" });
    });

    it("answers key_missing when the row has no endpoint", () => {
      expect(
        decisionModelResolutionOf({
          model: AZURE_DECISIONS,
          row: azureRow({ AZURE_OPENAI_API_KEY: "azure-key" }),
        }),
      ).toEqual({ kind: "own_unavailable", model: AZURE_DECISIONS, reason: "key_missing" });
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
