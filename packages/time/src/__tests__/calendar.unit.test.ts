import { afterEach, describe, expect, it, vi } from "vitest";

import { addDays, isSameCalendarDay, isToday, isYesterday, startOfDay, subDays } from "../calendar.ts";
import {
  differenceInCalendarDays,
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  differenceInMonths,
  differenceInSeconds,
  differenceInWeeks,
} from "../difference.ts";

const AMSTERDAM = { timeZone: "Europe/Amsterdam" } as const;

afterEach(() => {
  vi.useRealTimers();
});

describe("differenceInCalendarDays", () => {
  describe("given two moments four hours apart either side of local midnight", () => {
    /** @scenario "A calendar-day difference counts days, not elapsed hours" */
    it("counts one day rather than none", () => {
      expect(
        differenceInCalendarDays(
          new Date("2026-06-15T01:00:00+02:00"),
          new Date("2026-06-14T21:00:00+02:00"),
          AMSTERDAM,
        ),
      ).toBe(1);
    });
  });

  describe("given a thirty-day window", () => {
    it("counts the days the period picker counts", () => {
      expect(
        differenceInCalendarDays(
          new Date("2026-06-15T12:00:00+02:00"),
          new Date("2026-05-16T12:00:00+02:00"),
          AMSTERDAM,
        ),
      ).toBe(30);
    });
  });

  describe("given the earlier moment second", () => {
    it("answers a negative count", () => {
      expect(
        differenceInCalendarDays(
          new Date("2026-06-14T12:00:00+02:00"),
          new Date("2026-06-15T12:00:00+02:00"),
          AMSTERDAM,
        ),
      ).toBe(-1);
    });
  });
});

describe("differenceInDays", () => {
  describe("given a span crossing a spring clock change", () => {
    it("counts two days for forty-seven real hours", () => {
      expect(
        differenceInDays(
          new Date("2026-03-30T12:00:00+02:00"),
          new Date("2026-03-28T12:00:00+01:00"),
          AMSTERDAM,
        ),
      ).toBe(2);
    });
  });

  describe("given a span one hour short of a day", () => {
    it("counts no whole day", () => {
      expect(
        differenceInDays(
          new Date("2026-06-15T11:00:00+02:00"),
          new Date("2026-06-14T12:00:00+02:00"),
          AMSTERDAM,
        ),
      ).toBe(0);
    });
  });
});

describe("differenceInWeeks", () => {
  describe("given ten days", () => {
    it("counts one whole week", () => {
      expect(
        differenceInWeeks(
          new Date("2026-06-15T12:00:00+02:00"),
          new Date("2026-06-05T12:00:00+02:00"),
          AMSTERDAM,
        ),
      ).toBe(1);
    });
  });
});

describe("differenceInMonths", () => {
  describe("given six months and a few days", () => {
    it("counts whole calendar months", () => {
      expect(
        differenceInMonths(
          new Date("2026-06-15T12:00:00+02:00"),
          new Date("2025-12-10T12:00:00+01:00"),
          AMSTERDAM,
        ),
      ).toBe(6);
    });
  });
});

describe("the elapsed differences", () => {
  const later = new Date("2026-06-15T12:00:00+02:00");

  it("truncate toward zero the way the ladders read them", () => {
    expect(differenceInSeconds(later, new Date(later.getTime() - 1999))).toBe(1);
    expect(differenceInMinutes(later, new Date(later.getTime() - 119_000))).toBe(1);
    expect(differenceInHours(later, new Date(later.getTime() - 7_199_000))).toBe(1);
  });
});

describe("addDays and subDays", () => {
  describe("given the day before a spring clock change", () => {
    /** @scenario "A day added across a daylight-saving change keeps the wall-clock time" */
    it("keeps the wall-clock time rather than the elapsed hours", () => {
      expect(addDays(new Date("2026-03-28T12:00:00+01:00"), 1, AMSTERDAM).toISOString()).toBe(
        "2026-03-29T10:00:00.000Z",
      );
      expect(subDays(new Date("2026-03-30T12:00:00+02:00"), 1, AMSTERDAM).toISOString()).toBe(
        "2026-03-29T10:00:00.000Z",
      );
    });
  });

  describe("given a plain window", () => {
    it("moves whole days", () => {
      expect(subDays(new Date("2026-06-15T12:00:00+02:00"), 29, AMSTERDAM).toISOString()).toBe(
        "2026-05-17T10:00:00.000Z",
      );
    });
  });
});

describe("startOfDay", () => {
  describe("given half past midnight local time", () => {
    /** @scenario "The start of a day is local midnight, not UTC midnight" */
    it("answers local midnight and not UTC midnight", () => {
      expect(startOfDay(new Date("2026-06-15T00:30:00+02:00"), AMSTERDAM).toISOString()).toBe(
        "2026-06-14T22:00:00.000Z",
      );
    });
  });

  describe("given the day a clock changes", () => {
    it("answers the midnight that day actually began at", () => {
      expect(startOfDay(new Date("2026-03-29T12:30:00+02:00"), AMSTERDAM).toISOString()).toBe(
        "2026-03-28T23:00:00.000Z",
      );
    });
  });
});

describe("isToday and isYesterday", () => {
  describe("given a viewer in Europe/Amsterdam late in the evening", () => {
    /** @scenario "Today and yesterday are named against the viewer's calendar" */
    it("groups last night as yesterday and this morning as today", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-15T09:00:00+02:00"));

      expect(isToday(new Date("2026-06-15T00:10:00+02:00"), AMSTERDAM)).toBe(true);
      expect(isYesterday(new Date("2026-06-14T23:50:00+02:00"), AMSTERDAM)).toBe(true);
      expect(isToday(new Date("2026-06-14T23:50:00+02:00"), AMSTERDAM)).toBe(false);
    });
  });

  describe("given a moment that is today in one zone and yesterday in another", () => {
    it("answers on the zone it is read in", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-06-15T09:00:00+02:00"));

      const justAfterLocalMidnight = new Date("2026-06-15T00:10:00+02:00");
      expect(isToday(justAfterLocalMidnight, AMSTERDAM)).toBe(true);
      expect(isToday(justAfterLocalMidnight, { timeZone: "UTC" })).toBe(false);
    });
  });
});

describe("isSameCalendarDay", () => {
  it("reads both moments on the same calendar", () => {
    expect(
      isSameCalendarDay(
        new Date("2026-06-15T00:10:00+02:00"),
        new Date("2026-06-15T23:50:00+02:00"),
        AMSTERDAM,
      ),
    ).toBe(true);
  });
});
