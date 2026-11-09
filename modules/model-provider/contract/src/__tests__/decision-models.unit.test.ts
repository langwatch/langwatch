/**
 * The decision model catalogue holds only entries a key can reach (ADR-182 decisions 2 and 5).
 * @see specs/model-providers/instant-evals-decision-model.feature
 */
import { describe, expect, it } from "vitest";

import {
  azureResourceOf,
  DECISION_MODELS,
  decisionModelPickerTitle,
  isOwnDecisionModelId,
  LANGWATCH_DECISION_MODEL_ID,
} from "../catalog/decision-models.ts";
import { findModelProviderDefinition } from "../model-provider-registry.ts";

const OWN_ENTRIES = DECISION_MODELS.filter((entry) => isOwnDecisionModelId(entry.id));

describe("DECISION_MODELS", () => {
  /** @scenario "Every catalogue entry can be reached with the key it names" */
  it.each(OWN_ENTRIES.map((entry) => [entry.id, entry] as const))(
    "%s names a registry provider, an https endpoint and a wire",
    (_, entry) => {
      const provider = findModelProviderDefinition(entry.provider);
      expect(provider).toBeDefined();
      expect(entry.wire).toBeDefined();
      expect(entry.providerModel).toBeTruthy();
      expect(entry.endpoint?.startsWith("https://")).toBe(true);
      expect(entry.id.startsWith(`${entry.provider}/decisions:`)).toBe(true);

      const placeholders = [...(entry.endpoint ?? "").matchAll(/\{(\w+)\}/g)].map(
        (match) => match[1],
      );
      expect(new Set(placeholders)).toEqual(new Set(Object.keys(entry.endpointParams ?? {})));
      const shape = provider?.keysSchema as { shape?: Record<string, unknown> } | undefined;
      const rowFields = [
        ...Object.values(entry.endpointParams ?? {}).map((param) => param.field),
        ...(entry.providerModelField ? [entry.providerModelField] : []),
      ];
      for (const field of rowFields) expect(shape?.shape?.[field]).toBeDefined();
    },
  );

  /** @scenario "A decision model's full name opens with its provider" */
  it.each(OWN_ENTRIES.map((entry) => [entry.id, entry] as const))(
    "%s's full name opens with its provider's name",
    (_, entry) => {
      const providerName = findModelProviderDefinition(entry.provider)?.name ?? "";
      const firstWord = providerName.split(" ")[0] ?? "";
      expect(firstWord).not.toBe("");
      expect(entry.label.startsWith(firstWord)).toBe(true);
    },
  );

  it("names LangWatch's hosted model for what it is optimized for", () => {
    const hosted = DECISION_MODELS.find((entry) => entry.id === LANGWATCH_DECISION_MODEL_ID);
    expect(hosted).toMatchObject({ label: "Evals Preview", description: "Optimized for evals" });
  });

  it("never gives two models the same full name, while the picker title (pickerLabel) may repeat", () => {
    const labels = DECISION_MODELS.map((entry) => entry.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual(expect.arrayContaining(["OpenAI Decisions", "Azure OpenAI Decisions"]));
  });

  /** @scenario "A decision model's full name opens with its provider" */
  it("titles OpenAI's and Azure OpenAI's Decisions models Decisions API in a picker", () => {
    const titles = ["openai/decisions:gpt-6-luna", "azure/decisions:gpt-6-luna"].map((id) => {
      const entry = DECISION_MODELS.find((candidate) => candidate.id === id);
      return entry ? decisionModelPickerTitle(entry) : id;
    });
    expect(titles).toEqual(["Decisions API", "Decisions API"]);
    const inception = DECISION_MODELS.find((entry) => entry.provider === "inception");
    expect(inception && decisionModelPickerTitle(inception)).toBe("Inception Mercury Decide");
  });

  it("never repeats an id", () => {
    const ids = DECISION_MODELS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("azureResourceOf", () => {
  it.each([
    ["https://acme.openai.azure.com/", "acme"],
    ["https://Acme-East.cognitiveservices.azure.com", "acme-east"],
    ["https://acme.services.ai.azure.com/api/projects/p1", "acme"],
  ])("reads the resource name from %s", (endpoint, resource) => {
    expect(azureResourceOf(endpoint)).toEqual({ kind: "azure", resource });
  });

  it.each([
    "https://acme.openai.azure.com.evil.example",
    "https://evil.example/acme.openai.azure.com",
    "https://a.b.openai.azure.com",
    "http://acme.openai.azure.com",
    "https://acme.openai.azure.com:8443",
    "https://user:pass@acme.openai.azure.com",
    "acme.openai.azure.com",
  ])("refuses %s", (endpoint) => {
    expect(azureResourceOf(endpoint)).toEqual({ kind: "not_azure" });
  });
});
