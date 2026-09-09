/**
 * The one departments table's rows: what happens when the organization created
 * a department and a connected directory names one too.
 *
 * Spec: specs/ai-governance/dashboard/people-tabs.feature
 */
import { describe, expect, it } from "vitest";

import { mergeDepartmentRows } from "../departmentRows";

describe("given the departments an organization created and the ones its directories name", () => {
  describe("when both name the same department", () => {
    /** @scenario "A department the organization created and one a directory names are one row" */
    it("renders one row carrying the record and the provider that named it", () => {
      const rows = mergeDepartmentRows({
        departments: [{ id: "dept_1", name: "Engineering" }],
        observed: [
          {
            name: "Engineering",
            peopleCount: 4,
            providers: ["openai_admin"],
          },
        ],
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        name: "Engineering",
        record: { id: "dept_1", name: "Engineering" },
        providers: ["openai_admin"],
        directoryPeopleCount: 4,
      });
    });

    /** @scenario "A department the organization created and one a directory names are one row" */
    it("matches on the trimmed name, the way the directory sync resolves it", () => {
      const rows = mergeDepartmentRows({
        departments: [{ id: "dept_1", name: "Engineering" }],
        observed: [
          {
            name: "  Engineering ",
            peopleCount: 2,
            providers: ["openai_admin"],
          },
        ],
      });

      expect(rows).toHaveLength(1);
      // The organization's own spelling wins: it is the name spend attributes
      // under and the one the assignment pickers show.
      expect(rows[0]?.name).toBe("Engineering");
      expect(rows[0]?.record).toEqual({ id: "dept_1", name: "Engineering" });
    });

    it("adds up two directory spellings that differ only in spacing", () => {
      // The backend trims before resolving, so both land on one Department.
      // The row has to sum them, not let the last one stand for both.
      const rows = mergeDepartmentRows({
        departments: [],
        observed: [
          { name: "Engineering", peopleCount: 2, providers: ["openai_admin"] },
          {
            name: " Engineering ",
            peopleCount: 3,
            providers: ["copilot_studio_dataverse"],
          },
        ],
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.directoryPeopleCount).toBe(5);
      expect(rows[0]?.providers).toEqual([
        "copilot_studio_dataverse",
        "openai_admin",
      ]);
    });
  });

  describe("when a directory's casing differs from the one the organization created", () => {
    /** @scenario "A directory spelling that differs in case is a different department" */
    it("keeps them two rows, because the backend keeps them two departments", () => {
      // `DepartmentService.resolveByNameOrCreate` looks the name up with an
      // exact, case-sensitive equality, so a directory sending "engineering"
      // to an organization holding "Engineering" CREATES a second department
      // and the two attribute spend separately. One row would claim otherwise,
      // and would leave one of the two records unmanageable from this screen.
      const rows = mergeDepartmentRows({
        departments: [{ id: "dept_1", name: "Engineering" }],
        observed: [
          { name: "engineering", peopleCount: 2, providers: ["openai_admin"] },
        ],
      });

      expect(rows).toHaveLength(2);
      // Which of the two sorts first is the collator's business, not this
      // rule's. What matters is that both survive and only ours is a record.
      expect(rows.find((row) => row.name === "Engineering")?.record).toEqual({
        id: "dept_1",
        name: "Engineering",
      });
      expect(rows.find((row) => row.name === "engineering")?.record).toBeNull();
    });
  });

  describe("when only a directory names it", () => {
    /** @scenario "A department only a directory named carries its provider and no row actions" */
    it("puts it on the same table with no record behind it", () => {
      const rows = mergeDepartmentRows({
        departments: [],
        observed: [
          {
            name: "Customer Support",
            peopleCount: 3,
            providers: ["copilot_studio_dataverse"],
          },
        ],
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        name: "Customer Support",
        record: null,
        providers: ["copilot_studio_dataverse"],
        directoryPeopleCount: 3,
      });
    });
  });

  describe("when only the organization created it", () => {
    /** @scenario "A department no directory named reports no headcount rather than zero" */
    it("leaves the directory headcount unmeasured rather than zero", () => {
      const rows = mergeDepartmentRows({
        departments: [{ id: "dept_1", name: "Finance" }],
        observed: [],
      });

      expect(rows[0]).toMatchObject({
        name: "Finance",
        providers: [],
        // Zero would report the department empty. The members an administrator
        // assigned to it are not counted here at all.
        directoryPeopleCount: null,
      });
    });
  });

  describe("when there are several of each", () => {
    it("orders them by name, not by which side they came from", () => {
      const rows = mergeDepartmentRows({
        departments: [
          { id: "dept_1", name: "Sales" },
          { id: "dept_2", name: "Finance" },
        ],
        observed: [
          { name: "Engineering", peopleCount: 9, providers: ["openai_admin"] },
          { name: "Applied AI", peopleCount: 1, providers: ["openai_admin"] },
        ],
      });

      expect(rows.map((row) => row.name)).toEqual([
        "Applied AI",
        "Engineering",
        "Finance",
        "Sales",
      ]);
    });

    it("gives every row a key of its own, discovered ones included", () => {
      const rows = mergeDepartmentRows({
        departments: [{ id: "dept_1", name: "Sales" }],
        observed: [
          { name: "Engineering", peopleCount: 1, providers: ["openai_admin"] },
        ],
      });

      expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    });
  });
});
