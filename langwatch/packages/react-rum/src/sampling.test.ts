/**
 * @vitest-environment jsdom
 *
 * See ADR-058 and specs/observability/browser-rum-trace-correlation.feature.
 */
import { ROOT_CONTEXT, SpanKind, trace } from "@opentelemetry/api";
import { SamplingDecision } from "@opentelemetry/sdk-trace-base";
import { beforeEach, describe, expect, it } from "vitest";

import { createBrowserSampler, SessionRatioSampler } from "./sampling";

const SESSION_ID_KEY = "langwatch.rum.session.id";
const SESSION_LAST_SEEN_KEY = "langwatch.rum.session.lastSeen";

/** Pins the visit to a session whose leading 32 bits land where we want them. */
const visitWith = (sessionId: string) => {
  window.sessionStorage.setItem(SESSION_ID_KEY, sessionId);
  window.sessionStorage.setItem(SESSION_LAST_SEEN_KEY, String(Date.now()));
};

/** Session ids are hex; the first eight characters decide. */
const LOW_SESSION = `00000000${"a".repeat(24)}`; // ~0.0 → inside any ratio
const HIGH_SESSION = `ffffffff${"a".repeat(24)}`; // ~1.0 → outside any ratio

const decide = (sampler: {
  shouldSample: SessionRatioSampler["shouldSample"];
}) =>
  sampler.shouldSample(
    ROOT_CONTEXT,
    "0af7651916cd43dd8448eb211c80319c",
    "navigation /:project/traces",
    SpanKind.INTERNAL,
    {},
    [],
  ).decision;

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("SessionRatioSampler", () => {
  describe("given the ratio records everything", () => {
    describe("when a trace starts", () => {
      it("records it without consulting the session", () => {
        expect(decide(new SessionRatioSampler(1))).toBe(
          SamplingDecision.RECORD_AND_SAMPLED,
        );
      });
    });
  });

  describe("given the ratio records nothing", () => {
    describe("when a trace starts", () => {
      it("drops it", () => {
        visitWith(LOW_SESSION);

        expect(decide(new SessionRatioSampler(0))).toBe(
          SamplingDecision.NOT_RECORD,
        );
      });
    });
  });

  describe("given a partial ratio", () => {
    describe("when several traces happen in one visit", () => {
      it("decides the same way every time, so a visit is whole", () => {
        visitWith(LOW_SESSION);
        const sampler = new SessionRatioSampler(0.1);

        expect(decide(sampler)).toBe(SamplingDecision.RECORD_AND_SAMPLED);
        expect(decide(sampler)).toBe(SamplingDecision.RECORD_AND_SAMPLED);
        expect(decide(sampler)).toBe(SamplingDecision.RECORD_AND_SAMPLED);
      });
    });

    describe("when a visit falls outside the ratio", () => {
      it("drops the whole visit rather than part of it", () => {
        visitWith(HIGH_SESSION);
        const sampler = new SessionRatioSampler(0.1);

        expect(decide(sampler)).toBe(SamplingDecision.NOT_RECORD);
        expect(decide(sampler)).toBe(SamplingDecision.NOT_RECORD);
      });
    });

    describe("when the visit rotates to a new session", () => {
      it("decides again for the new visit", () => {
        visitWith(HIGH_SESSION);
        const sampler = new SessionRatioSampler(0.1);
        expect(decide(sampler)).toBe(SamplingDecision.NOT_RECORD);

        visitWith(LOW_SESSION);

        expect(decide(sampler)).toBe(SamplingDecision.RECORD_AND_SAMPLED);
      });
    });

    describe("when it samples across many visits", () => {
      it("keeps roughly the share it was asked for", () => {
        const sampler = new SessionRatioSampler(0.25);
        let sampled = 0;

        for (let visit = 0; visit < 400; visit++) {
          const leading = ((visit * 0x9e3779b1) >>> 0)
            .toString(16)
            .padStart(8, "0");
          visitWith(`${leading}${"0".repeat(24)}`);
          if (decide(sampler) === SamplingDecision.RECORD_AND_SAMPLED) sampled++;
        }

        expect(sampled / 400).toBeGreaterThan(0.15);
        expect(sampled / 400).toBeLessThan(0.35);
      });
    });
  });

  describe("given storage the browser will not hand over", () => {
    describe("when a trace starts", () => {
      it("falls back to a single draw rather than deciding per trace", () => {
        const sampler = new SessionRatioSampler(0.5, 0.9);
        const original = Object.getOwnPropertyDescriptor(
          window,
          "sessionStorage",
        )!;
        Object.defineProperty(window, "sessionStorage", {
          configurable: true,
          get() {
            throw new Error("denied");
          },
        });

        try {
          expect(decide(sampler)).toBe(SamplingDecision.NOT_RECORD);
          expect(decide(sampler)).toBe(SamplingDecision.NOT_RECORD);
        } finally {
          Object.defineProperty(window, "sessionStorage", original);
        }
      });
    });
  });

  describe("given a nonsense ratio", () => {
    describe("when a trace starts", () => {
      it("records rather than silently collecting nothing", () => {
        expect(decide(new SessionRatioSampler(Number.NaN))).toBe(
          SamplingDecision.RECORD_AND_SAMPLED,
        );
        expect(decide(new SessionRatioSampler(7))).toBe(
          SamplingDecision.RECORD_AND_SAMPLED,
        );
      });
    });
  });
});

describe("createBrowserSampler", () => {
  describe("given a visit that was not sampled", () => {
    describe("when a span is started under a parent that was", () => {
      it("follows the parent rather than deciding again", () => {
        visitWith(HIGH_SESSION);
        const sampler = createBrowserSampler({ ratio: 0.1 });

        const sampledParent = trace.setSpanContext(ROOT_CONTEXT, {
          traceId: "0af7651916cd43dd8448eb211c80319c",
          spanId: "b7ad6b7169203331",
          traceFlags: 1,
        });

        expect(
          sampler.shouldSample(
            sampledParent,
            "0af7651916cd43dd8448eb211c80319c",
            "GET /api/trpc",
            SpanKind.CLIENT,
            {},
            [],
          ).decision,
        ).toBe(SamplingDecision.RECORD_AND_SAMPLED);
      });
    });
  });
});
