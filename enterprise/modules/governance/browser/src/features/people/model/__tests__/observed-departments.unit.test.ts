// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import { groupObservedDepartments, type PersonDepartmentFacts } from "../observed-departments.ts";

const person = (over: Partial<PersonDepartmentFacts>): PersonDepartmentFacts => ({
  provider: "openai_admin",
  directoryDepartment: null,
  erasedAt: null,
  link: null,
  ...over,
});

describe("the departments the providers see", () => {
  describe("given people filed by a directory and a person whose department only their member holds", () => {
    /** @scenario "Departments the providers see are counted from the directory only" */
    it("counts the directory's departments and leaves the member's out", () => {
      const observed = groupObservedDepartments([
        person({ directoryDepartment: "Engineering" }),
        person({ directoryDepartment: "Engineering", provider: "copilot_studio_dataverse" }),
        person({ directoryDepartment: "Finance" }),
        person({ link: { departmentName: "Legal" } }),
      ]);

      expect(observed).toEqual([
        {
          name: "Engineering",
          peopleCount: 2,
          providers: ["copilot_studio_dataverse", "openai_admin"],
        },
        { name: "Finance", peopleCount: 1, providers: ["openai_admin"] },
      ]);
    });
  });
});
