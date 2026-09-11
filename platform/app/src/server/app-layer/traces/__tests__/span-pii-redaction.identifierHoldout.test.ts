import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_AUDIENCE,
  type ResolvedDataPrivacy,
} from "~/server/data-privacy/dataPrivacy.types";
import type {
  OtlpKeyValue,
  OtlpSpan,
} from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  type BatchClearPIIFunction,
  type DataPrivacyResolver,
  OtlpSpanPiiRedactionService,
} from "../span-pii-redaction.service";

// The analysis service is the boundary under test: what LEAVES the process is
// the observable contract, so the batch function is spied on and the rest of
// the redaction stack runs for real.
vi.mock("~/server/featureFlag", () => ({
  featureFlagService: { isEnabled: vi.fn(async () => false) },
}));

vi.mock("~/server/tracer/collector/piiCheck", () => ({
  batchPresidioClearPII: vi.fn(),
  googleDLPClearPII: vi.fn(),
  PRESIDIO_STRICT_ENTITIES: ["PERSON", "LOCATION", "EMAIL_ADDRESS"],
}));

import { isIdentifierShapedValue } from "~/server/data-privacy/redaction/identifierHoldout";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";

const TENANT = createTenantId("project-web-app");

const STRICT_POLICY: ResolvedDataPrivacy = {
  categories: {
    input: { disposition: "capture", audience: { ...EMPTY_AUDIENCE } },
    output: { disposition: "capture", audience: { ...EMPTY_AUDIENCE } },
    system: { disposition: "capture", audience: { ...EMPTY_AUDIENCE } },
    tools: { disposition: "capture", audience: { ...EMPTY_AUDIENCE } },
  },
  pii: { level: "strict", entities: [], exceptPatterns: [] },
  secrets: { enabled: true, customPatterns: [] },
  customAttributes: [],
};

function resolverFor(policy: ResolvedDataPrivacy): DataPrivacyResolver {
  return { getResolvedForProject: async () => policy };
}

function makeService(policy: ResolvedDataPrivacy = STRICT_POLICY) {
  // Return null for every input: the analysis service reporting "nothing to
  // change" keeps the stored values readable, so an assertion about what was
  // STORED and one about what was SUBMITTED cannot be confused for each other.
  const batchSpy = vi.fn<BatchClearPIIFunction>(async (texts) =>
    texts.map(() => null),
  );
  const service = new OtlpSpanPiiRedactionService({
    batchClearPII: batchSpy,
    isLangevalsConfigured: true,
    isProduction: false,
    dataPrivacyResolver: resolverFor(policy),
  });
  const submitted = (): string[] =>
    batchSpy.mock.calls.flatMap((call) => call[0] as string[]);
  return { service, batchSpy, submitted };
}

function spanWith(attributes: Record<string, string>): OtlpSpan {
  const attrs: OtlpKeyValue[] = Object.entries(attributes).map(
    ([key, value]) => ({ key, value: { stringValue: value } }),
  );
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
  } as unknown as OtlpSpan;
}

function attr(span: OtlpSpan, key: string): string | undefined {
  return (
    span.attributes.find((a) => a.key === key)?.value.stringValue ?? undefined
  );
}

/** A seeded generator, so a failing corpus names the same values on a re-run. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(next: () => number, alphabet: string, length: number): string {
  return Array.from(
    { length },
    () => alphabet[Math.floor(next() * alphabet.length)]!,
  ).join("");
}

const HEX = "0123456789abcdef";
const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * The shapes an OTel pipeline actually emits, split by what the rule can
 * promise about each. Trace ids and uuids — long enough that the rule holds them back for every
 * value rather than merely for most. A run qualifies as hex only if it also
 * carries a letter, since a run of nothing but digits is a card or an account
 * number as far as this rule can tell; across thirty-two hex characters a draw
 * with no letter at all happens about three times in ten million, so a leak
 * here is a broken rule rather than an unlucky draw.
 */
function unconditionalCorpus(seed: number): string[] {
  const next = seededRandom(seed);
  const corpus: string[] = [];
  for (let i = 0; i < 300; i++) {
    corpus.push(pick(next, HEX, 32));
    corpus.push(
      `${pick(next, HEX, 8)}-${pick(next, HEX, 4)}-4${pick(next, HEX, 3)}-a${pick(next, HEX, 3)}-${pick(next, HEX, 12)}`,
    );
  }
  return corpus;
}

/**
 * The short tokens, which clear the rule on a coin toss rather than on their
 * shape: a sixteen-character span id drawn with no letter at all (about one in
 * eighteen hundred) reads as a digit run, and a ULID qualifies on carrying two
 * digits rather than on being hex. Both are submitted when the draw goes that
 * way, so the assertion below is a rate and not a zero — an exact zero would be
 * true of one seed and would claim something the rule does not deliver.
 */
function shortTokenCorpus(seed: number): string[] {
  const next = seededRandom(seed);
  const corpus: string[] = [];
  for (let i = 0; i < 600; i++) {
    corpus.push(pick(next, HEX, 16));
    corpus.push(`session_${pick(next, CROCKFORD, 26)}`);
  }
  return corpus;
}

const NAME_PARTS = [
  "Jean",
  "Claude",
  "Anne",
  "Marie",
  "Maria",
  "Schmidt",
  "Wolfgang",
  "Amadeus",
  "Mozart",
  "Gonzalez",
  "Rodriguez",
  "Saint",
  "Baptiste",
  "Johansson",
  "Pierre",
  "Dupont",
];

/**
 * Personal names in the forms that have no space to save them: hyphenated,
 * dotted, and run together. This is the direction that regressed once, when the
 * analysis path borrowed the native engine's shape rule, so it is generated
 * rather than hand-picked.
 */
function nameCorpus(seed: number): string[] {
  const next = seededRandom(seed);
  const names: string[] = [];
  while (names.length < 2000) {
    const parts = 2 + Math.floor(next() * 3);
    const picked = Array.from(
      { length: parts },
      () => NAME_PARTS[Math.floor(next() * NAME_PARTS.length)]!,
    );
    const separator = [" ", "-", ".", ""][Math.floor(next() * 4)]!;
    names.push(picked.join(separator));
  }
  return names;
}

describe("OtlpSpanPiiRedactionService identifier hold-out before analysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LANGWATCH_DATA_PRIVACY_ENFORCEMENT;
  });

  describe("given a span attribute whose whole value is one opaque identifier", () => {
    /** @scenario "An opaque identifier attribute value is never sent for analysis" */
    it("never submits a hex span id, and stores it unchanged", async () => {
      const { service, submitted } = makeService();
      const spanId = "c87fa28b188bd8ef";
      const span = spanWith({ "app.upstream_span": spanId });

      await service.redactSpan(span, null, "STRICT", TENANT);

      expect(submitted()).not.toContain(spanId);
      expect(attr(span, "app.upstream_span")).toBe(spanId);
    });

    /** @scenario "A corpus of opaque identifiers is never sent for analysis" */
    it.each([
      20260911, 99, 7,
    ])("never submits a trace id or a uuid, at seed %i", async (seed) => {
      const { service, submitted } = makeService();
      const corpus = unconditionalCorpus(seed);
      const span = spanWith(
        Object.fromEntries(
          corpus.map((value, index) => [`app.ref_${index}`, value]),
        ),
      );

      await service.redactSpan(span, null, "STRICT", TENANT);

      const leaked = corpus.filter((value) => submitted().includes(value));
      expect(leaked).toEqual([]);
    });

    /** @scenario "A corpus of short opaque tokens is almost never sent for analysis" */
    it.each([
      20260911, 99, 7,
    ])("submits fewer than one short token in a hundred, at seed %i", async (seed) => {
      const { service, submitted } = makeService();
      const corpus = shortTokenCorpus(seed);
      const span = spanWith(
        Object.fromEntries(
          corpus.map((value, index) => [`app.token_${index}`, value]),
        ),
      );

      await service.redactSpan(span, null, "STRICT", TENANT);

      const leaked = corpus.filter((value) => submitted().includes(value));
      expect(leaked.length / corpus.length).toBeLessThan(0.01);
    });
  });

  describe("given a reserved trace identifier attribute", () => {
    /** @scenario "A reserved trace identifier attribute is never sent for analysis" */
    it("never submits a decimal trace id, which no shape rule would hold back", async () => {
      const { service, submitted } = makeService();
      // A decimal trace id carries no letter, so the shape rules read it as
      // digits rather than as an identifier. The reserved name is what keeps it.
      const decimalTraceId = "17575001234540000091234567890123";
      const span = spanWith({ "metadata.trace_id": decimalTraceId });

      await service.redactSpan(span, null, "STRICT", TENANT);

      expect(submitted()).not.toContain(decimalTraceId);
    });

    /** @scenario "A reserved identifier attribute survives even when its value is all digits" */
    it("stores a decimal trace id unchanged at the default level", async () => {
      const { service, batchSpy } = makeService({
        ...STRICT_POLICY,
        pii: { level: "essential", entities: [], exceptPatterns: [] },
      });
      const decimalTraceId = "17575001234540000091234567890123";
      const span = spanWith({ "metadata.otelTraceId": decimalTraceId });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      expect(attr(span, "metadata.otelTraceId")).toBe(decimalTraceId);
      expect(batchSpy).not.toHaveBeenCalled();
    });
  });

  describe("given an attribute that carries prose", () => {
    /** @scenario "Prose that holds a name is still sent for analysis" */
    it("submits a sentence naming a person", async () => {
      const { service, submitted } = makeService();
      const sentence = "the ticket was raised by Jane Doe in Berlin";
      const span = spanWith({ "langwatch.input": sentence });

      await service.redactSpan(span, null, "STRICT", TENANT);

      expect(submitted()).toContain(sentence);
    });

    /** @scenario "A customer identifier that holds a person name is still sent for analysis" */
    it("submits a user identifier attribute holding a person name", async () => {
      const { service, submitted } = makeService();
      const span = spanWith({ "langwatch.user_id": "Jane Doe" });

      await service.redactSpan(span, null, "STRICT", TENANT);

      expect(submitted()).toContain("Jane Doe");
    });

    // The hold-out reads a whole attribute value, so a name written as ONE
    // token is the case it can swallow. A control that uses "Jane Doe" only
    // passes because of the space and guards nothing; these are the forms that
    // have no space to save them.
    /** @scenario "A hyphenated or run-together name is still sent for analysis" */
    it("submits names written with hyphens, with dots and with no separator", async () => {
      const { service, submitted } = makeService();
      const names = [
        "Jean-Claude-Van-Damme",
        "Gonzalez-Rodriguez-Maria",
        "Wolfgang-Amadeus-Mozart",
        "AnneMarieJohansson",
        "maria.schmidt.1972",
      ];
      const span = spanWith(
        Object.fromEntries(
          names.map((value, index) => [`langwatch.user_id_${index}`, value]),
        ),
      );

      await service.redactSpan(span, null, "STRICT", TENANT);

      const withheld = names.filter((name) => !submitted().includes(name));
      expect(withheld).toEqual([]);
    });

    /** @scenario "A place written as one hyphenated token is still sent for analysis" */
    it("submits a hyphenated place and a hyphenated street address", async () => {
      const { service, submitted } = makeService();
      const span = spanWith({
        "patient.clinic": "Saint-Jean-Baptiste-Hospital",
        "shipping.address_line": "Elm-Street-Apartment-4B",
      });

      await service.redactSpan(span, null, "STRICT", TENANT);

      expect(submitted()).toContain("Saint-Jean-Baptiste-Hospital");
      expect(submitted()).toContain("Elm-Street-Apartment-4B");
    });

    // The figure quoted in the pull request comes from here. `heldByShapeRule`
    // is not a second implementation of the hold-out: it calls the native
    // engine's rule directly, to keep the size of the regression this fixed
    // measured rather than remembered.
    /** @scenario "A corpus of written names is still sent for analysis" */
    it("submits every one of two thousand generated names", async () => {
      const { service, submitted } = makeService();
      const names = nameCorpus(4242);
      const span = spanWith(
        Object.fromEntries(
          names.map((value, index) => [`langwatch.user_id_${index}`, value]),
        ),
      );

      await service.redactSpan(span, null, "STRICT", TENANT);

      const singleToken = names.filter((name) => !name.includes(" "));
      const heldByShapeRule = names.filter((name) =>
        isIdentifierShapedValue(name),
      );
      const withheld = names.filter((name) => !submitted().includes(name));

      expect(names).toHaveLength(2000);
      expect(singleToken.length).toBeGreaterThan(1400);
      expect(heldByShapeRule.length).toBeGreaterThan(700);
      expect(withheld).toEqual([]);
    });

    it("submits a run-together name carried in the chat content itself", async () => {
      const { service, submitted } = makeService();
      const span = spanWith({ "gen_ai.prompt": "AnneMarieJohansson" });

      await service.redactSpan(span, null, "STRICT", TENANT);

      expect(submitted()).toContain("AnneMarieJohansson");
    });
  });

  describe("given a log record", () => {
    /** @scenario "Log attributes hold opaque identifiers back from analysis" */
    it("submits the body but never the identifier attribute", async () => {
      const { service, submitted } = makeService();
      const traceId = "a4f19c2b7e83d05611aa0cbe94d7f2e8";
      const log = {
        body: "request handled for Jane Doe",
        attributes: { "app.correlation": traceId },
        resourceAttributes: {},
      };

      await service.redactLog(log, "STRICT", TENANT);

      expect(submitted()).not.toContain(traceId);
      expect(submitted()).toContain("request handled for Jane Doe");
    });
  });

  describe("given metric attributes", () => {
    /** @scenario "Metric attributes hold opaque identifiers back from analysis" */
    it("never submits an identifier attribute, and still submits prose", async () => {
      const { service, submitted } = makeService();
      const traceId = "a4f19c2b7e83d05611aa0cbe94d7f2e8";
      const metric = {
        attributes: {
          "app.correlation": traceId,
          "app.note": "raised by Jane",
        },
        resourceAttributes: {},
      };

      await service.redactMetricAttributes(metric, "STRICT", TENANT);

      expect(submitted()).not.toContain(traceId);
      expect(submitted()).toContain("raised by Jane");
    });
  });
});
