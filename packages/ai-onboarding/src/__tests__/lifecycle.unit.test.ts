import { describe, expect, it } from "vitest";
import {
  computeDeadlines,
  daysRemainingInPhase,
  deriveState,
  toLifecycle,
} from "../domain/account.js";
import { buildLifecycleNotice } from "../domain/copy.js";
import { anAccount } from "./fakes.js";

const DAY = 24 * 60 * 60 * 1000;
const PROVISIONED = new Date("2026-01-01T00:00:00Z");
const dayN = (n: number) => new Date(PROVISIONED.getTime() + n * DAY);

describe("the unclaimed ramp", () => {
  describe("given an account provisioned with the default windows", () => {
    const account = anAccount({ provisionedAt: PROVISIONED });

    /** @scenario "the account reports its state from the two deadlines" */
    it.each([
      { day: 0, state: "active" },
      { day: 6, state: "active" },
      { day: 7, state: "read_only" },
      { day: 29, state: "read_only" },
      { day: 30, state: "expired" },
      { day: 45, state: "expired" },
    ])("reads as $state on day $day", ({ day, state }) => {
      expect(deriveState(account, dayN(day))).toBe(state);
    });

    it("counts down to the ingestion deadline while active", () => {
      expect(daysRemainingInPhase(account, dayN(0))).toBe(7);
      expect(daysRemainingInPhase(account, dayN(6))).toBe(1);
    });

    it("counts down to the deletion deadline while read-only", () => {
      expect(daysRemainingInPhase(account, dayN(7))).toBe(23);
      expect(daysRemainingInPhase(account, dayN(29))).toBe(1);
    });

    it("stops counting once expired", () => {
      expect(daysRemainingInPhase(account, dayN(30))).toBeNull();
    });

    it("never reports zero days left while the phase still has time in it", () => {
      // Half a day before the cutoff still works, so a CLI printing "0 days
      // left" would be telling the developer their account is already dead.
      const halfDayLeft = new Date(dayN(6).getTime() + 12 * 60 * 60 * 1000);
      expect(deriveState(account, halfDayLeft)).toBe("active");
      expect(daysRemainingInPhase(account, halfDayLeft)).toBe(1);
    });
  });

  describe("when the account has been claimed", () => {
    const claimed = anAccount({
      provisionedAt: PROVISIONED,
      claimedAt: dayN(3),
      claimedByUserId: "user_1",
      ingestionStopsAt: null,
      deleteAfter: null,
    });

    it("reads as claimed forever, including past the old deadlines", () => {
      expect(deriveState(claimed, dayN(31))).toBe("claimed");
      expect(deriveState(claimed, dayN(365))).toBe("claimed");
    });

    it("reports no countdown", () => {
      expect(daysRemainingInPhase(claimed, dayN(31))).toBeNull();
    });

    /** @scenario "a claimed account has no deadlines at all" */
    it("reports no deadlines on the wire", () => {
      const lifecycle = toLifecycle(claimed, dayN(31));
      expect(lifecycle.ingestionStopsAt).toBeNull();
      expect(lifecycle.deleteAfter).toBeNull();
    });
  });

  describe("when serializing for the wire", () => {
    it("emits absolute timestamps, not durations", () => {
      const lifecycle = toLifecycle(
        anAccount({ provisionedAt: PROVISIONED }),
        dayN(1),
      );
      expect(lifecycle.provisionedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(lifecycle.ingestionStopsAt).toBe("2026-01-08T00:00:00.000Z");
      expect(lifecycle.deleteAfter).toBe("2026-01-31T00:00:00.000Z");
    });
  });
});

describe("computeDeadlines", () => {
  describe("when given the configured windows", () => {
    it("places both deadlines relative to the provisioning moment", () => {
      const { ingestionStopsAt, deleteAfter } = computeDeadlines({
        provisionedAt: PROVISIONED,
        ingestionDays: 7,
        retentionDays: 30,
      });
      expect(ingestionStopsAt).toEqual(dayN(7));
      expect(deleteAfter).toEqual(dayN(30));
    });

    it("honours windows a deployment tightened", () => {
      const { ingestionStopsAt, deleteAfter } = computeDeadlines({
        provisionedAt: PROVISIONED,
        ingestionDays: 1,
        retentionDays: 2,
      });
      expect(ingestionStopsAt).toEqual(dayN(1));
      expect(deleteAfter).toEqual(dayN(2));
    });
  });
});

describe("the lifecycle notice", () => {
  describe("when a deployment changed the windows", () => {
    /** @scenario "provisioning states both deadlines in words the CLI can print" */
    it("states the numbers that deployment actually enforces", () => {
      const notice = buildLifecycleNotice({
        ingestionDays: 3,
        retentionDays: 14,
      });
      expect(notice.dataRetention).toContain("3 days");
      expect(notice.claimWindow).toContain("14 days");
    });
  });

  describe("regardless of configuration", () => {
    /** @scenario "the copy never mentions how any of it is built" */
    it("never names how any of it is stored or cleaned up", () => {
      const prose = Object.values(
        buildLifecycleNotice({ ingestionDays: 7, retentionDays: 30 }),
      )
        .join(" ")
        .toLowerCase();

      for (const internal of [
        "postgres",
        "clickhouse",
        "redis",
        "reaper",
        "s3",
        "tenant",
      ]) {
        expect(prose).not.toContain(internal);
      }
    });
  });
});
