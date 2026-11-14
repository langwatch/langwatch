// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The one answer to whether an ingestion source takes events.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */
import { describe, expect, it } from "vitest";

import {
  INGESTION_SOURCE_LIVE_STATUSES,
  ingestionSourceIsLive,
  ingestionSourceStatusIsOff,
} from "../features/ingestion/source-health.ts";

const ARCHIVED_AT = new Date("2026-11-13T10:00:00.000Z");

describe("ingestionSourceIsLive", () => {
  it.each([
    ["active", null, true],
    ["awaiting_first_event", null, true],
    ["disabled", null, false],
    ["active", ARCHIVED_AT, false],
    ["disabled", ARCHIVED_AT, false],
    ["active", "2026-11-13T10:00:00.000Z", false],
  ] as const)("answers %s, archived %s, as live: %s", (status, archivedAt, live) => {
    expect(ingestionSourceIsLive({ status, archivedAt })).toBe(live);
  });
});

describe("ingestionSourceStatusIsOff", () => {
  it("is false only for the statuses that take events", () => {
    expect(ingestionSourceStatusIsOff("disabled")).toBe(true);
    expect(ingestionSourceStatusIsOff("paused")).toBe(true);
    expect(ingestionSourceStatusIsOff("active")).toBe(false);
    expect(ingestionSourceStatusIsOff("awaiting_first_event")).toBe(false);
  });
});

describe("INGESTION_SOURCE_LIVE_STATUSES", () => {
  it("lists exactly the statuses the predicate calls live, for the writes that filter on it", () => {
    expect(INGESTION_SOURCE_LIVE_STATUSES).toEqual(["active", "awaiting_first_event"]);
    for (const status of INGESTION_SOURCE_LIVE_STATUSES) {
      expect(ingestionSourceStatusIsOff(status)).toBe(false);
    }
  });
});
