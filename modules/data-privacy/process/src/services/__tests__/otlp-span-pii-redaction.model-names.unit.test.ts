/**
 * The name detector reads a bare model id (`claude-sonnet-4-6`) as a first name, so model,
 * provider and tool names are spared name and place detection only.
 * Spec: specs/data-privacy/pii-redaction.feature
 */
import { EMPTY_AUDIENCE, type ResolvedDataPrivacy } from "@langwatch/data-privacy-contract";
import { createTenantId, type TenantId } from "@langwatch/eventing";
import type { OtlpKeyValue, OtlpSpan } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { DataPrivacyResolutionFake } from "../../app/__tests__/data-privacy.fixture.ts";
import type { PiiClearing } from "../../rules/pii-analysis.rules.ts";
import type { DataPrivacyResolutionService } from "../data-privacy-resolution.service.ts";
import { OtlpSpanPiiRedactionService } from "../otlp-span-pii-redaction.service.ts";
import type { PiiAnalysisService } from "../pii-analysis.service.ts";
import type { PIICheckOptions } from "../pii-redaction-policy.service.ts";

const TENANT = createTenantId("project-web-app");

const PROSE_THAT_MUST_BE_ANALYSED = "the ticket was raised by Jane Doe in Berlin";

type Batch = (
  texts: string[],
  options: PIICheckOptions,
  spared: readonly boolean[] | undefined,
) => Promise<(string | null)[]>;

const cat = () => ({ disposition: "capture" as const, audience: { ...EMPTY_AUDIENCE } });

const STRICT_POLICY: ResolvedDataPrivacy = {
  categories: { input: cat(), output: cat(), system: cat(), tools: cat() },
  pii: { level: "strict", entities: [], exceptPatterns: [] },
  secrets: { enabled: true, customPatterns: [] },
  customAttributes: [],
};

class FailingResolution implements Pick<DataPrivacyResolutionService, "getResolvedForProject"> {
  async getResolvedForProject(): Promise<ResolvedDataPrivacy> {
    throw new Error("policy store unavailable");
  }
}

/**
 * A redaction service whose only double is the analysis transport. `submittedForNames()` is every
 * string sent to a call that looks for people without being flagged to have name findings dropped.
 */
function makeService({
  policy = STRICT_POLICY,
  dataPrivacy = new DataPrivacyResolutionFake(policy),
  presidioFails = false,
}: {
  policy?: ResolvedDataPrivacy;
  dataPrivacy?: Pick<DataPrivacyResolutionService, "getResolvedForProject">;
  presidioFails?: boolean;
} = {}) {
  const batchSpy = vi.fn<Batch>(async (texts) => texts.map(() => null));
  const dlpCalls: { text: string; spareNamesAndPlaces: boolean }[] = [];
  const transport: Pick<PiiAnalysisService, "clearGoogleDlp" | "clearPresidio" | "close"> = {
    clearGoogleDlp: async ({ text, spareNamesAndPlaces }): Promise<PiiClearing> => {
      dlpCalls.push({ text, spareNamesAndPlaces: spareNamesAndPlaces ?? false });
      return { kind: "unchanged" };
    },
    clearPresidio: async ({ texts, piiRedactionLevel, entities, spareNamesAndPlaces }) => {
      if (presidioFails) throw new Error("analysis service unavailable");
      return batchSpy(
        texts,
        { piiRedactionLevel, mainMethod: "presidio", ...(entities ? { entities } : {}) },
        spareNamesAndPlaces,
      );
    },
    close: async () => undefined,
  };
  const service = OtlpSpanPiiRedactionService.create({
    transport,
    isLangevalsConfigured: async () => true,
    isProduction: false,
    nativePolicyEnforced: true,
    piiRedactionMaxAttributeLength: 250_000,
    dataPrivacy,
  });
  const submitted = (): string[] => batchSpy.mock.calls.flatMap(([texts]) => texts);
  const submittedForNames = (): string[] =>
    batchSpy.mock.calls.flatMap(([texts, options, spared]) =>
      (options.entities ?? ["PERSON"]).includes("PERSON")
        ? texts.filter((_, i) => !spared?.[i])
        : [],
    );
  const sparedNames = (text: string): boolean | undefined => {
    for (const [texts, , spared] of batchSpy.mock.calls) {
      const i = texts.indexOf(text);
      if (i >= 0) return spared?.[i] ?? false;
    }
    return undefined;
  };
  /** The name detector reads every string as a person, the way it reads a bare model id. */
  const namesEverything = () =>
    batchSpy.mockImplementation(async (texts, options, spared) =>
      texts.map((_, i) =>
        (options.entities ?? ["PERSON"]).includes("PERSON") && !spared?.[i] ? "[PERSON]" : null,
      ),
    );
  return {
    service,
    batchSpy,
    dlpCalls,
    submitted,
    submittedForNames,
    sparedNames,
    namesEverything,
  };
}

function spanWith(attributes: Record<string, string>): OtlpSpan {
  const attrs: OtlpKeyValue[] = Object.entries(attributes).map(([key, value]) => ({
    key,
    value: { stringValue: value },
  }));
  return {
    traceId: "abc123",
    spanId: "def456",
    name: "test-span",
    kind: 1,
    startTimeUnixNano: { low: 0, high: 0 },
    endTimeUnixNano: { low: 0, high: 0 },
    attributes: attrs,
    events: [],
    links: [],
    status: {},
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

function attr(span: OtlpSpan, key: string): string | undefined {
  return span.attributes.find((a) => a.key === key)?.value.stringValue ?? undefined;
}

const strict = (
  span: OtlpSpan,
  { tenantId }: { tenantId: TenantId | undefined } = { tenantId: TENANT },
) => ({
  span,
  resource: null,
  piiRedactionLevel: "STRICT" as const,
  ...(tenantId ? { tenantId } : {}),
});

describe("given a model or tool name attribute", () => {
  /** @scenario "A model or tool name attribute is never redacted as a name" */
  it.each([
    ["ai.model.id", "claude-sonnet-4-6"],
    ["ai.response.model", "claude-sonnet-4-6"],
    ["gen_ai.request.model", "claude-sonnet-4-6"],
    ["gen_ai.response.model", "claude-haiku-4-5-20251001"],
    ["ai.model.provider", "anthropic.messages"],
    ["gen_ai.system", "anthropic"],
    ["gen_ai.provider.name", "anthropic"],
    ["llm.model_name", "anthropic/claude-sonnet-4"],
    ["ai.toolCall.name", "getWeatherForecast"],
    ["gen_ai.tool.name", "search_documents"],
  ])("drops name findings on %s = %s and stores it unchanged", async (key, value) => {
    const { service, batchSpy, submittedForNames, sparedNames, namesEverything } = makeService();
    namesEverything();
    const span = spanWith({ [key]: value, "app.support_note": PROSE_THAT_MUST_BE_ANALYSED });

    await service.redactSpan(strict(span));

    expect(submittedForNames()).toContain(PROSE_THAT_MUST_BE_ANALYSED);
    expect(submittedForNames()).not.toContain(value);
    expect(sparedNames(value)).toBe(true);
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(attr(span, key)).toBe(value);
    expect(attr(span, "app.support_note")).toBe("[PERSON]");
  });

  it("still submits the same model id under an unreserved name", async () => {
    const { service, submittedForNames } = makeService();

    await service.redactSpan(strict(spanWith({ "app.preferred_model": "claude-sonnet-4-6" })));

    expect(submittedForNames()).toContain("claude-sonnet-4-6");
  });

  /** @scenario "Prose written under a model name attribute is still sent for analysis" */
  it("still submits prose written under a model name", async () => {
    const { service, submittedForNames } = makeService();

    await service.redactSpan(strict(spanWith({ "gen_ai.request.model": "Jane Doe" })));

    expect(submittedForNames()).toContain("Jane Doe");
  });

  /** @scenario "An email address written under a model name attribute is still redacted" */
  it("still redacts an email address written under a model name", async () => {
    const { service, submitted } = makeService();
    const span = spanWith({ "ai.model.id": "jane@example.com" });

    await service.redactSpan(strict(span));

    expect(attr(span, "ai.model.id")).toBe("[EMAIL_ADDRESS]");
    expect(submitted()).not.toContain("jane@example.com");

    // Without the native pass the value is not spared: it goes to the full detector.
    const fallback = makeService();
    await fallback.service.redactSpan(
      strict(spanWith({ "ai.model.id": "jane@example.com" }), { tenantId: undefined }),
    );
    expect(fallback.submittedForNames()).toContain("jane@example.com");
  });

  /** @scenario "A phone number written under a model name attribute is still redacted" */
  it("still redacts a phone number written under a model name", async () => {
    const { service } = makeService();
    const span = spanWith({ "ai.model.id": "+1-234-567-8901" });

    await service.redactSpan(strict(span));

    expect(attr(span, "ai.model.id")).toBe("[PHONE_NUMBER]");
  });

  /** @scenario "Without a resolved policy a model name attribute is still scanned for other identifiers" */
  it.each([
    ["no tenant", undefined],
    ["a failed policy lookup", TENANT],
  ] as const)(
    "still scans a model name attribute for a phone number when the native pass did not run (%s)",
    async (_why, tenant) => {
      const { service, batchSpy, sparedNames } = makeService({
        dataPrivacy: new FailingResolution(),
      });

      await service.redactSpan(
        strict(spanWith({ "ai.model.id": "+1-234-567-8901" }), { tenantId: tenant }),
      );

      const call = batchSpy.mock.calls.find(([texts]) => texts.includes("+1-234-567-8901"));
      expect(call?.[1].entities ?? ["PHONE_NUMBER"]).toContain("PHONE_NUMBER");
      expect(sparedNames("+1-234-567-8901")).toBe(true);
    },
  );

  it("spares a model name on a log record the same way", async () => {
    const { service, submitted, submittedForNames } = makeService();
    const log = {
      body: "",
      attributes: { "gen_ai.request.model": "claude-sonnet-4-6" },
      resourceAttributes: {},
    };

    await service.redactLog(log, "STRICT", TENANT);

    expect(submittedForNames()).not.toContain("claude-sonnet-4-6");
    expect(submitted()).toContain("claude-sonnet-4-6");
    expect(log.attributes["gen_ai.request.model"]).toBe("claude-sonnet-4-6");
  });

  /** @scenario "A model name attribute is still scanned for the non-name identifiers a custom level selects" */
  it("still scans a model name attribute for an analysis-only identifier under a custom level", async () => {
    const { service, batchSpy, submittedForNames, sparedNames } = makeService({
      policy: {
        ...STRICT_POLICY,
        pii: { level: "custom", entities: ["PERSON", "AU_MEDICARE"], exceptPatterns: [] },
        secrets: { enabled: false, customPatterns: [] },
      },
    });

    await service.redactSpan(strict(spanWith({ "ai.model.id": "claude-sonnet-4-6" })));

    const call = batchSpy.mock.calls.find(([texts]) => texts.includes("claude-sonnet-4-6"));
    expect(call?.[1].entities).toContain("AU_MEDICARE");
    expect(sparedNames("claude-sonnet-4-6")).toBe(true);
    expect(submittedForNames()).not.toContain("claude-sonnet-4-6");
  });

  /** @scenario "A model name attribute is not submitted when only names are selected" */
  it("does not submit a model name attribute when a custom level selects only names", async () => {
    const { service, submitted, namesEverything } = makeService({
      policy: {
        ...STRICT_POLICY,
        pii: { level: "custom", entities: ["PERSON"], exceptPatterns: [] },
        secrets: { enabled: false, customPatterns: [] },
      },
    });
    namesEverything();
    const span = spanWith({ "ai.model.id": "claude-sonnet-4-6" });

    await service.redactSpan(strict(span));

    expect(submitted()).not.toContain("claude-sonnet-4-6");
    expect(attr(span, "ai.model.id")).toBe("claude-sonnet-4-6");
  });

  /** @scenario "A model name attribute costs no extra analysis request" */
  it("sends a model name and the rest of the span in one call", async () => {
    const { service, batchSpy } = makeService();
    const span = spanWith({
      "ai.model.id": "claude-sonnet-4-6",
      "app.support_note": PROSE_THAT_MUST_BE_ANALYSED,
    });

    await service.redactSpan(strict(span));

    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(batchSpy.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining(["claude-sonnet-4-6", PROSE_THAT_MUST_BE_ANALYSED]),
    );
  });

  describe("when the analysis service fails", () => {
    /** @scenario "The fallback detector also keeps a model name's name findings" */
    it("asks the fallback detector to spare names on the model name only", async () => {
      const { service, dlpCalls } = makeService({ presidioFails: true });
      const span = spanWith({
        "ai.model.id": "claude-sonnet-4-6",
        "app.support_note": PROSE_THAT_MUST_BE_ANALYSED,
      });

      await service.redactSpan(strict(span));

      const sparedFor = (text: string) =>
        dlpCalls.find((call) => call.text === text)?.spareNamesAndPlaces;
      expect(sparedFor("claude-sonnet-4-6")).toBe(true);
      expect(sparedFor(PROSE_THAT_MUST_BE_ANALYSED)).toBe(false);
    });
  });
});
