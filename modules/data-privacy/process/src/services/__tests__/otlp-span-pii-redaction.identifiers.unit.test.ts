/**
 * Opaque identifiers and reserved trace addresses are held back from analysis;
 * names, prose and customer identifiers still go.
 * Spec: specs/data-privacy/pii-redaction.feature
 */
import { EMPTY_AUDIENCE, type ResolvedDataPrivacy } from "@langwatch/data-privacy-contract";
import { createTenantId } from "@langwatch/eventing";
import type { OtlpKeyValue, OtlpSpan } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { DataPrivacyResolutionFake } from "../../app/__tests__/data-privacy.fixture.ts";
import type { PiiClearing } from "../../rules/pii-analysis.rules.ts";
import { OtlpSpanPiiRedactionService } from "../otlp-span-pii-redaction.service.ts";
import type { PiiAnalysisService } from "../pii-analysis.service.ts";

const TENANT = createTenantId("project-web-app");
const DECIMAL_TRACE_ADDRESS = "17575001234540000091234567890123";
const PHONE_SHAPED_ADDRESS = "12515420585";
const HEX_SPAN_ID = "f52185dd67918e00";

const cat = () => ({ disposition: "capture" as const, audience: { ...EMPTY_AUDIENCE } });

function policyAt(level: "essential" | "strict"): ResolvedDataPrivacy {
  return {
    categories: { input: cat(), output: cat(), system: cat(), tools: cat() },
    pii: { level, entities: [], exceptPatterns: [] },
    secrets: { enabled: true, customPatterns: [] },
    customAttributes: [],
  };
}

/** The redaction service with only the analysis transport doubled; `submitted()` is its intake. */
function makeService(level: "essential" | "strict") {
  const batchSpy = vi.fn(async (texts: string[]): Promise<(string | null)[]> =>
    texts.map(() => null),
  );
  const transport: Pick<PiiAnalysisService, "clearGoogleDlp" | "clearPresidio" | "close"> = {
    clearGoogleDlp: async (): Promise<PiiClearing> => ({ kind: "unchanged" }),
    clearPresidio: async ({ texts }) => batchSpy(texts),
    close: async () => undefined,
  };
  const service = OtlpSpanPiiRedactionService.create({
    transport,
    isLangevalsConfigured: async () => true,
    isProduction: false,
    nativePolicyEnforced: true,
    piiRedactionMaxAttributeLength: 250_000,
    dataPrivacy: new DataPrivacyResolutionFake(policyAt(level)),
  });
  const submitted = (): string[] => batchSpy.mock.calls.flatMap(([texts]) => texts);
  /** From here on the detector reads every value it receives as a person's name. */
  const namesEverything = () =>
    batchSpy.mockImplementation(async (texts: string[]) => texts.map(() => "[PERSON]"));

  return { service, submitted, namesEverything };
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

const attr = (span: OtlpSpan, key: string): string | undefined =>
  span.attributes.find((a) => a.key === key)?.value.stringValue ?? undefined;

const ingest = (
  { service }: ReturnType<typeof makeService>,
  span: OtlpSpan,
  level: "ESSENTIAL" | "STRICT",
) => service.redactSpan({ span, resource: null, piiRedactionLevel: level, tenantId: TENANT });

function seeded(seed: number): () => number {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexOf({ random, length }: { random: () => number; length: number }): string {
  return Array.from({ length }, () => "0123456789abcdef"[Math.floor(random() * 16)]).join("");
}

function ulidOf({ random }: { random: () => number }): string {
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";

  return Array.from({ length: 26 }, () => alphabet[Math.floor(random() * alphabet.length)]).join(
    "",
  );
}

describe("given a strict tenant and an attribute that is an opaque identifier", () => {
  /** @scenario "An opaque identifier attribute value is never sent for analysis" */
  it("never sends a hex span identifier and stores it as it was sent", async () => {
    const harness = makeService("strict");
    const span = spanWith({ "app.request_ref": HEX_SPAN_ID });

    await ingest(harness, span, "STRICT");

    expect(harness.submitted()).not.toContain(HEX_SPAN_ID);
    expect(attr(span, "app.request_ref")).toBe(HEX_SPAN_ID);
  });

  /** @scenario "A reserved trace identifier attribute is never sent for analysis" */
  it("never sends a value held under a reserved trace identifier name", async () => {
    const harness = makeService("strict");
    const span = spanWith({ trace_id: DECIMAL_TRACE_ADDRESS });

    await ingest(harness, span, "STRICT");

    expect(harness.submitted()).not.toContain(DECIMAL_TRACE_ADDRESS);
    expect(attr(span, "trace_id")).toBe(DECIMAL_TRACE_ADDRESS);
  });

  /** @scenario "A corpus of opaque identifiers is never sent for analysis" */
  it("sends none of a corpus of hex identifiers, dashed uuids and prefixed ULIDs", async () => {
    const harness = makeService("strict");
    const random = seeded(20260912);
    const values = Array.from({ length: 60 }, (_, index) => {
      const kind = index % 3;
      if (kind === 0) return hexOf({ random, length: index % 2 === 0 ? 32 : 16 });
      if (kind === 1) {
        return [8, 4, 4, 4, 12].map((length) => hexOf({ random, length })).join("-");
      }

      return `session_${ulidOf({ random })}`;
    });
    const span = spanWith(
      Object.fromEntries(values.map((value, index) => [`app.id_${index}`, value])),
    );

    await ingest(harness, span, "STRICT");

    expect(harness.submitted().filter((text) => values.includes(text))).toEqual([]);
  });

  /** @scenario "A corpus of short opaque tokens is almost never sent for analysis" */
  it("sends fewer than one in a hundred of twelve hundred short hex ids and prefixed ULIDs", async () => {
    const harness = makeService("strict");
    const random = seeded(20260913);
    const values = Array.from({ length: 1200 }, (_, index) =>
      index % 2 === 0 ? hexOf({ random, length: 16 }) : `trace_${ulidOf({ random })}`,
    );
    const span = spanWith(
      Object.fromEntries(values.map((value, index) => [`app.id_${index}`, value])),
    );

    await ingest(harness, span, "STRICT");

    expect(harness.submitted().filter((text) => values.includes(text)).length).toBeLessThan(12);
  });
});

describe("given a strict tenant and attributes that are words, not identifiers", () => {
  const GIVEN = [
    "Jane",
    "Ahmed",
    "Mei",
    "Olumide",
    "Sofia",
    "Lars",
    "Priya",
    "Tomas",
    "Aiko",
    "Nia",
  ];
  const FAMILY = [
    "Doe",
    "Khan",
    "Lin",
    "Adeyemi",
    "Rossi",
    "Berg",
    "Patel",
    "Novak",
    "Sato",
    "Okoye",
  ];

  /** @scenario "A corpus of written names is still sent for analysis" */
  it("sends every one of a hundred generated names", async () => {
    const harness = makeService("strict");
    const names = GIVEN.flatMap((first) => FAMILY.map((last) => `${first} ${last}`));
    const span = spanWith(
      Object.fromEntries(names.map((name, index) => [`app.contact_${index}`, name])),
    );

    await ingest(harness, span, "STRICT");

    expect(names.filter((name) => !harness.submitted().includes(name))).toEqual([]);
  });

  /** @scenario "Prose that holds a name is still sent for analysis" */
  it("sends a sentence naming a person", async () => {
    const harness = makeService("strict");
    const sentence = "the ticket was raised by Jane Doe in Berlin";

    await ingest(harness, spanWith({ "app.support_note": sentence }), "STRICT");

    expect(harness.submitted()).toContain(sentence);
  });

  /** @scenario "Prose that quotes an opaque identifier is still sent for analysis" */
  it("sends a sentence naming a person next to a trace identifier", async () => {
    const harness = makeService("strict");
    const sentence = `Jane Doe reported trace ${hexOf({ random: seeded(7), length: 32 })} as slow`;

    await ingest(harness, spanWith({ "app.support_note": sentence }), "STRICT");

    expect(harness.submitted()).toContain(sentence);
  });

  /** @scenario "A customer identifier that holds a person name is still sent for analysis" */
  it("sends a user identifier attribute whose value is a person name", async () => {
    const harness = makeService("strict");

    await ingest(harness, spanWith({ "user.id": "Jane Doe" }), "STRICT");

    expect(harness.submitted()).toContain("Jane Doe");
  });

  /** @scenario "A hyphenated or run-together name is still sent for analysis" */
  it.each(["Anne-Marie", "jane.doe", "janedoe", "Mary-Jane.Watson"])(
    "sends the name written as %s",
    async (name) => {
      const harness = makeService("strict");

      await ingest(harness, spanWith({ "app.contact": name }), "STRICT");

      expect(harness.submitted()).toContain(name);
    },
  );

  /** @scenario "A place written as one hyphenated token is still sent for analysis" */
  it("sends a hyphenated place name", async () => {
    const harness = makeService("strict");

    await ingest(harness, spanWith({ "app.city": "Saint-Jean-de-Luz" }), "STRICT");

    expect(harness.submitted()).toContain("Saint-Jean-de-Luz");
  });
});

describe("given a reserved trace identifier name holding personal data", () => {
  const CARD = "4111111111111111";

  /** @scenario "A reserved trace identifier name holding an email address is redacted at the strict level" */
  it("redacts an email address and never sends it in the clear", async () => {
    const harness = makeService("strict");
    const span = spanWith({ trace_id: "jane@example.com" });

    await ingest(harness, span, "STRICT");

    expect(attr(span, "trace_id")).toBe("[EMAIL_ADDRESS]");
    expect(harness.submitted()).not.toContain("jane@example.com");
  });

  /** @scenario "A reserved trace identifier name holding an email address is still redacted" */
  it("redacts an email address at the essential level", async () => {
    const harness = makeService("essential");
    const span = spanWith({ trace_id: "jane@example.com" });

    await ingest(harness, span, "ESSENTIAL");

    expect(attr(span, "trace_id")).toBe("[EMAIL_ADDRESS]");
  });

  /** @scenario "A card number written under a reserved trace identifier name is still redacted" */
  it("redacts a valid card number at the essential level", async () => {
    const harness = makeService("essential");
    const span = spanWith({ trace_id: CARD });

    await ingest(harness, span, "ESSENTIAL");

    expect(attr(span, "trace_id")).not.toContain(CARD);
  });
});

describe("given an essential tenant and a decimal trace address", () => {
  /** @scenario "A reserved identifier attribute survives even when its value is all digits" */
  it("stores a reserved attribute written in decimal as it was sent", async () => {
    const harness = makeService("essential");
    const span = spanWith({ trace_id: DECIMAL_TRACE_ADDRESS });

    await ingest(harness, span, "ESSENTIAL");

    expect(attr(span, "trace_id")).toBe(DECIMAL_TRACE_ADDRESS);
  });

  /** @scenario "A decimal trace identifier a phone detector claims is kept under a reserved name" */
  it("keeps it under a reserved name but redacts the same value under another", async () => {
    const harness = makeService("essential");
    const span = spanWith({ traceid: PHONE_SHAPED_ADDRESS, "app.note": PHONE_SHAPED_ADDRESS });

    await ingest(harness, span, "ESSENTIAL");

    expect(attr(span, "traceid")).toBe(PHONE_SHAPED_ADDRESS);
    expect(attr(span, "app.note")).toBe("[PHONE_NUMBER]");
  });
});

describe("given an essential tenant and an uppercase segwit address", () => {
  /** @scenario "An uppercase segwit address is redacted like its lowercase form" */
  it("redacts it in the input as it does the lowercase form", async () => {
    const harness = makeService("essential");
    const address = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
    const lower = spanWith({ "langwatch.input": `pay ${address}` });
    const upper = spanWith({ "langwatch.input": `pay ${address.toUpperCase()}` });

    await ingest(harness, lower, "ESSENTIAL");
    await ingest(harness, upper, "ESSENTIAL");

    expect(attr(upper, "langwatch.input")).toBe(attr(lower, "langwatch.input"));
    expect(attr(upper, "langwatch.input")).not.toContain(address.toUpperCase());
  });
});

describe("given a strict tenant and OTLP records rather than spans", () => {
  const BODY = "the ticket was raised by Jane Doe in Berlin";

  /** @scenario "Log attributes hold opaque identifiers back from analysis" */
  it("sends a log body but not a hex identifier attribute", async () => {
    const harness = makeService("strict");
    const log = {
      body: BODY,
      attributes: { "app.request_ref": HEX_SPAN_ID },
      resourceAttributes: {},
    };

    await harness.service.redactLog(log, "STRICT", TENANT);

    expect(harness.submitted()).toContain(BODY);
    expect(harness.submitted()).not.toContain(HEX_SPAN_ID);
  });

  /** @scenario "Metric attributes hold opaque identifiers back from analysis" */
  it("sends the prose attribute but not the identifier attribute of a metric", async () => {
    const harness = makeService("strict");
    const metric = {
      attributes: { "app.request_ref": HEX_SPAN_ID, "app.note": BODY },
      resourceAttributes: {},
    };

    await harness.service.redactMetricAttributes(metric, "STRICT", TENANT);

    expect(harness.submitted()).toContain(BODY);
    expect(harness.submitted()).not.toContain(HEX_SPAN_ID);
  });

  /** @scenario "A flattened attribute is held out under its real name" */
  it("decides on the real name behind a flattened key, sending the value once", async () => {
    const harness = makeService("strict");
    const log = {
      body: BODY,
      attributes: {
        "attributes.0": DECIMAL_TRACE_ADDRESS,
        "attributes.1": DECIMAL_TRACE_ADDRESS,
      },
      resourceAttributes: {},
      attributeNames: { "attributes.0": "trace_id", "attributes.1": "app.ref" },
    };

    await harness.service.redactLog(log, "STRICT", TENANT);

    expect(harness.submitted().filter((text) => text === DECIMAL_TRACE_ADDRESS)).toHaveLength(1);
    expect(harness.submitted()).toContain(BODY);
  });
});

// The name detector reads some span kinds as first names, so under strict mode
// top-level spans stored `[PERSON]` as their kind. A known kind is a fixed word,
// so it is never submitted and is stored unchanged.
describe("given a strict tenant and the span kind attribute", () => {
  const PROSE = "Customer said the refund went to the wrong card last week.";

  /** @scenario "A known span kind is never sent for analysis" */
  it.each(["agent", "workflow", "llm"])(
    "keeps the known kind %s and never submits it",
    async (value) => {
      const harness = makeService("strict");
      harness.namesEverything();
      const span = spanWith({ "langwatch.span.type": value, "app.support_note": PROSE });

      await ingest(harness, span, "STRICT");

      expect(harness.submitted()).toContain(PROSE);
      expect(harness.submitted()).not.toContain(value);
      expect(attr(span, "langwatch.span.type")).toBe(value);
      expect(attr(span, "app.support_note")).toBe("[PERSON]");
    },
  );

  /** @scenario "A name written under the span kind attribute is still redacted" */
  it("still redacts a name written under the kind attribute", async () => {
    const harness = makeService("strict");
    harness.namesEverything();
    const span = spanWith({ "langwatch.span.type": "Jane Doe" });

    await ingest(harness, span, "STRICT");

    expect(attr(span, "langwatch.span.type")).toBe("[PERSON]");
  });
});
