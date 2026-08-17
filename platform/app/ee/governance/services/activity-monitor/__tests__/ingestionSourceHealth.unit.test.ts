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
  /** @scenario Prolonged zero-event ingestion is surfaced, not read as a quiet tenant */
  it("separates a long-silent source from a fresh one and from a failing one", () => {
    const silent = classifyIngestionSourceHealth(
      {
        status: "awaiting_first_event",
        createdAt: ago(NEVER_PRODUCED_AFTER_MS + 1),
        lastEventAt: null,
        errorCount: 0,
      },
      NOW,
    );

    const fresh = classifyIngestionSourceHealth(
      {
        status: "awaiting_first_event",
        createdAt: ago(5 * 60 * 1000),
        lastEventAt: null,
        errorCount: 0,
      },
      NOW,
    );

    const failing = classifyIngestionSourceHealth(
      {
        status: "awaiting_first_event",
        createdAt: ago(NEVER_PRODUCED_AFTER_MS + 1),
        lastEventAt: null,
        errorCount: ERRORING_AFTER_CONSECUTIVE_FAILURES,
      },
      NOW,
    );

    expect(silent).toBe("never_produced");
    expect(fresh).toBe("awaiting_first_event");
    expect(failing).toBe("erroring");

    // All three carry the same stored `status`. The point is that they no
    // longer read the same to an operator.
    expect(new Set([silent, fresh, failing]).size).toBe(3);
    expect(HEALTH_COPY[silent].detail).toMatch(/not reporting errors/);
  });

  /** @scenario First run after enabling reports that history is not available */
  it("tells an operator that a pull source does not import history", () => {
    const health = classifyIngestionSourceHealth(
      {
        status: "awaiting_first_event",
        createdAt: ago(60_000),
        lastEventAt: null,
        errorCount: 0,
      },
      NOW,
    );

    expect(health).toBe("awaiting_first_event");
    // An empty first window is not reported as healthy steady state — the
    // copy says why it is empty and what it does not cover.
    expect(HEALTH_COPY[health].detail).toMatch(/do not import history/);
    expect(HEALTH_COPY[health].label).not.toBe(HEALTH_COPY.active.label);
  });

  it("lets an explicit admin action outrank any derived judgement", () => {
    expect(
      classifyIngestionSourceHealth(
        {
          status: "disabled",
          createdAt: ago(NEVER_PRODUCED_AFTER_MS * 10),
          lastEventAt: null,
          errorCount: 99,
        },
        NOW,
      ),
    ).toBe("disabled");
  });

  it("calls a source active once anything has arrived", () => {
    expect(
      classifyIngestionSourceHealth(
        {
          status: "active",
          createdAt: ago(NEVER_PRODUCED_AFTER_MS * 3),
          lastEventAt: ago(60_000),
          errorCount: 0,
        },
        NOW,
      ),
    ).toBe("active");
  });

  it("does not fire on a source that is merely quiet overnight", () => {
    expect(
      classifyIngestionSourceHealth(
        {
          status: "awaiting_first_event",
          createdAt: ago(NEVER_PRODUCED_AFTER_MS - 60_000),
          lastEventAt: null,
          errorCount: 0,
        },
        NOW,
      ),
    ).toBe("awaiting_first_event");
  });
});
