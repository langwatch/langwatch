import {
  defaultTextMapGetter,
  defaultTextMapSetter,
  propagation,
  ROOT_CONTEXT,
  trace,
  TraceFlags,
  type Context,
} from "@opentelemetry/api";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";

import { BraidBaggageSpanProcessor, BraidSigningError, BRAID_SIGNATURE_KEY } from "..";
import { computeBraidSignature, signBaggage } from "../sign-baggage";

const SIGNING_KEY = "lwsk_testkid_testsecret";
const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const ENTRIES = { orchestrator: "web", team: "a" };
// Pinned in sdks/python/tests/telemetry/test_braid_signing.py and sdks/go/braids_test.go too.
const PINNED_SIGNATURE =
  "eyJ2IjoxLCJraWQiOiJ0ZXN0a2lkIiwia2V5cyI6WyJvcmNoZXN0cmF0b3IiLCJ0ZWFtIl0sInNpZyI6IjFNWGtzUVIzc25vdVBZV0Z4TzVDZnlyRzY2WUQ1MzlhbmNlbWVRaG9VazQifQ";
// orchestrator "web" alone in TRACE_ID. The API key module verifies this exact value
// (modules/api-key/process/src/services/__tests__/signing-key.signed-calls.service.unit.test.ts).
const CALL_SIGNATURE =
  "eyJ2IjoxLCJraWQiOiJ0ZXN0a2lkIiwia2V5cyI6WyJvcmNoZXN0cmF0b3IiXSwic2lnIjoiSjg2RU1MejJXUVZlZkpLN1BfN1R2UmEtdzRvR000TG96bjhlZTNMd0kyRSJ9";

function contextInTrace(): Context {
  return trace.setSpanContext(ROOT_CONTEXT, {
    traceId: TRACE_ID,
    spanId: "b7ad6b7169203331",
    traceFlags: TraceFlags.SAMPLED,
  });
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof BraidSigningError) return error.code;
    throw error;
  }
  return undefined;
}

describe("braid signing", () => {
  describe("given the pinned vector", () => {
    /** @scenario "The pinned vector produces the shared signature" */
    it("produces the signature every SDK pins", () => {
      const signature = computeBraidSignature({
        signingKey: SIGNING_KEY,
        traceId: TRACE_ID,
        entries: { team: "a", orchestrator: "web" },
      });
      expect(signature).toBe(PINNED_SIGNATURE);
      expect(JSON.parse(Buffer.from(signature, "base64url").toString("utf8"))).toEqual({
        v: 1,
        kid: "testkid",
        keys: ["orchestrator", "team"],
        sig: "1MXksQR3snouPYWFxO5CfyrG66YD539ancemeQhoUk4",
      });
    });
  });

  describe("given a context holding a span", () => {
    /** @scenario "Signing puts each entry and the signature in baggage" */
    it("puts the entries and the signature in its baggage", () => {
      const ctx = signBaggage({
        signingKey: SIGNING_KEY,
        entries: ENTRIES,
        context: contextInTrace(),
      });
      const baggage = propagation.getBaggage(ctx);
      expect(baggage?.getEntry("orchestrator")?.value).toBe("web");
      expect(baggage?.getEntry("team")?.value).toBe("a");
      expect(baggage?.getEntry(BRAID_SIGNATURE_KEY)?.value).toBe(PINNED_SIGNATURE);
    });
  });

  describe("when signing is refused", () => {
    /** @scenario "A signing key not of the form lwsk_<publicId>_<secret> is refused" */
    it("refuses a malformed signing key", () => {
      for (const signingKey of [
        "not-a-key",
        "lwsk_",
        "lwsk_kid",
        "lwsk__secret",
        "lwsk_kid_",
        "lwsk_k-id_secret",
        "lwsk_k.id_secret",
        "lwsk_kïd_secret",
      ]) {
        expect(
          codeOf(() => signBaggage({ signingKey, entries: ENTRIES, context: contextInTrace() })),
        ).toBe("malformed_signing_key");
      }
    });

    /** @scenario "An entry key outside the allowed pattern is refused" */
    it("refuses an entry key outside the pattern", () => {
      for (const key of ["bad key", "", "x".repeat(129), "é", BRAID_SIGNATURE_KEY]) {
        expect(
          codeOf(() =>
            signBaggage({
              signingKey: SIGNING_KEY,
              entries: { [key]: "v" },
              context: contextInTrace(),
            }),
          ),
        ).toBe("invalid_entry_key");
      }
    });

    /** @scenario "An entry value holding a line break is refused" */
    it("refuses a value holding a line break", () => {
      for (const value of ["x\nteam=a", "x\r", "\n"]) {
        expect(
          codeOf(() =>
            signBaggage({
              signingKey: SIGNING_KEY,
              entries: { orchestrator: value },
              context: contextInTrace(),
            }),
          ),
        ).toBe("invalid_entry_value");
      }
    });

    /** @scenario "An empty set of entries is refused" */
    it("refuses an empty entry set", () => {
      expect(
        codeOf(() =>
          signBaggage({ signingKey: SIGNING_KEY, entries: {}, context: contextInTrace() }),
        ),
      ).toBe("empty_entries");
    });

    /** @scenario "Signing outside a trace is refused" */
    it("refuses a context holding no span", () => {
      expect(
        codeOf(() =>
          signBaggage({ signingKey: SIGNING_KEY, entries: ENTRIES, context: ROOT_CONTEXT }),
        ),
      ).toBe("no_active_trace");
    });
  });
});

describe("BraidBaggageSpanProcessor", () => {
  function startSpanUnder({ copyEntries, ctx }: { copyEntries: string[]; ctx: Context }) {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [
        new BraidBaggageSpanProcessor({ copyEntries }),
        new SimpleSpanProcessor(exporter),
      ],
    });
    provider.getTracer("braids-test").startSpan("called", {}, ctx).end();
    const [span] = exporter.getFinishedSpans();
    return span!;
  }

  describe("given the copy processor for orchestrator and team", () => {
    /** @scenario "A span started under signed baggage carries the entries and the signature" */
    it("copies the entries and the signature onto the span", () => {
      const ctx = signBaggage({
        signingKey: SIGNING_KEY,
        entries: ENTRIES,
        context: contextInTrace(),
      });
      const span = startSpanUnder({ copyEntries: ["orchestrator", "team"], ctx });
      expect(span.attributes).toMatchObject({
        orchestrator: "web",
        team: "a",
        [BRAID_SIGNATURE_KEY]: PINNED_SIGNATURE,
      });
      expect(span.spanContext().traceId).toBe(TRACE_ID);
    });
  });

  describe("given a calling service signing and a called service copying orchestrator", () => {
    /** @scenario "The <language> SDK signs the named entries and copies them onto spans" */
    it("carries the entry and its signature onto every span the called service records", () => {
      const wire = new CompositePropagator({
        propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
      });
      const headers: Record<string, string> = {};
      const calling = signBaggage({
        signingKey: SIGNING_KEY,
        entries: { orchestrator: "web" },
        context: contextInTrace(),
      });
      wire.inject(calling, headers, defaultTextMapSetter);

      const exporter = new InMemorySpanExporter();
      const called = new BasicTracerProvider({
        spanProcessors: [
          new BraidBaggageSpanProcessor({ copyEntries: ["orchestrator"] }),
          new SimpleSpanProcessor(exporter),
        ],
      }).getTracer("called-service");
      const received = wire.extract(ROOT_CONTEXT, headers, defaultTextMapGetter);
      const handler = called.startSpan("handle call", {}, received);
      called.startSpan("tool", {}, trace.setSpan(received, handler)).end();
      handler.end();

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(2);
      for (const span of spans) {
        expect(span.spanContext().traceId).toBe(TRACE_ID);
        expect(span.attributes).toMatchObject({
          orchestrator: "web",
          [BRAID_SIGNATURE_KEY]: CALL_SIGNATURE,
        });
      }
    });
  });

  describe("given the copy processor for orchestrator only", () => {
    /** @scenario "Entries the processor was not told to copy stay off the span" */
    it("leaves unnamed entries off the span", () => {
      const baggage = propagation.createBaggage({
        orchestrator: { value: "web" },
        secretish: { value: "x" },
      });
      const ctx = propagation.setBaggage(contextInTrace(), baggage);
      const span = startSpanUnder({ copyEntries: ["orchestrator"], ctx });
      expect(span.attributes.orchestrator).toBe("web");
      expect(span.attributes).not.toHaveProperty("secretish");
    });
  });
});
