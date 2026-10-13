// Spec: modules/authz/specs/engine-switch.feature
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { LEGACY_ENGINE, decideEngineSwitch } from "../authz-engine-switch.rules.ts";

const EARLIER = Temporal.Instant.from("2026-08-18T09:00:00.000Z");
const LATER = Temporal.Instant.from("2026-08-19T09:00:00.000Z");

describe("decideEngineSwitch", () => {
  /** @scenario "An organization with no row on either side stays on the legacy path" */
  it("answers the legacy path with no row on either side", () => {
    expect(decideEngineSwitch({ own: null, legacy: null })).toEqual(LEGACY_ENGINE);
  });

  /** @scenario "A finalized organization stays on the engine once its switch is carried over" */
  it("keeps a finalized organization on the engine before and after the carry-over", () => {
    const legacy = { status: "finalized", occurredAt: EARLIER };
    const before = decideEngineSwitch({ own: null, legacy });
    const after = decideEngineSwitch({ own: { onEngine: true, switchedAt: EARLIER }, legacy });

    expect(before).toEqual({ onEngine: true, switchedAt: EARLIER });
    expect(after).toEqual(before);
  });

  /** @scenario "A rollback recorded after the switch returns the organization to the legacy path" */
  it("answers the legacy path when a later rollback is recorded in the state table", () => {
    expect(
      decideEngineSwitch({
        own: { onEngine: true, switchedAt: EARLIER },
        legacy: { status: "rolled_back", occurredAt: LATER },
      }).onEngine,
    ).toBe(false);
  });

  /** @scenario "Authz's own newer switch answers over an older state row" */
  it("lets authz's own newer row answer", () => {
    expect(
      decideEngineSwitch({
        own: { onEngine: false, switchedAt: LATER },
        legacy: { status: "finalized", occurredAt: EARLIER },
      }),
    ).toEqual({ onEngine: false, switchedAt: LATER });
  });

  it.each(["migrated", "parked", "rolled_back"])(
    "reads a lone %s state row as legacy",
    (status) => {
      expect(
        decideEngineSwitch({ own: null, legacy: { status, occurredAt: EARLIER } }).onEngine,
      ).toBe(false);
    },
  );
});
