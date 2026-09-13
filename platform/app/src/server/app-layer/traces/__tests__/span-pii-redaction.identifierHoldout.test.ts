import { beforeEach, describe, expect, it, vi } from "vitest";

// The analysis service is the boundary under test: what LEAVES the process is
// the observable contract, so the batch function is spied on and the rest of
// the redaction stack runs for real.
//
// Every trace and span identifier below is GENERATED, never observed: each is
// drawn from the same mulberry32 generator the corpus tests use, seeded
// 20260912, over the hex alphabet. Nothing here names a real trace.
vi.mock("~/server/featureFlag", () => ({
  featureFlagService: { isEnabled: vi.fn(async () => false) },
}));

vi.mock("~/server/tracer/collector/piiCheck", () => ({
  batchPresidioClearPII: vi.fn(),
  googleDLPClearPII: vi.fn(),
  PRESIDIO_STRICT_ENTITIES: ["PERSON", "LOCATION", "EMAIL_ADDRESS"],
}));

import { CollectorSpanUtils } from "~/server/traces/collectorSpan.utils";
import {
  attr,
  DECIMAL_TRACE_ID_READ_AS_A_PHONE_NUMBER,
  makeService,
  resourceAttr,
  STRICT_POLICY,
  shortTokenCorpus,
  spanWith,
  TENANT,
  unconditionalCorpus,
} from "./span-pii-redaction.identifierHoldout.harness";

/**
 * Prose carrying a name and a place, which the analysis service must be offered.
 * It is the control every hold-out assertion in this file is measured against:
 * these tests assert that things were NOT submitted, and that is only evidence
 * of a working hold-out if something WAS.
 */
const PROSE_THAT_MUST_BE_ANALYSED =
  "the ticket was raised by Jane Doe in Berlin";

/**
 * What the hold-out KEEPS: an attribute value that is one opaque identifier, and
 * an attribute under one of the reserved trace and span names carrying the
 * address that name promises. Both are asserted on the stored value and on what
 * was submitted, because a rule that kept the value but still sent it for
 * analysis would leak it just the same.
 */
describe("OtlpSpanPiiRedactionService identifier hold-out before analysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LANGWATCH_DATA_PRIVACY_ENFORCEMENT;
  });

  describe("given a span attribute whose whole value is one opaque identifier", () => {
    /** @scenario "An opaque identifier attribute value is never sent for analysis" */
    it("never submits a hex span id, and stores it unchanged", async () => {
      const { service, submitted } = makeService();
      const spanId = "f52185dd67918e00";
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
      const span = spanWith({
        ...Object.fromEntries(
          corpus.map((value, index) => [`app.ref_${index}`, value]),
        ),
        // The positive control, in the same span as the corpus. Without it an
        // empty submission list satisfies the assertion below, so a hold-out
        // that worked and an analysis pass that never ran read identically —
        // and the corpus generator now lives in another file, where it could
        // start returning nothing without this suite noticing.
        "app.support_note": PROSE_THAT_MUST_BE_ANALYSED,
      });

      await service.redactSpan(span, null, "STRICT", TENANT);

      expect(corpus).toHaveLength(600);
      expect(submitted()).toContain(PROSE_THAT_MUST_BE_ANALYSED);
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

    // The reserved names are not a namespace anyone owns: attributes arrive on
    // the ingestion endpoint spelled exactly as the sender wrote them. A rule
    // that went on the name alone would let a sender turn the personal-data
    // pass off for any value at all, and the value is stored before anyone
    // could notice. The name has to be carrying something that could actually
    // be the address it promises.
    /** @scenario "A reserved trace identifier name holding an email address is redacted at the strict level" */
    it("redacts an email address written under a reserved name, and never submits it in the clear", async () => {
      const { service, submitted } = makeService();
      const span = spanWith({ "metadata.trace_id": "jane@example.com" });

      await service.redactSpan(span, null, "STRICT", TENANT);

      expect(attr(span, "metadata.trace_id")).toBe("[EMAIL_ADDRESS]");
      expect(submitted()).not.toContain("jane@example.com");
    });

    /** @scenario "A reserved trace identifier name holding an email address is still redacted" */
    it("redacts an email address written under a reserved name natively", async () => {
      const { service } = makeService({
        ...STRICT_POLICY,
        pii: { level: "essential", entities: [], exceptPatterns: [] },
      });
      const span = spanWith({ "metadata.trace_id": "jane@example.com" });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      expect(attr(span, "metadata.trace_id")).toBe("[EMAIL_ADDRESS]");
    });

    // A decimal trace id and a card number are the same shape, so the reserved
    // name cannot be a blanket exemption: it stands the shape-only detectors
    // down, which is what it is for, and leaves the ones that can prove what
    // they are looking at running. The control above it is the decimal trace id
    // that must survive, which is what makes this a rule about proof rather
    // than a rule about length.
    /** @scenario "A card number written under a reserved trace identifier name is still redacted" */
    it("redacts a valid card number written under a reserved name", async () => {
      const { service } = makeService({
        ...STRICT_POLICY,
        pii: { level: "essential", entities: [], exceptPatterns: [] },
      });
      const span = spanWith({ "metadata.trace_id": "4111111111111111" });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      expect(attr(span, "metadata.trace_id")).toBe("[CREDIT_CARD]");
    });

    // The control is the same value under a name nobody reserved. Without it
    // this test asserts that a value survives redaction, which almost every
    // value does, and it would stay green with the catalog deleted. With it,
    // the only difference between the two halves is the name, so the catalog is
    // what is being measured.
    /** @scenario "A decimal trace identifier a phone detector claims is kept under a reserved name" */
    it.each([
      ["the raw OTLP spelling", "metadata.trace_id"],
      ["the spelling the REST collector writes", "langwatch.metadata.trace_id"],
      // The canonicaliser folds `langwatch.trace.*` into `metadata.*` on the
      // same list as `langwatch.metadata.*`, so a sender may spell it either
      // way and the hold-out has to answer the same for both.
      ["the trace namespace spelling", "langwatch.trace.trace_id"],
    ])("keeps a decimal trace id a phone detector claims, under %s", async (_case, key) => {
      const { service } = makeService({
        ...STRICT_POLICY,
        pii: { level: "essential", entities: [], exceptPatterns: [] },
      });
      const traceId = DECIMAL_TRACE_ID_READ_AS_A_PHONE_NUMBER;
      const span = spanWith({
        [key]: traceId,
        "app.unreserved_ref": traceId,
      });

      await service.redactSpan(span, null, "ESSENTIAL", TENANT);

      expect(attr(span, key)).toBe(traceId);
      expect(attr(span, "app.unreserved_ref")).toBe("[PHONE_NUMBER]");
    });
  });

  // Custom metadata does not reach redaction spelled the way the caller wrote
  // it. The REST collector rewrites every key to `langwatch.metadata.<key>`
  // before the span is dispatched, and the canonicalisation back to
  // `metadata.<key>` happens in the projections, long after redaction has run
  // and long after anything it destroyed is unrecoverable. So the spelling the
  // catalog is consulted with is the prefixed one, for every first-party sender
  // -- the REST collector and the SDKs behind it. A test that hand-writes
  // `metadata.trace_id` exercises only what a raw OTLP caller can send.
  //
  // The resource is therefore built by the collector's own function rather than
  // by this file, so the rewrite under test is the production one.
  describe("given caller metadata rewritten by the REST collector", () => {
    /** @scenario "Caller metadata keeps a reserved trace identifier through the REST collector rewrite" */
    it("keeps a decimal trace id sent as caller metadata, and never submits it", async () => {
      const { service, submitted } = makeService();
      const traceId = DECIMAL_TRACE_ID_READ_AS_A_PHONE_NUMBER;
      const resource = CollectorSpanUtils.buildResource({
        reservedTraceMetadata: {},
        customMetadata: { trace_id: traceId, request_ref: traceId },
      });

      expect(resourceAttr(resource, "langwatch.metadata.trace_id")).toBe(
        traceId,
      );

      await service.redactSpan(spanWith({}), resource, "STRICT", TENANT);

      expect(resourceAttr(resource, "langwatch.metadata.trace_id")).toBe(
        traceId,
      );
      expect(submitted()).not.toContain(traceId);
      // Same value, a name nobody reserved: the detector does fire here, so the
      // assertion above is about the name and not about the value.
      expect(resourceAttr(resource, "langwatch.metadata.request_ref")).toBe(
        "[PHONE_NUMBER]",
      );
    });
  });
});
