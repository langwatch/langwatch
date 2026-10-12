import { describe, expect, it } from "vitest";

import { ReloadSchedule } from "../schedule.ts";

const run = ({ every, visits }: { every: number; visits: number }): string[] => {
  const schedule = new ReloadSchedule(every);
  return Array.from({ length: visits }, () => {
    const navigation = schedule.next();
    schedule.done({ navigation, broken: false });
    return navigation;
  });
};

describe("ReloadSchedule", () => {
  it("loads first, then every Nth visit", () => {
    expect(run({ every: 3, visits: 7 })).toEqual([
      "reload",
      "in-app",
      "in-app",
      "reload",
      "in-app",
      "in-app",
      "reload",
    ]);
  });

  it("loads every visit when N is 1", () => {
    expect(run({ every: 1, visits: 3 })).toEqual(["reload", "reload", "reload"]);
  });

  it("loads after a visit that left the page broken", () => {
    const schedule = new ReloadSchedule(5);
    schedule.done({ navigation: schedule.next(), broken: false });
    expect(schedule.next()).toBe("in-app");
    schedule.done({ navigation: "in-app", broken: true });
    expect(schedule.next()).toBe("reload");
  });

  it("restarts the cycle when in-app navigation fell back to a load", () => {
    const schedule = new ReloadSchedule(3);
    schedule.done({ navigation: "reload", broken: false });
    schedule.done({ navigation: "in-app", broken: false });
    expect(schedule.next()).toBe("in-app");
    schedule.done({ navigation: "reload", broken: false });
    schedule.done({ navigation: "in-app", broken: false });
    expect(schedule.next()).toBe("in-app");
    schedule.done({ navigation: "in-app", broken: false });
    expect(schedule.next()).toBe("reload");
  });
});
