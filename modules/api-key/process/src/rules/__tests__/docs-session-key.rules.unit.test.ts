import { DOCS_SESSION_KEY_LIFETIME_MS } from "@langwatch/api-key-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { docsSessionKeyExpiresAt, docsSessionKeyPermissions } from "../docs-session-key.rules.ts";

const NOW = Temporal.Instant.from("2026-10-26T12:00:00.000Z").epochMilliseconds;
const iso = (ms: number) => Temporal.Instant.fromEpochMilliseconds(ms).toString();
const DAY = 86_400_000;

describe("docsSessionKeyExpiresAt", () => {
  it("is five minutes away when nothing ends sooner", () => {
    const expires = docsSessionKeyExpiresAt({
      nowMs: NOW,
      sessionExpiresAt: iso(NOW + DAY),
      sessionStartedAt: iso(NOW - 60_000),
      maxSessionDurationDays: 0,
    });

    expect(expires.epochMilliseconds).toBe(NOW + DOCS_SESSION_KEY_LIFETIME_MS);
  });

  it("ends with the browser session", () => {
    const expires = docsSessionKeyExpiresAt({
      nowMs: NOW,
      sessionExpiresAt: iso(NOW + 60_000),
      sessionStartedAt: iso(NOW - 60_000),
      maxSessionDurationDays: 0,
    });

    expect(expires.epochMilliseconds).toBe(NOW + 60_000);
  });

  it("ends at the organisation's ceiling, counted from the session's start", () => {
    const expires = docsSessionKeyExpiresAt({
      nowMs: NOW,
      sessionExpiresAt: iso(NOW + DAY),
      sessionStartedAt: iso(NOW - DAY + 120_000),
      maxSessionDurationDays: 1,
    });

    expect(expires.epochMilliseconds).toBeLessThanOrEqual(NOW + 120_000);
  });
});

describe("docsSessionKeyPermissions", () => {
  it("keeps what a project binding can carry, once each, sorted", () => {
    const kept = docsSessionKeyPermissions(["traces:view", "project:view", "traces:view"]);

    expect(kept).toEqual(["project:view", "traces:view"]);
  });

  it("drops organisation-only permissions", () => {
    expect(docsSessionKeyPermissions(["organization:manage", "traces:view"])).toEqual([
      "traces:view",
    ]);
  });
});
