/**
 * The one rule for whether the organization's Dashboards area opens, which the navigation shell
 * and the analytics pages both read from `@langwatch/analytics-client`.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { organizationDashboardsArea, type OrganizationFlagRead } from "@langwatch/analytics-client";
import { describe, expect, it } from "vitest";

const ORGANIZATION_ID = "org-1";

const answered = (isOn: boolean): OrganizationFlagRead => ({
  data: { enabledByOrganizationId: { [ORGANIZATION_ID]: isOn } },
  isLoading: false,
});
const pending: OrganizationFlagRead = { isLoading: true };
const failed: OrganizationFlagRead = { isLoading: false, isError: true };

describe("organizationDashboardsArea", () => {
  describe("when the organization has not resolved", () => {
    it("answers loading, not shut, even with both flags answered on", () => {
      expect(
        organizationDashboardsArea({
          organizationId: void 0,
          organizationArea: answered(true),
          dashboards: answered(true),
        }),
      ).toBe("loading");
    });

    it("answers loading with neither flag asked yet", () => {
      expect(
        organizationDashboardsArea({
          organizationId: void 0,
          organizationArea: { isLoading: false },
          dashboards: { isLoading: false },
        }),
      ).toBe("loading");
    });
  });

  describe("when the organization has resolved", () => {
    it("answers loading while either flag is still being read", () => {
      expect(
        organizationDashboardsArea({
          organizationId: ORGANIZATION_ID,
          organizationArea: answered(true),
          dashboards: pending,
        }),
      ).toBe("loading");
    });

    it("answers open with both flags on for the organization", () => {
      expect(
        organizationDashboardsArea({
          organizationId: ORGANIZATION_ID,
          organizationArea: answered(true),
          dashboards: answered(true),
        }),
      ).toBe("open");
    });

    it("answers legacy with the area's own flag off", () => {
      expect(
        organizationDashboardsArea({
          organizationId: ORGANIZATION_ID,
          organizationArea: answered(false),
          dashboards: answered(true),
        }),
      ).toBe("legacy");
    });

    it("answers closed with Dashboards off", () => {
      expect(
        organizationDashboardsArea({
          organizationId: ORGANIZATION_ID,
          organizationArea: answered(true),
          dashboards: answered(false),
        }),
      ).toBe("closed");
    });

    it("reads a flag answered for another organization only as off", () => {
      expect(
        organizationDashboardsArea({
          organizationId: ORGANIZATION_ID,
          organizationArea: answered(true),
          dashboards: { data: { enabledByOrganizationId: { "org-2": true } }, isLoading: false },
        }),
      ).toBe("closed");
    });

    it("reads a failed read with no answer held as off, so a refused reader never waits", () => {
      expect(
        organizationDashboardsArea({
          organizationId: ORGANIZATION_ID,
          organizationArea: answered(true),
          dashboards: failed,
        }),
      ).toBe("closed");
    });

    it("keeps the answer a failed refetch held", () => {
      expect(
        organizationDashboardsArea({
          organizationId: ORGANIZATION_ID,
          organizationArea: answered(true),
          dashboards: { ...answered(true), isError: true },
        }),
      ).toBe("open");
    });
  });
});
