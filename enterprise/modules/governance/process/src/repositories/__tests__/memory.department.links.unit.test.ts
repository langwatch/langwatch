// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * A member's dated department links, which governance owns (DepartmentMembershipHistory).
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryDepartmentRepository } from "../memory/memory.department.repository.ts";
import { MemoryGovernanceStore } from "../memory/memory.governance.store.ts";

const ACME = "org_acme";

function harness() {
  const store = MemoryGovernanceStore.create();
  const repository = MemoryDepartmentRepository.create(store);
  const record = (departmentId: string | null, iso: string) =>
    repository.recordMemberDepartment({
      organizationId: ACME,
      userId: "maria",
      departmentId,
      at: Temporal.Instant.from(iso),
    });
  const openLinks = () =>
    repository.findOpenMemberDepartmentLinks({ organizationId: ACME, userIds: ["maria"] });
  return { store, repository, record, openLinks };
}

describe("a member's dated department links", () => {
  it("dates each move so a past day resolves to where the member ended it", async () => {
    const { repository, record } = harness();
    await record("dept_eng", "2026-01-10T09:00:00Z");
    await record("dept_ops", "2026-02-03T12:00:00Z");
    const onDay = (dayUtc: string) =>
      repository.findMemberDepartmentsOnDay({ organizationId: ACME, userIds: ["maria"], dayUtc });

    expect(await onDay("2026-01-09")).toEqual([]);
    expect(await onDay("2026-01-20")).toEqual([{ userId: "maria", departmentId: "dept_eng" }]);
    expect(await onDay("2026-02-03")).toEqual([{ userId: "maria", departmentId: "dept_ops" }]);
  });

  it("keeps the open link when the standing department is recorded again", async () => {
    const { store, record, openLinks } = harness();
    await record("dept_eng", "2026-01-10T09:00:00Z");
    await record("dept_eng", "2026-01-11T09:00:00Z");

    expect(store.departmentMemberships).toHaveLength(1);
    expect(await openLinks()).toEqual([{ userId: "maria", departmentId: "dept_eng" }]);
  });

  it("closes the open link and opens none when the department is cleared", async () => {
    const { record, openLinks } = harness();
    await record("dept_eng", "2026-01-10T09:00:00Z");
    await record(null, "2026-01-12T09:00:00Z");

    expect(await openLinks()).toEqual([]);
  });
});
