import { describe, expect, it } from "vitest";

import { DeadlineAlarm } from "../deadline-alarm.ts";
import { isExpectedThrottle, isThrottleConsoleError } from "../noise.ts";

const OFFER = "http://app/api/trpc/joinRequests.offer?batch=1&input=%7B%7D";

describe("Feature: visualdiff catches regressions and reports its own coverage", () => {
  describe("given the join offer throttled after a run's many page loads", () => {
    describe("when the runner records failures", () => {
      /** @scenario The join offer's throttle is noise, not a finding */
      it("drops its 429 and the console line the browser logs for it", () => {
        expect(isExpectedThrottle({ url: OFFER, status: 429 })).toBe(true);
        expect(
          isThrottleConsoleError({
            text: "Failed to load resource: the server responded with a status of 429 (Too Many Requests)",
            url: OFFER,
          }),
        ).toBe(true);
      });

      /** @scenario The join offer's throttle is noise, not a finding */
      it("keeps any other status of the join offer, and a 429 anywhere else", () => {
        expect(isExpectedThrottle({ url: OFFER, status: 500 })).toBe(false);
        expect(isExpectedThrottle({ url: "http://app/api/trpc/traces.list", status: 429 })).toBe(
          false,
        );
      });
    });
  });

  describe("given a side whose first routes all run to the settle deadline", () => {
    describe("when the fifth one is recorded", () => {
      /** @scenario A side whose first routes all hit the settle deadline warns loudly */
      it("warns once and names what was still in flight", () => {
        const warnings: string[] = [];
        const alarm = new DeadlineAlarm("base", (text) => warnings.push(text));
        for (let route = 0; route < 7; route++) {
          alarm.record({ expired: true, inFlight: ["/api/automations/stuck"] });
        }

        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("/api/automations/stuck");
      });

      /** @scenario A side whose first routes all hit the settle deadline warns loudly */
      it("stays quiet when any one of them settled", () => {
        const warnings: string[] = [];
        const alarm = new DeadlineAlarm("base", (text) => warnings.push(text));
        alarm.record({ expired: false, inFlight: [] });
        for (let route = 0; route < 6; route++) alarm.record({ expired: true, inFlight: [] });

        expect(warnings).toEqual([]);
      });
    });
  });
});
