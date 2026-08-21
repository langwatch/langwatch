/**
 * Unit coverage for derived ingestion-source health.
 *
 * The case this exists for: a source that authenticates, polls, and returns
 * nothing, forever, while `status` says `awaiting_first_event` — which is
 * also what a source created five minutes ago says. That ambiguity is how
 * the retired `copilot_studio` source stayed invisible for months.
 *
 * Spec: specs/ai-governance/puller-framework/microsoft-365-audit.feature
 */
import { describe, expect, it } from "vitest";

import {
  classifyIngestionSourceHealth,
  ERRORING_AFTER_CONSECUTIVE_FAILURES,
  HEALTH_COPY,
  NEVER_PRODUCED_AFTER_MS,
} from "../ingestionSourceHealth";

const NOW = Date.parse("2026-05-03T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms);

describe("classifyIngestionSourceHealth", () => {
  describe("given a source that has never produced an event", () => {
    describe("when it has been silent for longer than the threshold", () => {
      /** @scenario "Prolonged zero-event ingestion is surfaced, not read as a quiet tenant" */
      it("reports it as never having produced, and says it is not erroring", () => {
        const health = classifyIngestionSourceHealth({
          status: "awaiting_first_event",
          createdAt: ago(NEVER_PRODUCED_AFTER_MS + 1),
          lastEventAt: null,
          errorCount: 0,
          nowMs: NOW,
        });

        expect(health).toBe("never_produced");
        expect(HEALTH_COPY[health].detail).toMatch(/not reporting errors/);
      });
    });

    describe("when it has been silent but has not yet reached the threshold", () => {
      /** @scenario "Prolonged zero-event ingestion is surfaced, not read as a quiet tenant" */
      it("does not fire on a source that is merely quiet overnight", () => {
        expect(
          classifyIngestionSourceHealth({
            status: "awaiting_first_event",
            createdAt: ago(NEVER_PRODUCED_AFTER_MS - 60_000),
            lastEventAt: null,
            errorCount: 0,
            nowMs: NOW,
          }),
        ).toBe("awaiting_first_event");
      });
    });

    describe("when consecutive failures have reached the erroring threshold", () => {
      /** @scenario "Prolonged zero-event ingestion is surfaced, not read as a quiet tenant" */
      it("reports it as erroring rather than as silent", () => {
        expect(
          classifyIngestionSourceHealth({
            status: "awaiting_first_event",
            createdAt: ago(NEVER_PRODUCED_AFTER_MS + 1),
            lastEventAt: null,
            errorCount: ERRORING_AFTER_CONSECUTIVE_FAILURES,
            nowMs: NOW,
          }),
        ).toBe("erroring");
      });
    });

    describe("when a silent, a fresh and a failing source are compared", () => {
      /** @scenario "Prolonged zero-event ingestion is surfaced, not read as a quiet tenant" */
      it("gives three different answers to three sources storing one status", () => {
        const shared = {
          status: "awaiting_first_event" as const,
          lastEventAt: null,
          nowMs: NOW,
        };

        const silent = classifyIngestionSourceHealth({
          ...shared,
          createdAt: ago(NEVER_PRODUCED_AFTER_MS + 1),
          errorCount: 0,
        });
        const fresh = classifyIngestionSourceHealth({
          ...shared,
          createdAt: ago(5 * 60 * 1000),
          errorCount: 0,
        });
        const failing = classifyIngestionSourceHealth({
          ...shared,
          createdAt: ago(NEVER_PRODUCED_AFTER_MS + 1),
          errorCount: ERRORING_AFTER_CONSECUTIVE_FAILURES,
        });

        // All three carry the same stored `status`. The point is that they no
        // longer read the same to an operator.
        expect(new Set([silent, fresh, failing]).size).toBe(3);
      });
    });

    describe("when the source was only just enabled", () => {
      /** @scenario "First run after enabling reports that history is not available" */
      it("tells an operator that a pull source does not import history", () => {
        const health = classifyIngestionSourceHealth({
          status: "awaiting_first_event",
          createdAt: ago(60_000),
          lastEventAt: null,
          errorCount: 0,
          nowMs: NOW,
        });

        expect(health).toBe("awaiting_first_event");
        // An empty first window is not reported as healthy steady state — the
        // copy says why it is empty and what it does not cover.
        expect(HEALTH_COPY[health].detail).toMatch(/do not import history/);
        expect(HEALTH_COPY[health].label).not.toBe(HEALTH_COPY.active.label);
      });
    });
  });

  describe("given an admin has explicitly disabled the source", () => {
    describe("when every derived signal would say something worse", () => {
      it("lets the explicit admin action outrank any derived judgement", () => {
        expect(
          classifyIngestionSourceHealth({
            status: "disabled",
            createdAt: ago(NEVER_PRODUCED_AFTER_MS * 10),
            lastEventAt: null,
            errorCount: 99,
            nowMs: NOW,
          }),
        ).toBe("disabled");
      });
    });
  });

  describe("given events have arrived on the source", () => {
    describe("when the source has been running far longer than the threshold", () => {
      it("calls the source active once anything has arrived", () => {
        expect(
          classifyIngestionSourceHealth({
            status: "active",
            createdAt: ago(NEVER_PRODUCED_AFTER_MS * 3),
            lastEventAt: ago(60_000),
            errorCount: 0,
            nowMs: NOW,
          }),
        ).toBe("active");
      });
    });
  });
});
