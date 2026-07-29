import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cronFromParts,
  DEFAULT_PARTS,
  defaultTimezone,
  describeCron,
  groupTimezones,
  ordinal,
  partsFromCron,
  type ScheduleParts,
  summarizeSchedule,
} from "../reportSchedule";

describe("reportSchedule", () => {
  describe("given cronFromParts", () => {
    describe("when the frequency is daily", () => {
      it("drops the day fields to wildcards", () => {
        expect(
          cronFromParts({ ...DEFAULT_PARTS, frequency: "daily", hour: 7, minute: 30 }),
        ).toBe("30 7 * * *");
      });
    });

    describe("when the frequency is weekly", () => {
      it("pins the day-of-week", () => {
        expect(
          cronFromParts({
            frequency: "weekly",
            hour: 9,
            minute: 0,
            dayOfWeek: 3,
            dayOfMonth: 1,
          }),
        ).toBe("0 9 * * 3");
      });
    });

    describe("when the frequency is monthly", () => {
      it("pins the day-of-month", () => {
        expect(
          cronFromParts({
            frequency: "monthly",
            hour: 6,
            minute: 15,
            dayOfWeek: 1,
            dayOfMonth: 12,
          }),
        ).toBe("15 6 12 * *");
      });
    });
  });

  describe("given partsFromCron", () => {
    const roundTrips: Array<[string, ScheduleParts]> = [
      [
        "0 9 * * *",
        { frequency: "daily", hour: 9, minute: 0, dayOfWeek: 1, dayOfMonth: 1 },
      ],
      [
        "30 8 * * 5",
        { frequency: "weekly", hour: 8, minute: 30, dayOfWeek: 5, dayOfMonth: 1 },
      ],
      [
        "0 9 15 * *",
        { frequency: "monthly", hour: 9, minute: 0, dayOfWeek: 1, dayOfMonth: 15 },
      ],
    ];

    it.each(roundTrips)("parses %s back to the friendly parts", (cron, parts) => {
      expect(partsFromCron(cron)).toEqual(parts);
    });

    it.each(roundTrips)("round-trips %s through cronFromParts", (cron) => {
      const parts = partsFromCron(cron);
      expect(parts).not.toBeNull();
      expect(cronFromParts(parts!)).toBe(cron);
    });

    describe("when the cron is outside the known shapes", () => {
      it.each([
        "*/5 * * * *", // stepped minutes
        "0 9 * * 1-5", // weekday range
        "0 9 1 6 *", // specific month
        "0 9,17 * * *", // list of hours
        "0 9 * *", // too few fields
        "not a cron",
        "",
      ])("signals custom (null) for %s", (cron) => {
        expect(partsFromCron(cron)).toBeNull();
      });
    });
  });

  describe("given ordinal", () => {
    it.each([
      [1, "1st"],
      [2, "2nd"],
      [3, "3rd"],
      [4, "4th"],
      [11, "11th"],
      [12, "12th"],
      [13, "13th"],
      [21, "21st"],
      [22, "22nd"],
      [31, "31st"],
    ])("renders %i as %s", (n, label) => {
      expect(ordinal(n)).toBe(label);
    });
  });

  describe("given summarizeSchedule", () => {
    it("describes a weekly schedule in plain English", () => {
      expect(
        summarizeSchedule(
          { frequency: "weekly", hour: 9, minute: 0, dayOfWeek: 1, dayOfMonth: 1 },
          "Europe/Amsterdam",
        ),
      ).toBe("Sends every Monday at 09:00 (Europe/Amsterdam)");
    });

    it("describes a daily schedule", () => {
      expect(
        summarizeSchedule({ ...DEFAULT_PARTS, frequency: "daily", hour: 7, minute: 5 }, "UTC"),
      ).toBe("Sends every day at 07:05 (UTC)");
    });

    it("describes a monthly schedule with an ordinal day", () => {
      expect(
        summarizeSchedule(
          { frequency: "monthly", hour: 8, minute: 0, dayOfWeek: 1, dayOfMonth: 3 },
          "UTC",
        ),
      ).toBe("Sends on the 3rd of each month at 08:00 (UTC)");
    });
  });

  describe("given describeCron", () => {
    it("falls back to the raw expression for a custom cron", () => {
      expect(describeCron("*/5 * * * *", "UTC")).toBe("*/5 * * * * (UTC)");
    });
  });

  describe("given defaultTimezone", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("reads the resolved Intl timezone", () => {
      vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
        resolvedOptions: () =>
          ({ timeZone: "Europe/Amsterdam" }) as Intl.ResolvedDateTimeFormatOptions,
      } as Intl.DateTimeFormat);

      expect(defaultTimezone()).toBe("Europe/Amsterdam");
    });

    it("falls back to UTC when Intl throws", () => {
      vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
        throw new Error("no Intl");
      });

      expect(defaultTimezone()).toBe("UTC");
    });
  });

  describe("given groupTimezones", () => {
    it("groups zones by region and pins General to the top", () => {
      const grouped = groupTimezones([
        "Europe/Paris",
        "UTC",
        "America/New_York",
        "Europe/Berlin",
      ]);

      expect(grouped[0]).toEqual({ region: "General", zones: ["UTC"] });
      expect(grouped.map((g) => g.region)).toEqual([
        "General",
        "America",
        "Europe",
      ]);
      expect(grouped[2]?.zones).toEqual(["Europe/Berlin", "Europe/Paris"]);
    });
  });
});
