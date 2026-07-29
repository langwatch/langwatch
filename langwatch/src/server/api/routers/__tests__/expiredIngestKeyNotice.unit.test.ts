import { describe, expect, it } from "vitest";

import { shouldShowExpiredIngestKeyNotice } from "../user";

const EARLIER = new Date("2026-07-01T10:00:00Z");
const LATER = new Date("2026-07-02T10:00:00Z");

describe("shouldShowExpiredIngestKeyNotice", () => {
  /** @scenario "A user who never had a rejection never sees the notice" */
  it("is hidden when no rejection was ever recorded", () => {
    expect(
      shouldShowExpiredIngestKeyNotice({
        expiredIngestKeyAt: null,
        expiredIngestKeyDismissedAt: null,
      }),
    ).toBe(false);
  });

  /** @scenario "The notice shows while the last rejection is newer than the last dismissal" */
  it("is shown after a rejection the user has not dismissed", () => {
    expect(
      shouldShowExpiredIngestKeyNotice({
        expiredIngestKeyAt: EARLIER,
        expiredIngestKeyDismissedAt: null,
      }),
    ).toBe(true);
  });

  /** @scenario "Dismissing hides the notice" */
  it("is hidden once dismissed after the rejection", () => {
    expect(
      shouldShowExpiredIngestKeyNotice({
        expiredIngestKeyAt: EARLIER,
        expiredIngestKeyDismissedAt: LATER,
      }),
    ).toBe(false);
  });

  /** @scenario "A fresh rejection after a dismissal brings the notice back" */
  it("comes back when a newer rejection lands after the dismissal", () => {
    expect(
      shouldShowExpiredIngestKeyNotice({
        expiredIngestKeyAt: LATER,
        expiredIngestKeyDismissedAt: EARLIER,
      }),
    ).toBe(true);
  });

  it("stays hidden on the exact same timestamp, so a dismissal always wins", () => {
    expect(
      shouldShowExpiredIngestKeyNotice({
        expiredIngestKeyAt: EARLIER,
        expiredIngestKeyDismissedAt: EARLIER,
      }),
    ).toBe(false);
  });

  it("is hidden when a stale dismissal exists but nothing was ever recorded", () => {
    expect(
      shouldShowExpiredIngestKeyNotice({
        expiredIngestKeyAt: null,
        expiredIngestKeyDismissedAt: LATER,
      }),
    ).toBe(false);
  });
});
