// Spec: modules/identity/specs/sign-in-switch.feature
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { isOnIdentifierPath } from "../identity-sign-in-switch.rules.ts";

const EARLIER = Temporal.Instant.from("2026-08-18T09:00:00.000Z");
const LATER = Temporal.Instant.from("2026-08-19T09:00:00.000Z");

describe("isOnIdentifierPath", () => {
  /** @scenario "A user with no row on either side signs in on the legacy path" */
  it("answers the legacy path with no row on either side", () => {
    expect(isOnIdentifierPath({ own: null, legacy: null })).toBe(false);
  });

  /** @scenario "A rollback or a reopen recorded after the switch returns the user to the legacy path" */
  it.each(["rolled_back", "migrated"])("answers legacy for a later %s state row", (status) => {
    expect(
      isOnIdentifierPath({
        own: { onIdentifiers: true, switchedAt: EARLIER },
        legacy: { status, occurredAt: LATER },
      }),
    ).toBe(false);
  });

  it("lets identity's own row answer on a tie and when newer", () => {
    const legacy = { status: "finalized", occurredAt: EARLIER };
    expect(isOnIdentifierPath({ own: { onIdentifiers: true, switchedAt: EARLIER }, legacy })).toBe(
      true,
    );
    expect(isOnIdentifierPath({ own: { onIdentifiers: false, switchedAt: LATER }, legacy })).toBe(
      false,
    );
  });

  it("reads a lone finalized state row as the identifier path", () => {
    expect(
      isOnIdentifierPath({ own: null, legacy: { status: "finalized", occurredAt: EARLIER } }),
    ).toBe(true);
  });
});
