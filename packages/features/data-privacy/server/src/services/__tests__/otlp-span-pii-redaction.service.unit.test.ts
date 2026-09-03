import {
  PLATFORM_DEFAULT_DATA_PRIVACY,
  PRIVACY_PII_INCOMPLETE_MARKER_ATTR,
  type DataPrivacyService,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import type { TenantId } from "@langwatch/eventing";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import { ATTR_KEYS, type OtlpResource, type OtlpSpan } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { PiiAnalysisPort } from "../../ports/pii-analysis.port";
import { OtlpSpanPiiRedactionService } from "../otlp-span-pii-redaction.service";

/**
 * Spec: packages/features/data-privacy/specs/span-pii-redaction.feature
 *
 * The harvested span half, driven end to end over fakes: a span with personal
 * data in it goes in, and what comes out has to be the same thing the
 * application would have produced from the same policy.
 */

class FakePiiAnalysis extends PiiAnalysisPort {
  readonly presidioCalls: {
    texts: string[];
    level: string;
    entities?: readonly string[];
  }[] = [];
  readonly dlpCalls: { text: string; exceptPatterns?: readonly string[] }[] = [];
  closed = 0;

  constructor(
    private readonly behaviour: {
      presidio?: (texts: string[]) => (string | null)[];
      presidioThrows?: Error;
      dlpThrows?: Error;
    } = {},
  ) {
    super();
  }

  async tryClearGoogleDlp(input: {
    text: string;
    piiRedactionLevel: string;
    exceptPatterns?: readonly string[];
  }): Promise<string | null> {
    this.dlpCalls.push({ text: input.text, exceptPatterns: input.exceptPatterns });
    if (this.behaviour.dlpThrows) throw this.behaviour.dlpThrows;
    return "[REDACTED]";
  }

  async clearPresidio(
    texts: string[],
    piiRedactionLevel: string,
    entities?: readonly string[],
  ): Promise<(string | null)[]> {
    this.presidioCalls.push({ texts, level: piiRedactionLevel, entities });
    if (this.behaviour.presidioThrows) throw this.behaviour.presidioThrows;
    return this.behaviour.presidio?.(texts) ?? texts.map(() => "[PERSON]");
  }

  async close(): Promise<void> {
    this.closed += 1;
  }
}

function resolvedPolicy(over: Partial<ResolvedDataPrivacy> = {}): ResolvedDataPrivacy {
  return {
    categories: { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories },
    pii: { level: "essential", entities: [], exceptPatterns: [] },
    secrets: { enabled: true, customPatterns: [] },
    customAttributes: [],
    ...over,
  };
}

function dataPrivacyReturning(policy: ResolvedDataPrivacy | Error): DataPrivacyService {
  return {
    getResolvedForProject: async () => {
      if (policy instanceof Error) throw policy;
      return policy;
    },
  } as unknown as DataPrivacyService;
}

const flagsSaying = (disabled: boolean): FeatureFlagService =>
  ({ isEnabled: async () => disabled }) as unknown as FeatureFlagService;

function spanWith(attributes: { key: string; value: { stringValue: string } }[]): OtlpSpan {
  return {
    traceId: "trace-1",
    spanId: "span-1",
    name: "llm call",
    kind: 3,
    startTimeUnixNano: "1",
    endTimeUnixNano: "2",
    attributes,
    events: [],
    links: [],
    status: { message: null, code: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  } as unknown as OtlpSpan;
}

function serviceWith(options: {
  transport: PiiAnalysisPort;
  policy?: ResolvedDataPrivacy | Error;
  isLangevalsConfigured?: boolean;
  isProduction?: boolean;
  nativePolicyEnforced?: boolean;
  flagDisabled?: boolean;
  maxAttributeLength?: number;
}): OtlpSpanPiiRedactionService {
  return OtlpSpanPiiRedactionService.create({
    transport: options.transport,
    isLangevalsConfigured: options.isLangevalsConfigured ?? true,
    isProduction: options.isProduction ?? false,
    nativePolicyEnforced: options.nativePolicyEnforced ?? true,
    piiRedactionMaxAttributeLength: options.maxAttributeLength ?? 250_000,
    dataPrivacy: dataPrivacyReturning(options.policy ?? resolvedPolicy()),
    featureFlags: flagsSaying(options.flagDisabled ?? false),
  });
}

const TENANT = "project-1" as TenantId;
const attributeValue = (span: OtlpSpan, key: string): string | undefined =>
  span.attributes.find((attribute) => attribute.key === key)?.value.stringValue ?? void 0;

describe("given a tenant whose policy resolves to the essential level", () => {
  /** @scenario "The essential level scrubs in process and calls nothing" */
  it("scrubs personal data in process and never calls the analysis service", async () => {
    const transport = new FakePiiAnalysis();
    const span = spanWith([
      { key: "langwatch.input", value: { stringValue: "mail ana@example.com" } },
    ]);

    await serviceWith({ transport }).redactSpan(span, null, "ESSENTIAL", TENANT);

    expect(attributeValue(span, "langwatch.input")).toBe("mail [EMAIL_ADDRESS]");
    expect(transport.presidioCalls).toEqual([]);
  });

  /** @scenario "The floor covers every part of a span that carries text" */
  it("scrubs the resource attributes, the event and link attributes and the status message", async () => {
    const transport = new FakePiiAnalysis();
    const span = spanWith([]);
    span.events = [
      {
        name: "e",
        timeUnixNano: "1",
        attributes: [{ key: "note", value: { stringValue: "ana@example.com" } }],
        droppedAttributesCount: 0,
      },
    ] as unknown as OtlpSpan["events"];
    span.links = [
      {
        traceId: "t",
        spanId: "s",
        attributes: [{ key: "note", value: { stringValue: "bob@example.com" } }],
        droppedAttributesCount: 0,
      },
    ] as unknown as OtlpSpan["links"];
    span.status = { message: "failed for cara@example.com", code: 2 } as OtlpSpan["status"];
    const resource = {
      attributes: [{ key: "host.user", value: { stringValue: "dan@example.com" } }],
      droppedAttributesCount: 0,
    } as unknown as OtlpResource;

    await serviceWith({ transport }).redactSpan(span, resource, "ESSENTIAL", TENANT);

    expect(span.events[0]!.attributes[0]!.value.stringValue).toBe("[EMAIL_ADDRESS]");
    expect(span.links[0]!.attributes[0]!.value.stringValue).toBe("[EMAIL_ADDRESS]");
    expect(span.status?.message).toBe("failed for [EMAIL_ADDRESS]");
    expect(resource.attributes![0]!.value.stringValue).toBe("[EMAIL_ADDRESS]");
  });
});

describe("given a tenant whose policy resolves to the strict level", () => {
  /** @scenario "The strict level runs the floor first and escalates for the rest" */
  it("runs the native floor first and then asks the analysis service for the rest", async () => {
    const transport = new FakePiiAnalysis({
      presidio: (texts) => texts.map((t) => `${t}|analyzed`),
    });
    const span = spanWith([
      { key: "langwatch.input", value: { stringValue: "Ana Silva at ana@example.com" } },
    ]);

    await serviceWith({
      transport,
      policy: resolvedPolicy({ pii: { level: "strict", entities: [], exceptPatterns: [] } }),
    }).redactSpan(span, null, "ESSENTIAL", TENANT);

    expect(transport.presidioCalls).toHaveLength(1);
    expect(transport.presidioCalls[0]!.texts).toEqual(["Ana Silva at [EMAIL_ADDRESS]"]);
    expect(transport.presidioCalls[0]!.level).toBe("STRICT");
    expect(transport.presidioCalls[0]!.entities).toBeUndefined();
    expect(attributeValue(span, "langwatch.input")).toBe("Ana Silva at [EMAIL_ADDRESS]|analyzed");
  });

  /** @scenario "A policy with exceptions narrows what leaves the process" */
  it("narrows the analysis call to the strict-only identifiers when the policy has exceptions", async () => {
    const transport = new FakePiiAnalysis();
    const span = spanWith([{ key: "langwatch.input", value: { stringValue: "Ana Silva" } }]);

    await serviceWith({
      transport,
      policy: resolvedPolicy({
        pii: { level: "strict", entities: [], exceptPatterns: ["ops@example\\.com"] },
      }),
    }).redactSpan(span, null, "ESSENTIAL", TENANT);

    expect(transport.presidioCalls[0]!.entities).toEqual([
      "LOCATION",
      "PERSON",
      "AU_ACN",
      "AU_MEDICARE",
      "IN_VEHICLE_REGISTRATION",
      "IN_VOTER",
      "IN_PASSPORT",
    ]);
  });
});

describe("given a tenant whose policy resolves to a custom selection", () => {
  /** @scenario "A custom level sends only the identifiers it selected and the native engine cannot detect" */
  it("sends only the selected identifiers the native engine cannot detect", async () => {
    const transport = new FakePiiAnalysis();
    const span = spanWith([{ key: "langwatch.input", value: { stringValue: "Ana in Berlin" } }]);

    await serviceWith({
      transport,
      policy: resolvedPolicy({
        pii: { level: "custom", entities: ["EMAIL_ADDRESS", "PERSON"], exceptPatterns: [] },
      }),
    }).redactSpan(span, null, "ESSENTIAL", TENANT);

    expect(transport.presidioCalls[0]!.entities).toEqual(["PERSON"]);
  });

  /** @scenario "A custom level sends only the identifiers it selected and the native engine cannot detect" */
  it("skips the analysis service entirely when every selection is native", async () => {
    const transport = new FakePiiAnalysis();
    const span = spanWith([{ key: "langwatch.input", value: { stringValue: "ana@example.com" } }]);

    await serviceWith({
      transport,
      policy: resolvedPolicy({
        pii: { level: "custom", entities: ["EMAIL_ADDRESS"], exceptPatterns: [] },
      }),
    }).redactSpan(span, null, "ESSENTIAL", TENANT);

    expect(transport.presidioCalls).toEqual([]);
    expect(attributeValue(span, "langwatch.input")).toBe("[EMAIL_ADDRESS]");
  });
});

describe("given the per-request level and the resolved policy disagree", () => {
  /** @scenario "The ingestion call may escalate while the policy sits at the default" */
  it("lets the request escalate to strict while the policy is at the platform default", async () => {
    const transport = new FakePiiAnalysis();
    const span = spanWith([{ key: "langwatch.input", value: { stringValue: "Ana Silva" } }]);

    await serviceWith({ transport }).redactSpan(span, null, "STRICT", TENANT);

    expect(transport.presidioCalls).toHaveLength(1);
  });

  /** @scenario "An explicit policy level beats the level the ingestion call asked for" */
  it("lets an explicit policy level win over the request", async () => {
    const transport = new FakePiiAnalysis();
    const span = spanWith([{ key: "langwatch.input", value: { stringValue: "ana@example.com" } }]);

    await serviceWith({
      transport,
      policy: resolvedPolicy({ pii: { level: "disabled", entities: [], exceptPatterns: [] } }),
    }).redactSpan(span, null, "STRICT", TENANT);

    expect(transport.presidioCalls).toEqual([]);
    expect(attributeValue(span, "langwatch.input")).toBe("ana@example.com");
  });
});

describe("given the strict analysis service cannot run", () => {
  /** @scenario "An unavailable analysis service marks the span rather than hiding the gap" */
  it("marks the span incomplete when the service is not configured outside production", async () => {
    const transport = new FakePiiAnalysis();
    const span = spanWith([
      { key: "langwatch.input", value: { stringValue: "Ana Silva at ana@example.com" } },
    ]);

    await serviceWith({
      transport,
      isLangevalsConfigured: false,
      policy: resolvedPolicy({ pii: { level: "strict", entities: [], exceptPatterns: [] } }),
    }).redactSpan(span, null, "ESSENTIAL", TENANT);

    expect(attributeValue(span, PRIVACY_PII_INCOMPLETE_MARKER_ATTR)).toBe("strict");
    expect(attributeValue(span, "langwatch.input")).toBe("Ana Silva at [EMAIL_ADDRESS]");
  });

  /** @scenario "An unavailable analysis service marks the span rather than hiding the gap" */
  it("stamps the marker once however many times a span passes through", async () => {
    const transport = new FakePiiAnalysis();
    const span = spanWith([{ key: "langwatch.input", value: { stringValue: "Ana Silva" } }]);
    const service = serviceWith({
      transport,
      isLangevalsConfigured: false,
      policy: resolvedPolicy({ pii: { level: "strict", entities: [], exceptPatterns: [] } }),
    });

    await service.redactSpan(span, null, "ESSENTIAL", TENANT);
    await service.redactSpan(span, null, "ESSENTIAL", TENANT);

    expect(
      span.attributes.filter((a) => a.key === PRIVACY_PII_INCOMPLETE_MARKER_ATTR),
    ).toHaveLength(1);
  });

  /** @scenario "Production refuses a span it could not fully scrub" */
  it("re-throws in production rather than storing names and locations", async () => {
    const transport = new FakePiiAnalysis({
      presidioThrows: new Error("presidio down"),
      dlpThrows: new Error("analysis down"),
    });
    const span = spanWith([{ key: "langwatch.input", value: { stringValue: "Ana Silva" } }]);

    await expect(
      serviceWith({
        transport,
        isProduction: true,
        policy: resolvedPolicy({ pii: { level: "strict", entities: [], exceptPatterns: [] } }),
      }).redactSpan(span, null, "ESSENTIAL", TENANT),
    ).rejects.toThrow("analysis down");
  });

  /** @scenario "An unavailable analysis service marks the span rather than hiding the gap" */
  it("keeps the native floor and marks the span outside production", async () => {
    const transport = new FakePiiAnalysis({
      presidioThrows: new Error("presidio down"),
      dlpThrows: new Error("analysis down"),
    });
    const span = spanWith([
      { key: "langwatch.input", value: { stringValue: "Ana Silva at ana@example.com" } },
    ]);

    await serviceWith({
      transport,
      policy: resolvedPolicy({ pii: { level: "strict", entities: [], exceptPatterns: [] } }),
    }).redactSpan(span, null, "ESSENTIAL", TENANT);

    expect(attributeValue(span, "langwatch.input")).toBe("Ana Silva at [EMAIL_ADDRESS]");
    expect(attributeValue(span, PRIVACY_PII_INCOMPLETE_MARKER_ATTR)).toBe("strict");
  });
});

describe("given no policy can be resolved for the span", () => {
  /** @scenario "Nothing resolvable falls back to the analysis-service path unchanged" */
  it("falls back to the analysis-service path when no tenant is known", async () => {
    const transport = new FakePiiAnalysis();
    const span = spanWith([{ key: "langwatch.input", value: { stringValue: "ana@example.com" } }]);

    await serviceWith({ transport }).redactSpan(span, null, "ESSENTIAL");

    expect(transport.presidioCalls).toHaveLength(1);
    expect(transport.presidioCalls[0]!.level).toBe("ESSENTIAL");
  });

  /** @scenario "Nothing resolvable falls back to the analysis-service path unchanged" */
  it("falls back to the analysis-service path when resolution fails", async () => {
    const transport = new FakePiiAnalysis();
    const span = spanWith([{ key: "langwatch.input", value: { stringValue: "ana@example.com" } }]);

    await serviceWith({ transport, policy: new Error("database down") }).redactSpan(
      span,
      null,
      "ESSENTIAL",
      TENANT,
    );

    expect(transport.presidioCalls).toHaveLength(1);
  });

  /** @scenario "The kill switch sends every span down the analysis-service path" */
  it("falls back to the analysis-service path when the native kill switch is set", async () => {
    const transport = new FakePiiAnalysis();
    const span = spanWith([{ key: "langwatch.input", value: { stringValue: "ana@example.com" } }]);

    await serviceWith({ transport, nativePolicyEnforced: false }).redactSpan(
      span,
      null,
      "ESSENTIAL",
      TENANT,
    );

    expect(transport.presidioCalls).toHaveLength(1);
  });

  /** @scenario "Production refuses a span it could not fully scrub" */
  it("refuses to store the span when the analysis service is unset in production", async () => {
    const transport = new FakePiiAnalysis();
    const span = spanWith([{ key: "langwatch.input", value: { stringValue: "ana@example.com" } }]);

    await expect(
      serviceWith({
        transport,
        nativePolicyEnforced: false,
        isLangevalsConfigured: false,
        isProduction: true,
      }).redactSpan(span, null, "ESSENTIAL", TENANT),
    ).rejects.toThrow("LANGEVALS_ENDPOINT is not set");
  });

  /** @scenario "An explicit policy level beats the level the ingestion call asked for" */
  it("redacts nothing at the DISABLED level", async () => {
    const transport = new FakePiiAnalysis();
    const span = spanWith([{ key: "langwatch.input", value: { stringValue: "ana@example.com" } }]);

    await serviceWith({ transport, nativePolicyEnforced: false }).redactSpan(
      span,
      null,
      "DISABLED",
      TENANT,
    );

    expect(transport.presidioCalls).toEqual([]);
    expect(attributeValue(span, "langwatch.input")).toBe("ana@example.com");
  });
});

describe("given the operations kill switch for strict analysis is on", () => {
  /** @scenario "An unavailable analysis service marks the span rather than hiding the gap" */
  it("skips the analysis call and marks the span incomplete when the service is unset", async () => {
    const transport = new FakePiiAnalysis();
    const span = spanWith([{ key: "langwatch.input", value: { stringValue: "Ana Silva" } }]);

    await serviceWith({
      transport,
      flagDisabled: true,
      isLangevalsConfigured: false,
      policy: resolvedPolicy({ pii: { level: "strict", entities: [], exceptPatterns: [] } }),
    }).redactSpan(span, null, "ESSENTIAL", TENANT);

    expect(transport.presidioCalls).toEqual([]);
    expect(attributeValue(span, PRIVACY_PII_INCOMPLETE_MARKER_ATTR)).toBe("strict");
  });
});

describe("given a span whose text exceeds the batch budget", () => {
  /** @scenario "A span past the batch ceiling is recorded as partly scanned" */
  it("skips the oversized value and records that the pass was partial", async () => {
    const transport = new FakePiiAnalysis();
    const span = spanWith([
      { key: "small", value: { stringValue: "Ana Silva" } },
      { key: "huge", value: { stringValue: "x".repeat(200) } },
    ]);

    await serviceWith({
      transport,
      nativePolicyEnforced: false,
      maxAttributeLength: 50,
    }).redactSpan(span, null, "STRICT", TENANT);

    expect(transport.presidioCalls[0]!.texts).toEqual(["Ana Silva"]);
    expect(attributeValue(span, ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS)).toBe("partial");
  });

  /** @scenario "A span past the batch ceiling is recorded as partly scanned" */
  it("records none when nothing at all could be collected", async () => {
    const transport = new FakePiiAnalysis();
    const span = spanWith([{ key: "huge", value: { stringValue: "x".repeat(200) } }]);

    await serviceWith({
      transport,
      nativePolicyEnforced: false,
      maxAttributeLength: 50,
    }).redactSpan(span, null, "STRICT", TENANT);

    expect(attributeValue(span, ATTR_KEYS.LANGWATCH_RESERVED_PII_REDACTION_STATUS)).toBe("none");
  });

  /** @scenario "A span past the batch ceiling is recorded as partly scanned" */
  it("falls back to the platform ceiling when the configured one is not a usable number", async () => {
    const transport = new FakePiiAnalysis();
    const span = spanWith([{ key: "a", value: { stringValue: "Ana Silva" } }]);

    await serviceWith({
      transport,
      nativePolicyEnforced: false,
      maxAttributeLength: Number.NaN,
    }).redactSpan(span, null, "STRICT", TENANT);

    expect(transport.presidioCalls[0]!.texts).toEqual(["Ana Silva"]);
  });
});

describe("given the analysis service answers with the wrong number of results", () => {
  /** @scenario "A batch answered with the wrong number of results is refused" */
  it("refuses the span rather than writing one value over another", async () => {
    const transport = new FakePiiAnalysis({ presidio: () => [] });
    const span = spanWith([{ key: "a", value: { stringValue: "Ana Silva" } }]);

    await expect(
      serviceWith({ transport, nativePolicyEnforced: false }).redactSpan(
        span,
        null,
        "STRICT",
        TENANT,
      ),
    ).rejects.toThrow("Incomplete PII batch");
  });

  /** @scenario "A batch answered with the wrong number of results is refused" */
  it("leaves a value the service reports unchanged", async () => {
    const transport = new FakePiiAnalysis({ presidio: () => [null] });
    const span = spanWith([{ key: "a", value: { stringValue: "nothing here" } }]);

    await serviceWith({ transport, nativePolicyEnforced: false }).redactSpan(
      span,
      null,
      "STRICT",
      TENANT,
    );

    expect(attributeValue(span, "a")).toBe("nothing here");
  });
});

describe("given the analysis method is Google DLP", () => {
  /** @scenario "The DLP fallback masks a finding and honours an exception" */
  it("is never chosen by the service itself, only reached as the Presidio fallback", async () => {
    const transport = new FakePiiAnalysis({ presidioThrows: new Error("presidio down") });
    const span = spanWith([{ key: "a", value: { stringValue: "Ana Silva" } }]);

    await serviceWith({ transport, nativePolicyEnforced: false }).redactSpan(
      span,
      null,
      "STRICT",
      TENANT,
    );

    expect(transport.dlpCalls).toHaveLength(1);
    expect(attributeValue(span, "a")).toBe("[REDACTED]");
  });

  /** @scenario "The DLP fallback masks a finding and honours an exception" */
  it("carries the policy's exceptions into the fallback, which can honour them", async () => {
    const transport = new FakePiiAnalysis({ presidioThrows: new Error("presidio down") });
    const span = spanWith([{ key: "a", value: { stringValue: "Ana Silva" } }]);

    await serviceWith({
      transport,
      policy: resolvedPolicy({
        pii: { level: "strict", entities: [], exceptPatterns: ["ops@example\\.com"] },
      }),
    }).redactSpan(span, null, "ESSENTIAL", TENANT);

    expect(transport.dlpCalls[0]!.exceptPatterns).toEqual(["ops@example\\.com"]);
  });
});

describe("given a service built without a feature-flag service", () => {
  /** @scenario "Nothing resolvable falls back to the analysis-service path unchanged" */
  it("still runs the analysis pass", async () => {
    const transport = new FakePiiAnalysis();
    const span = spanWith([{ key: "a", value: { stringValue: "Ana Silva" } }]);
    const service = OtlpSpanPiiRedactionService.create({
      transport,
      isLangevalsConfigured: true,
      isProduction: false,
      nativePolicyEnforced: false,
      piiRedactionMaxAttributeLength: 250_000,
      dataPrivacy: dataPrivacyReturning(resolvedPolicy()),
    });

    await service.redactSpan(span, null, "STRICT", TENANT);

    expect(transport.presidioCalls).toHaveLength(1);
  });
});
