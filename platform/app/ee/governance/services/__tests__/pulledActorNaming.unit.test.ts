// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The one shared named-or-blank rule for pulled spend.
 *
 * Decision: ADR-129 (Decisions 2 and 3). The seam-level behavior is covered in
 * `pullers/__tests__/pulledUsageRecord.unit.test.ts`; this file pins the line
 * arithmetic itself, boundaries included, because an off-by-one-day here is a
 * customer's money shown twice.
 */
import { describe, expect, it } from "vitest";
import {
  actorForPulledDay,
  PULLED_ACTOR_NAMING_STARTS_AT,
} from "../logic/pulledActorNaming";

const LINE = PULLED_ACTOR_NAMING_STARTS_AT;
const LINE_MS = Date.parse(`${LINE}T00:00:00.000Z`);
const beforeLine = new Date(LINE_MS - 1);
const atLine = new Date(LINE_MS);

describe("naming a pulled day", () => {
  it("names the line day itself, on both sides of the comparison", () => {
    // Boundary of Decision 2: "on or after", twice over. A source created at
    // the line's first instant names, and the line day itself is named.
    expect(
      actorForPulledDay({
        sourceCreatedAt: atLine,
        dayUtc: LINE,
        reportedActor: "user-abc",
      }),
    ).toBe("user-abc");
    expect(
      actorForPulledDay({
        sourceCreatedAt: beforeLine,
        dayUtc: LINE,
        reportedActor: "user-abc",
      }),
    ).toBe("user-abc");
  });

  it("keeps the day before the line blank for a pre-line source", () => {
    const dayBefore = new Date(LINE_MS - 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(
      actorForPulledDay({
        sourceCreatedAt: beforeLine,
        dayUtc: dayBefore,
        reportedActor: "user-abc",
      }),
    ).toBe("");
  });

  it("names every day, history included, for a source created on the line or after", () => {
    expect(
      actorForPulledDay({
        sourceCreatedAt: atLine,
        dayUtc: "2020-01-01",
        reportedActor: "user-abc",
      }),
    ).toBe("user-abc");
  });

  it("never invents an actor from a blank report", () => {
    expect(
      actorForPulledDay({
        sourceCreatedAt: atLine,
        dayUtc: LINE,
        reportedActor: "",
      }),
    ).toBe("");
  });
});
