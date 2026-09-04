// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The two department questions the People screen keeps apart: which one a row
 * shows, and which one the "departments the providers see" panel counts.
 *
 * Spec: specs/governance/governance-people-screen.feature
 */
import { describe, expect, it } from "vitest";

import {
  departmentLabelFor,
  groupObservedDepartments,
  type PersonDepartmentFacts,
} from "../observedDepartments";

const person = (
  over: Partial<PersonDepartmentFacts>,
): PersonDepartmentFacts => ({
  directoryDepartment: null,
  erasedAt: null,
  link: null,
  ...over,
});

describe("given a discovered person the screen has to label", () => {
  describe("when only the directory names a department", () => {
    /** @scenario "An unlinked person shows the department their directory named" */
    it("shows the directory department on a person linked to nobody", () => {
      expect(
        departmentLabelFor(person({ directoryDepartment: "Engineering" })),
      ).toBe("Engineering");
    });
  });

  describe("when only the linked member has one", () => {
    it("falls back to the linked member's department", () => {
      expect(
        departmentLabelFor(person({ link: { departmentName: "Product" } })),
      ).toBe("Product");
    });
  });

  describe("when both name one and they disagree", () => {
    /** @scenario "The directory's department wins over the linked member's" */
    it("shows the directory department rather than the linked member's", () => {
      expect(
        departmentLabelFor(
          person({
            directoryDepartment: "Engineering",
            link: { departmentName: "Product" },
          }),
        ),
      ).toBe("Engineering");
    });
  });

  describe("when neither names one", () => {
    it("shows nothing rather than inventing a department", () => {
      expect(
        departmentLabelFor(person({ link: { departmentName: null } })),
      ).toBeNull();
    });
  });

  describe("when the person has been erased", () => {
    it("describes them with nothing, whatever the row still carries", () => {
      expect(
        departmentLabelFor(
          person({
            directoryDepartment: "Engineering",
            link: { departmentName: "Product" },
            erasedAt: new Date("2026-09-01T00:00:00.000Z"),
          }),
        ),
      ).toBeNull();
    });
  });
});

describe("given the people a set of providers named", () => {
  describe("when the departments they carry are grouped", () => {
    /** @scenario "Departments the providers see are counted from the directory only" */
    it("counts only the directory's departments, never the linked members'", () => {
      const grouped = groupObservedDepartments([
        person({ directoryDepartment: "Engineering" }),
        person({ directoryDepartment: "Engineering" }),
        person({ directoryDepartment: "Product" }),
        // Their department is the organization's own assignment, not anything
        // a provider said, so it belongs to the Department list rather than
        // to this count.
        person({ link: { departmentName: "Finance" } }),
      ]);

      expect(grouped).toEqual([
        { name: "Engineering", peopleCount: 2 },
        { name: "Product", peopleCount: 1 },
      ]);
    });

    it("orders equal counts by name so two reads look the same", () => {
      const grouped = groupObservedDepartments([
        person({ directoryDepartment: "Product" }),
        person({ directoryDepartment: "Executive" }),
        person({ directoryDepartment: "GTM" }),
      ]);

      expect(grouped.map((d) => d.name)).toEqual([
        "Executive",
        "GTM",
        "Product",
      ]);
    });

    it("counts nobody for people no directory filed anywhere", () => {
      expect(
        groupObservedDepartments([
          person({}),
          person({ directoryDepartment: "" }),
        ]),
      ).toEqual([]);
    });

    it("counts no erased person, whose department is nobody's business now", () => {
      expect(
        groupObservedDepartments([
          person({
            directoryDepartment: "Engineering",
            erasedAt: new Date("2026-09-01T00:00:00.000Z"),
          }),
        ]),
      ).toEqual([]);
    });
  });
});
