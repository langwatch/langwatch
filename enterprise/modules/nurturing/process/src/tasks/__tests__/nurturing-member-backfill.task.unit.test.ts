// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/organization-member-facts.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryNurturingMemberSourceRepository } from "../../repositories/memory/memory.nurturing-member-source.repository.ts";
import { MemoryNurturingOrganizationMemberRepository } from "../../repositories/memory/memory.nurturing-organization-member.repository.ts";
import type { NurturingSourceMember } from "../../repositories/nurturing-member-source.repository.ts";
import {
  NurturingMemberBackfillTask,
  runNurturingMemberBackfill,
} from "../nurturing-member-backfill.task.ts";

const signal = new AbortController().signal;

/**
 * org-1 holds user-1 and user-2, org-2 holds user-1; the copy is empty. A deactivated user keeps
 * their membership rows but the owner's member read leaves them out.
 */
function setup({ deactivatedUserIds = [] }: { deactivatedUserIds?: readonly string[] } = {}) {
  const membersByOrganization: Record<string, NurturingSourceMember[]> = {
    "org-1": [
      { userId: "user-1", joinedAt: 1_000 },
      { userId: "user-2", joinedAt: 2_000 },
    ],
    "org-2": [{ userId: "user-1", joinedAt: 3_000 }],
  };
  const source = MemoryNurturingMemberSourceRepository.create({ membersByOrganization });
  const members = MemoryNurturingOrganizationMemberRepository.create();
  const organizations = {
    listAllIds: async () => ({ ids: ["org-1", "org-2"], next: null }),
    getAllMembers: async ({ organizationId }: { organizationId: string }) =>
      (membersByOrganization[organizationId] ?? [])
        .filter(({ userId }) => !deactivatedUserIds.includes(userId))
        .map(({ userId }) => ({ id: userId })) as never,
  };
  return { peers: { organizations, source, members }, members };
}

const rows = (members: MemoryNurturingOrganizationMemberRepository) =>
  members.findMembershipsOfUsers({ userIds: ["user-1", "user-2"] });

describe("runNurturingMemberBackfill", () => {
  describe("when execute is false", () => {
    /** @scenario "A dry run of the member backfill writes nothing" */
    it("writes no row and reports what a real run would create", async () => {
      const { peers, members } = setup();

      const outcome = await runNurturingMemberBackfill({ peers, execute: false, signal });

      expect(await rows(members)).toEqual([]);
      expect(outcome).toEqual({
        dryRun: { organizations: 2, memberships: 3, created: 3, alreadyPresent: 0, aborted: false },
        executed: null,
      });
    });
  });

  describe("when execute is true", () => {
    /** @scenario "The member backfill creates a row for each current member the copy lacks" */
    it("creates each missing row as a join at the membership's creation time", async () => {
      const { peers, members } = setup();

      const outcome = await runNurturingMemberBackfill({ peers, execute: true, signal });

      expect(await rows(members)).toEqual([
        {
          organizationId: "org-1",
          userId: "user-1",
          joinedAt: 1_000,
          leftAt: null,
          returnedAt: null,
        },
        {
          organizationId: "org-1",
          userId: "user-2",
          joinedAt: 2_000,
          leftAt: null,
          returnedAt: null,
        },
        {
          organizationId: "org-2",
          userId: "user-1",
          joinedAt: 3_000,
          leftAt: null,
          returnedAt: null,
        },
      ]);
      expect(outcome.executed).toEqual({
        organizations: 2,
        memberships: 3,
        created: 3,
        alreadyPresent: 0,
        aborted: false,
      });
    });

    /** @scenario "The member backfill leaves a member whose row exists, and a second run changes nothing" */
    it("skips a present row and a second run creates nothing", async () => {
      const { peers, members } = setup();
      await members.recordMembershipChange({
        organizationId: "org-1",
        userId: "user-1",
        change: "joined",
        at: 500,
      });

      const first = await runNurturingMemberBackfill({ peers, execute: true, signal });
      const afterFirst = await rows(members);
      const second = await runNurturingMemberBackfill({ peers, execute: true, signal });

      expect(first.executed).toMatchObject({ created: 2, alreadyPresent: 1 });
      expect(
        afterFirst.find((row) => row.organizationId === "org-1" && row.userId === "user-1"),
      ).toMatchObject({ joinedAt: 500 });
      expect(second.executed).toMatchObject({ created: 0, alreadyPresent: 3 });
      expect(await rows(members)).toEqual(afterFirst);
    });

    /** @scenario "The member backfill does not bring back a member who left" */
    it("does not touch a member whose latest record is a leave", async () => {
      const { peers, members } = setup();
      for (const [change, at] of [
        ["joined", 100],
        ["left", 5_000],
      ] as const) {
        await members.recordMembershipChange({
          organizationId: "org-1",
          userId: "user-2",
          change,
          at,
        });
      }
      const before = await rows(members);

      await runNurturingMemberBackfill({ peers, execute: true, signal });

      const left = (await rows(members)).find(
        (row) => row.organizationId === "org-1" && row.userId === "user-2",
      );
      expect(left).toEqual(before[0]);
      expect(left).toMatchObject({ joinedAt: 100, leftAt: 5_000 });
    });

    /** @scenario "The member backfill skips a member whose account is deactivated" */
    it("skips a member whose account is deactivated", async () => {
      const { peers, members } = setup({ deactivatedUserIds: ["user-2"] });

      const outcome = await runNurturingMemberBackfill({ peers, execute: true, signal });

      expect(
        (await rows(members)).map(({ organizationId, userId }) => [organizationId, userId]),
      ).toEqual([
        ["org-1", "user-1"],
        ["org-2", "user-1"],
      ]);
      expect(outcome.executed).toMatchObject({ memberships: 2, created: 2 });
    });

    it("does not start the real run when aborted after the dry run", async () => {
      const { peers, members } = setup();
      const controller = new AbortController();
      controller.abort();

      const outcome = await runNurturingMemberBackfill({
        peers,
        execute: true,
        signal: controller.signal,
      });

      expect(outcome.executed).toBeNull();
      expect(outcome.dryRun.aborted).toBe(true);
      expect(await rows(members)).toEqual([]);
    });
  });
});

describe("runNurturingMemberBackfill over several organization pages", () => {
  it("handles every organization and asks for the second page after the first page's next", async () => {
    const { peers, members } = setup();
    const asked: (string | undefined)[] = [];
    const organizations = {
      ...peers.organizations,
      listAllIds: async (input?: { after?: string }) => {
        asked.push(input?.after);
        return input?.after === undefined
          ? { ids: ["org-1"], next: "org-1" }
          : { ids: ["org-2"], next: null };
      },
    };

    const outcome = await runNurturingMemberBackfill({
      peers: { ...peers, organizations },
      execute: true,
      signal,
    });

    // The dry run pages first, then the real run pages again.
    expect(asked).toEqual([undefined, "org-1", undefined, "org-1"]);
    expect(outcome.executed).toMatchObject({ organizations: 2, created: 3 });
    expect(await rows(members)).toHaveLength(3);
  });
});

describe("NurturingMemberBackfillTask", () => {
  it("is named nurturing-member-backfill and writes only with --execute", async () => {
    const { peers, members } = setup();
    const task = NurturingMemberBackfillTask.create({ peers });
    expect(task.name).toBe("nurturing-member-backfill");

    await task.run({ args: [], signal });
    expect(await rows(members)).toEqual([]);

    await task.run({ args: ["--execute"], signal });
    expect(await rows(members)).toHaveLength(3);
  });
});
