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

import { isIdentifierShapedValue } from "~/server/data-privacy/redaction/identifierHoldout";
import {
  DECIMAL_TRACE_ID_READ_AS_A_PHONE_NUMBER,
  makeService,
  nameCorpus,
  spanWith,
  TENANT,
} from "./span-pii-redaction.identifierHoldout.harness";

/**
 * What still REACHES the analysis service: prose, names, and the corpora that
 * put a number on the hold-out's two residuals. The suite next door asserts what
 * the same rule keeps; this one is the other half, and the corpora are what stop
 * either half being widened without the cost showing up.
 */
describe("OtlpSpanPiiRedactionService what still reaches analysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LANGWATCH_DATA_PRIVACY_ENFORCEMENT;
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

    // Carrying an identifier is not the same as being one. A support message,
    // a log line or an error string routinely quotes the trace id it is about,
    // and a rule that held a value back as soon as it CONTAINED an opaque run
    // would stop scanning all of them — storing the names in the clear, which
    // is the failure this module exists to prevent arrived at from the other
    // side. Both separators are covered because "_" and "-" split a run while
    // a space does not, so the two spellings reach the rule differently.
    /** @scenario "Prose that quotes an opaque identifier is still sent for analysis" */
    it.each([
      ["a prefixed identifier", "trace_49386409e80a37fa22dc518583b31932"],
      ["a bare hex identifier", "49386409e80a37fa22dc518583b31932"],
    ])("submits a sentence naming a person next to %s", async (_case, id) => {
      const { service, submitted } = makeService();
      const sentence = `Jane Doe in Berlin reported this on ${id}`;
      const span = spanWith({ "app.support_note": sentence });

      await service.redactSpan(span, null, "STRICT", TENANT);

      expect(submitted()).toContain(sentence);
    });

    // The hold-out reads a whole attribute value, so a name written as ONE
    // token is the case it can swallow. A control that uses "Jane Doe" only
    // passes because of the space and guards nothing; these are the forms that
    // have no space to save them.
    /** @scenario "A hyphenated or run-together name is still sent for analysis" */
    it("submits names written with hyphens, with dots and with no separator", async () => {
      const { service, submitted } = makeService();
      const names = [
        "Elise-Marin-Van-Toren",
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

  // Logs and metrics reach the hold-out down a different path from spans: a
  // flattened record rather than an OTLP attribute list. Both halves of the
  // rule have to survive that trip, so each case below carries a hex value that
  // only the VALUE rule can hold back and a decimal address under a reserved
  // NAME that only the name half can — the hex one alone would pass with the
  // reserved list deleted.
  describe("given a log record", () => {
    /** @scenario "Log attributes hold opaque identifiers back from analysis" */
    it("submits the body but never the identifier attribute", async () => {
      const { service, submitted } = makeService();
      const traceId = "68b9a2bb9fe50f11959987b7bf94a7d9";
      const decimalTraceId = DECIMAL_TRACE_ID_READ_AS_A_PHONE_NUMBER;
      const log = {
        body: "request handled for Jane Doe",
        attributes: {
          "app.correlation": traceId,
          "metadata.trace_id": decimalTraceId,
        },
        resourceAttributes: {},
      };

      await service.redactLog(log, "STRICT", TENANT);

      expect(submitted()).not.toContain(traceId);
      expect(submitted()).not.toContain(decimalTraceId);
      expect(submitted()).toContain("request handled for Jane Doe");
    });
  });

  describe("given metric attributes", () => {
    /** @scenario "Metric attributes hold opaque identifiers back from analysis" */
    it("never submits an identifier attribute, and still submits prose", async () => {
      const { service, submitted } = makeService();
      const traceId = "68b9a2bb9fe50f11959987b7bf94a7d9";
      const decimalTraceId = DECIMAL_TRACE_ID_READ_AS_A_PHONE_NUMBER;
      const metric = {
        attributes: {
          "app.correlation": traceId,
          "metadata.trace_id": decimalTraceId,
          "app.note": "raised by Jane",
        },
        resourceAttributes: {},
      };

      await service.redactMetricAttributes(metric, "STRICT", TENANT);

      expect(submitted()).not.toContain(traceId);
      expect(submitted()).not.toContain(decimalTraceId);
      expect(submitted()).toContain("raised by Jane");
    });
  });
});
