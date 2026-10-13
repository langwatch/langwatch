// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { describe, expect, it } from "vitest";

import { mergeDepartmentRows } from "../department-rows.ts";

describe("the departments table", () => {
  describe("given a created department and a directory spelling that differs in case", () => {
    /** @scenario "A directory spelling that differs in case is a different department" */
    it("keeps two rows, and only the created one has a record to rename or archive", () => {
      const rows = mergeDepartmentRows({
        departments: [{ id: "dept_1", name: "Engineering" }],
        observed: [{ name: "engineering", peopleCount: 3, providers: ["openai_admin"] }],
      });

      expect(rows).toHaveLength(2);
      const created = rows.find((row) => row.name === "Engineering");
      const named = rows.find((row) => row.name === "engineering");
      expect(created?.record).toEqual({ id: "dept_1", name: "Engineering" });
      expect(named?.record).toBeNull();
    });
  });
});
