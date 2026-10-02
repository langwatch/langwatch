import type { MonthCountedEventData } from "@langwatch/usage-contract";
import { describe, expect, it } from "vitest";

import {
  monthCounted,
  REFUSED_ORGANIZATIONS_WAKE_MS,
  refusedOrganizationWake,
} from "../refused-organizations.process.ts";

const NOW = Date.UTC(2026, 9, 15);

const ctx = {
  at: NOW,
  now: NOW,
  key: "org_1",
  projectId: "org_1",
  intent: (name: string, key: string) => ({ messageKey: key, intentType: name, payload: null }),
};

const counted = (billableEvents: number, allowance = 1_000): MonthCountedEventData => ({
  organizationId: "org_1",
  month: "2026-10",
  occurredAt: NOW,
  billableEvents,
  limit: { allowance, planName: "Launch", unit: "events" },
});

describe("refusedOrganizations", () => {
  it("a refusal records the decision and arms the recount", () => {
    const result = monthCounted({ month: null, reached: false }, counted(1_000), ctx);
    expect(result.intents?.map((intent) => intent.intentType)).toEqual(["recordLimitDecision"]);
    expect(result.nextWakeAt).toBe(NOW + REFUSED_ORGANIZATIONS_WAKE_MS);
  });

  it("a clearing records the decision and disarms the recount", () => {
    const result = monthCounted({ month: "2026-10", reached: true }, counted(1_000, 10_000), ctx);
    expect(result.intents?.map((intent) => intent.intentType)).toEqual(["recordLimitDecision"]);
    expect(result.nextWakeAt).toBeNull();
  });

  it("a wake on a refused organization recounts it and re-arms", () => {
    const result = refusedOrganizationWake({ month: "2026-10", reached: true }, ctx);
    expect(result.intents?.map((intent) => intent.intentType)).toEqual(["countMonth"]);
    expect(result.nextWakeAt).toBe(NOW + REFUSED_ORGANIZATIONS_WAKE_MS);
  });

  it("a wake on an organization under its limit does nothing", () => {
    const result = refusedOrganizationWake({ month: "2026-10", reached: false }, ctx);
    expect(result).toEqual({ state: { month: "2026-10", reached: false }, nextWakeAt: null });
  });
});
