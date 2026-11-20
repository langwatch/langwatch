// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The person's weekly fold: how a coding-agent fact lands in it, within its caps. */
import { describe, expect, it } from "vitest";

import { emptyUserWeek, MAX_SERIES, type UserWeekState } from "../../rules/digest-week.rules.ts";
import type { UserActivity } from "../digest-activity.events.ts";
import { applyUserActivity } from "../digest-week.projection.ts";

const seriesActivity = (seriesId: string): UserActivity => ({
  tenantId: "org-1",
  occurredAt: 0,
  organizationId: "org-1",
  isoWeek: "2026-W47",
  sourceKey: `source-${seriesId}`,
  userId: "user-1",
  sessionId: "session-1",
  repository: null,
  series: { seriesId, metric: "cost", type: null, value: 1 },
});

describe("applyUserActivity()", () => {
  describe("when the week already holds MAX_SERIES series", () => {
    const full: UserWeekState = {
      ...emptyUserWeek(),
      series: Object.fromEntries(
        Array.from({ length: MAX_SERIES }, (_, index) => [
          `series-${index}`,
          { metric: "cost", type: null, value: 1 },
        ]),
      ),
    };

    // `constructor` resolves on Object.prototype, so a plain index read would count it as held.
    it.each(["series-new", "constructor"])("drops a new series id %s", (seriesId) => {
      const { series } = applyUserActivity({ state: full, activity: seriesActivity(seriesId) });

      expect(Object.hasOwn(series, seriesId)).toBe(false);
      expect(Object.keys(series)).toHaveLength(MAX_SERIES);
    });
  });
});
