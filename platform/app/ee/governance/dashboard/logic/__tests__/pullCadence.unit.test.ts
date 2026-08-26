// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Pure round-trip contract for the pull-cadence picker's cron mapping.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *
 * The whole reason this module exists (instead of reusing the automations
 * reportSchedule parts) is that the pull adapters' recommended schedules are
 * step ("*\/15") and hourly ("0 * * * *") crons the report picker refuses to
 * parse. So the load-bearing test is: every recommended schedule round-trips.
 */
import { describe, expect, it } from "vitest";
import { SOURCE_TYPE_OPTIONS } from "../../components/ingestionSourceCatalog";
import {
  composerCadenceError,
  cronFromPullParts,
  MINUTE_INTERVALS,
  PULL_SCHEDULE_DEFAULTS,
  partsFromPullCron,
  pullCadenceCronError,
  recommendedPullSchedule,
  summarizePullCadence,
} from "../pullCadence";

/** Derived from the real defaults so an adapter added with a schedule the
 *  picker cannot speak fails here the day it lands. */
const RECOMMENDED_SCHEDULES = [
  ...new Set(Object.values(PULL_SCHEDULE_DEFAULTS)),
];

describe("given the pull-cadence cron mapping", () => {
  describe("when a recommended adapter schedule arrives", () => {
    /** @scenario "The picker speaks every recommended schedule" */
    it("round-trips every recommended schedule through the friendly parts", () => {
      expect(RECOMMENDED_SCHEDULES.length).toBeGreaterThan(0);
      for (const cron of RECOMMENDED_SCHEDULES) {
        const parts = partsFromPullCron(cron);
        expect(parts, `picker cannot speak ${cron}`).not.toBeNull();
        expect(cronFromPullParts(parts!)).toBe(cron);
      }
    });

    /** @scenario "The picker speaks every recommended schedule" */
    it("maps */15 to the every-15-minutes frequency", () => {
      expect(partsFromPullCron("*/15 * * * *")).toMatchObject({
        frequency: "minutes",
        everyMinutes: 15,
      });
    });

    /** @scenario "The picker speaks every recommended schedule" */
    it("maps 0 * * * * to hourly on the hour", () => {
      expect(partsFromPullCron("0 * * * *")).toMatchObject({
        frequency: "hourly",
        minute: 0,
      });
    });

    /**
     * Every pull-mode type in the catalog must recommend a schedule.
     *
     * The mapping is a `Partial<Record<…>>`, so a pull-mode type added
     * without an entry compiles fine and resolves to no recommendation. The
     * composer then creates the source with no cadence and it never polls —
     * a source that looks configured, reports no error, and returns nothing.
     */
    it("recommends a schedule for every pull-mode source the catalog offers", () => {
      const missing = SOURCE_TYPE_OPTIONS.filter(
        (option) =>
          option.mode === "pull" &&
          !option.deprecated &&
          recommendedPullSchedule(option.value) === null,
      ).map((option) => option.value);
      expect(missing).toEqual([]);
    });
  });

  describe("when the friendly parts emit a cron", () => {
    it("emits the four shapes the picker offers", () => {
      expect(
        cronFromPullParts({
          frequency: "minutes",
          everyMinutes: 30,
          minute: 0,
          hour: 0,
          dayOfWeek: 1,
        }),
      ).toBe("*/30 * * * *");
      expect(
        cronFromPullParts({
          frequency: "hourly",
          everyMinutes: 15,
          minute: 5,
          hour: 0,
          dayOfWeek: 1,
        }),
      ).toBe("5 * * * *");
      expect(
        cronFromPullParts({
          frequency: "daily",
          everyMinutes: 15,
          minute: 0,
          hour: 9,
          dayOfWeek: 1,
        }),
      ).toBe("0 9 * * *");
      expect(
        cronFromPullParts({
          frequency: "weekly",
          everyMinutes: 15,
          minute: 0,
          hour: 9,
          dayOfWeek: 1,
        }),
      ).toBe("0 9 * * 1");
    });

    it("only offers minute intervals it can parse back", () => {
      for (const everyMinutes of MINUTE_INTERVALS) {
        const cron = cronFromPullParts({
          frequency: "minutes",
          everyMinutes,
          minute: 0,
          hour: 0,
          dayOfWeek: 1,
        });
        expect(partsFromPullCron(cron)).toMatchObject({
          frequency: "minutes",
          everyMinutes,
        });
      }
    });
  });

  describe("when a cron is outside the picker's four shapes", () => {
    /** @scenario "Cron editing is still there for schedules the picker cannot say" */
    it("returns null so the caller falls back to cron editing", () => {
      // monthly, cron the report picker DOES speak but this one hands off
      expect(partsFromPullCron("0 9 1 * *")).toBeNull();
      // step outside the offered intervals
      expect(partsFromPullCron("*/7 * * * *")).toBeNull();
      // lists, ranges, six fields, junk
      expect(partsFromPullCron("0,30 * * * *")).toBeNull();
      expect(partsFromPullCron("0 9-17 * * *")).toBeNull();
      expect(partsFromPullCron("0 * * * * *")).toBeNull();
      expect(partsFromPullCron("every so often")).toBeNull();
    });
  });

  describe("when the cron editor validates before create", () => {
    /** @scenario "Cron editing is still there for schedules the picker cannot say" */
    it("refuses an empty or impossible cron with a message, accepts runnable ones", () => {
      expect(pullCadenceCronError("")).not.toBeNull();
      expect(pullCadenceCronError("not a cron")).not.toBeNull();
      expect(pullCadenceCronError("99 * * * *")).not.toBeNull();
      // Parses fine but never fires (February 30th): the server refuses it,
      // so the client must too — that is the whole point of "before create".
      expect(pullCadenceCronError("0 9 30 2 *")).not.toBeNull();
      expect(pullCadenceCronError("*/15 * * * *")).toBeNull();
      // Shapes the picker can't say must still be saveable from cron mode.
      expect(pullCadenceCronError("0 9 1 * *")).toBeNull();
    });
  });

  describe("when the composer decides whether Create may proceed", () => {
    /** @scenario "Cron editing is still there for schedules the picker cannot say" */
    it("refuses an impossible cron for a pull source, and only then", () => {
      // This is the predicate the Create button's disabled state reads, so
      // "the create button refuses until it is fixed" is pinned here.
      expect(
        composerCadenceError({
          sourceType: "databricks_genie",
          pullSchedule: "99 * * * *",
        }),
      ).not.toBeNull();
      expect(
        composerCadenceError({
          sourceType: "databricks_genie",
          pullSchedule: "0 * * * *",
        }),
      ).toBeNull();
    });

    /** @scenario "Leaving the cadence untouched keeps the recommended schedule" */
    it("never blocks an untouched cadence or a source without one", () => {
      expect(
        composerCadenceError({
          sourceType: "databricks_genie",
          pullSchedule: "",
        }),
      ).toBeNull();
      // Push sources carry no cadence; junk in the field must not block them.
      expect(
        composerCadenceError({
          sourceType: "otel_generic",
          pullSchedule: "junk",
        }),
      ).toBeNull();
    });
  });

  describe("when the summary sentence renders", () => {
    /** @scenario "The Cadence section opens on a friendly picker, prefilled" */
    it("states each shape in plain words", () => {
      expect(
        summarizePullCadence({
          frequency: "minutes",
          everyMinutes: 15,
          minute: 0,
          hour: 0,
          dayOfWeek: 1,
        }),
      ).toBe("Checks for new activity every 15 minutes");
      expect(
        summarizePullCadence({
          frequency: "hourly",
          everyMinutes: 15,
          minute: 0,
          hour: 0,
          dayOfWeek: 1,
        }),
      ).toBe("Checks for new activity every hour, on the hour");
      expect(
        summarizePullCadence({
          frequency: "hourly",
          everyMinutes: 15,
          minute: 5,
          hour: 0,
          dayOfWeek: 1,
        }),
      ).toBe("Checks for new activity every hour at 5 minutes past");
      expect(
        summarizePullCadence({
          frequency: "daily",
          everyMinutes: 15,
          minute: 0,
          hour: 9,
          dayOfWeek: 1,
        }),
      ).toBe("Checks for new activity every day at 09:00 UTC");
      expect(
        summarizePullCadence({
          frequency: "weekly",
          everyMinutes: 15,
          minute: 0,
          hour: 9,
          dayOfWeek: 1,
        }),
      ).toBe("Checks for new activity every Monday at 09:00 UTC");
    });
  });
});
