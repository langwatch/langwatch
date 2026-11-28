// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
import { describe, expect, it } from "vitest";

import { companyTraits } from "../nurturing-company-traits.rules.ts";

const CREATED_AT = Date.UTC(2026, 10, 1, 9, 30, 15, 500);

describe("companyTraits", () => {
  describe("when nurturing's copies hold every trait", () => {
    it("sends the project count and the creation time in whole Unix seconds", () => {
      const traits = companyTraits({ projectCount: 2, organizationCreatedAt: CREATED_AT });

      expect(traits).toEqual({ project_count: 2, created_at: Math.floor(CREATED_AT / 1000) });
    });
  });

  describe("when nurturing knows no creation time and no project count", () => {
    /** @scenario "Company traits nurturing does not know are left out" */
    it("leaves both out, with no zero in their place", () => {
      const traits = companyTraits({ projectCount: null, organizationCreatedAt: null });

      expect(traits).toEqual({});
    });
  });

  describe("when a copy counts zero", () => {
    it("leaves the count out, since an organization always has a project", () => {
      const traits = companyTraits({ projectCount: 0, organizationCreatedAt: null });

      expect(traits).toEqual({});
    });
  });
});
