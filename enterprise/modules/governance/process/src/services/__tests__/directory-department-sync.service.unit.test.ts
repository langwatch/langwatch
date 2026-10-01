import { createApiFixture } from "@langwatch/api-fixture";
import type { NormalizedPullEvent } from "@langwatch/enterprise-governance-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// Port of main's directoryDepartmentSync unit and integration tests, over the memory tier.
import { describe, expect, it } from "vitest";

import { MemoryDepartmentRepository } from "../../repositories/memory/memory.department.repository.ts";
import { MemoryGovernanceStore } from "../../repositories/memory/memory.governance.store.ts";
import { COPILOT_STUDIO_DATAVERSE_ADAPTER_ID } from "../../rules/dataverse-environment-service.rules.ts";
import { DIRECTORY_REPORT_ACTION } from "../../rules/microsoft-graph-directory.rules.ts";
import { DepartmentService } from "../department.service.ts";
import { DirectoryDepartmentSyncService } from "../directory-department-sync.service.ts";

const ORG = "org_dirdept";
const OID = "f6481ec4-0000-4000-8000-0000000000a1";
const MARIA = "user_maria";
const OTHER = "user_other";

function row({
  actor = OID,
  mail = "",
  department,
}: {
  actor?: string;
  mail?: string;
  department: string;
}): NormalizedPullEvent {
  return {
    source_event_id: `dir_${actor}`,
    event_timestamp: "2026-09-03T00:00:00.000Z",
    actor,
    action: DIRECTORY_REPORT_ACTION,
    target: department,
    cost_usd: "0",
    tokens_input: 0,
    tokens_output: 0,
    raw_payload: "{}",
    extra: { directoryId: actor, mail, department },
  };
}

function harness(input: {
  byEmail?: [string, string[]][];
  byDirectoryId?: [string, string[]][];
  linkedUserId?: string;
  memberDepartments?: Record<string, string | null>;
}) {
  const store = MemoryGovernanceStore.create();
  const repository = MemoryDepartmentRepository.create(store);
  const pointers = new Map(
    Object.entries(input.memberDepartments ?? { [MARIA]: null, [OTHER]: null }),
  );
  /** Governance's own dated links, which `DepartmentService.assignUser` records. */
  const links = store.departmentMemberships;
  const organizations = createApiFixture<OrganizationApi>({
    assignMemberDepartment: async ({ userId, departmentId }) => {
      if (!pointers.has(userId)) return false;
      pointers.set(userId, departmentId);
      return true;
    },
    findMemberDepartments: async ({ userIds }) =>
      userIds.flatMap((userId) =>
        pointers.has(userId) ? [{ userId, departmentId: pointers.get(userId) ?? null }] : [],
      ),
  });
  const departments = DepartmentService.create({
    repository,
    organizations,
    projects: createApiFixture<ProjectApi>({}),
  });
  const sync = DirectoryDepartmentSyncService.create({
    departments,
    matcher: {
      loadAccountIndex: async () => ({
        usersByVerifiedEmail: new Map(input.byEmail ?? []),
        usersByDirectoryId: new Map(input.byDirectoryId ?? []),
      }),
    },
    discoveredPeople: {
      findByActorIds: async () => (input.linkedUserId ? [{ id: "person_1", rawActorId: OID }] : []),
    },
    matches: {
      findOpenByOrganization: async () =>
        input.linkedUserId
          ? [
              {
                discoveredPersonId: "person_1",
                userId: input.linkedUserId,
                evidenceKind: "confirmed",
              },
            ]
          : [],
    },
    organizations,
  });
  const apply = (events: NormalizedPullEvent[]) =>
    sync.applyDirectoryEvents({
      organizationId: ORG,
      provider: COPILOT_STUDIO_DATAVERSE_ADAPTER_ID,
      events,
    });
  const named = (name: string) => store.departments.find((department) => department.name === name);
  return { apply, pointers, links, store, repository, named };
}

describe("DirectoryDepartmentSyncService", () => {
  /** @scenario "A directory department lands on the member it proves" */
  it("assigns a member their directory department through a confirmed address", async () => {
    const { apply, pointers, repository, named } = harness({
      byEmail: [["maria@acme.example", [MARIA]]],
    });
    const existing = await repository.create({ organizationId: ORG, name: "Engineering" });

    const outcome = await apply([row({ mail: "maria@acme.example", department: "Engineering" })]);

    expect(outcome.assigned).toBe(1);
    expect(pointers.get(MARIA)).toBe(existing.id);
    expect(named("Engineering")?.id).toBe(existing.id);
  });

  /** @scenario "A department the organization has not created yet is created" */
  it("creates a department the organization has not created yet", async () => {
    const { apply, pointers, named } = harness({ byDirectoryId: [[OID, [MARIA]]] });

    await apply([row({ department: "Finance" })]);

    expect(named("Finance")).toBeDefined();
    expect(pointers.get(MARIA)).toBe(named("Finance")?.id);
  });

  /** @scenario "A blank directory department leaves the member's assignment alone" */
  it("leaves a hand-assigned member alone when their directory department is blank", async () => {
    const { apply, pointers } = harness({
      byDirectoryId: [[OID, [MARIA]]],
      memberDepartments: { [MARIA]: "dept_by_hand" },
    });

    expect(await apply([row({ department: "   " })])).toEqual({ assigned: 0 });
    expect(pointers.get(MARIA)).toBe("dept_by_hand");
  });

  /** @scenario "Conflicting directory and confirmed email proof changes no department" */
  it("leaves both assignments and their histories untouched", async () => {
    const { apply, pointers, links, named } = harness({
      byDirectoryId: [[OID, [MARIA]]],
      byEmail: [["other@acme.example", [OTHER]]],
      memberDepartments: { [MARIA]: "dept_a", [OTHER]: "dept_b" },
    });

    expect(await apply([row({ mail: "other@acme.example", department: "Brand new" })])).toEqual({
      assigned: 0,
    });
    expect([pointers.get(MARIA), pointers.get(OTHER)]).toEqual(["dept_a", "dept_b"]);
    expect(links).toEqual([]);
    expect(named("Brand new")).toBeUndefined();
  });

  /** @scenario "An accepted identity link outranks a disagreeing directory row" */
  it("assigns the department to the linked account and never to the directory's", async () => {
    const { apply, pointers } = harness({ byDirectoryId: [[OID, [OTHER]]], linkedUserId: MARIA });

    expect(await apply([row({ department: "Engineering" })])).toEqual({ assigned: 1 });
    expect(pointers.get(OTHER)).toBeNull();
    expect(pointers.get(MARIA)).not.toBeNull();
  });

  /** @scenario "A directory row proving no member assigns nobody" */
  it("assigns nobody from a row that proves nobody, and creates no department for it", async () => {
    const { apply, named } = harness({});

    expect(await apply([row({ department: "Nowhere" })])).toEqual({ assigned: 0 });
    expect(named("Nowhere")).toBeUndefined();
  });

  it("costs nothing to run twice: one department, one open link, no write reported", async () => {
    const { apply, links, store } = harness({ byDirectoryId: [[OID, [MARIA]]] });

    await apply([row({ department: "Engineering" })]);
    expect(await apply([row({ department: "Engineering" })])).toEqual({ assigned: 0 });
    expect(store.departments).toHaveLength(1);
    expect(links).toHaveLength(1);
  });
});
