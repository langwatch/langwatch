// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's member copy as two peer maps filled at deploy, organization's and auth's: the real
 * replay engine over seeded owner logs, the module's own steps, memory repositories. Live delivery
 * of the same facts through the registered lanes is the oracle.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import { SSO_AUTO_ADDED_EVENT_TYPE } from "@langwatch/auth-contract";
import type { ReplayEvent } from "@langwatch/eventing";
import {
  INVITE_ACCEPTED_EVENT_TYPE,
  ORGANIZATION_AGGREGATE_TYPE,
  ORGANIZATION_CREATED_EVENT_TYPE,
  ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_LISTED_EVENT_TYPE,
  ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
  ORGANIZATION_SIGNED_UP_EVENT_TYPE,
} from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import type { NurturingRepositories } from "../../repositories/nurturing.repositories.ts";
import {
  AUTH_MEMBERS_STEP,
  copiesDeploy,
  copiesOver,
  liveMapsOver,
  MEMBERS_STEP,
  ownerFact,
  userErasedFact,
} from "./nurturing-organization-copies.test-helpers.ts";

const PEOPLE = ["founder", "signed-up", "invited", "sso", "listed", "left", "returned", "erased"];

/** One of organization's member facts, or auth's single sign-on join, for a person. */
function memberFact({
  type,
  userId,
  organizationId = "org-1",
  occurredAt,
  extra = {},
}: Readonly<{
  type: string;
  userId: string;
  organizationId?: string;
  occurredAt: number;
  extra?: Readonly<Record<string, unknown>>;
}>): ReplayEvent {
  const auth = type === SSO_AUTO_ADDED_EVENT_TYPE;
  return ownerFact({
    type,
    aggregateType: auth ? "user" : ORGANIZATION_AGGREGATE_TYPE,
    aggregateId: auth ? userId : organizationId,
    tenantId: organizationId,
    data: {
      tenantId: organizationId,
      organizationId,
      userId,
      organizationName: "Acme",
      occurredAt,
      ...extra,
    },
  });
}

/** Organization's listing of a membership from before it recorded member facts. */
const listed = (userId: string, joinedAt: number, organizationId = "org-1") =>
  memberFact({
    type: ORGANIZATION_MEMBER_LISTED_EVENT_TYPE,
    userId,
    organizationId,
    occurredAt: 9_000,
    extra: { joinedAt, backfilled: true },
  });

/** Every kind of member fact the two lanes take, across two organizations. */
function membersLog(): ReplayEvent[] {
  return [
    memberFact({ type: ORGANIZATION_CREATED_EVENT_TYPE, userId: "founder", occurredAt: 1_000 }),
    memberFact({ type: ORGANIZATION_SIGNED_UP_EVENT_TYPE, userId: "signed-up", occurredAt: 1_100 }),
    memberFact({
      type: INVITE_ACCEPTED_EVENT_TYPE,
      userId: "invited",
      occurredAt: 1_200,
      extra: { inviteId: "invite-1", role: "MEMBER" },
    }),
    memberFact({ type: SSO_AUTO_ADDED_EVENT_TYPE, userId: "sso", occurredAt: 1_300 }),
    listed("listed", 500),
    listed("listed", 700, "org-2"),
    memberFact({
      type: INVITE_ACCEPTED_EVENT_TYPE,
      userId: "left",
      occurredAt: 1_400,
      extra: { inviteId: "invite-2" },
    }),
    memberFact({ type: ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE, userId: "left", occurredAt: 2_000 }),
    listed("returned", 600),
    memberFact({
      type: ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
      userId: "returned",
      occurredAt: 2_100,
    }),
    memberFact({
      type: ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE,
      userId: "returned",
      occurredAt: 2_200,
    }),
  ];
}

/** Every membership the copy holds of the people, in a stable order. */
async function membershipsOf(repositories: NurturingRepositories, people = PEOPLE) {
  const memberships = await repositories.members.findMembershipsOfUsers({ userIds: people });
  return memberships.toSorted((a, b) =>
    `${a.userId}:${a.organizationId}`.localeCompare(`${b.userId}:${b.organizationId}`),
  );
}

/** What live delivery of the facts, one at a time in the given order, leaves in the copy. */
async function liveMemberships(facts: readonly ReplayEvent[]) {
  const repositories = MemoryNurturingRepositories.create();
  const deliver = liveMapsOver(copiesOver(repositories));
  for (const fact of facts) await deliver(fact);
  return membershipsOf(repositories);
}

describe("given organization's and auth's logs holding memberships from before the copy existed", () => {
  /** @scenario "Members from before the copy existed are copied at deploy from organization's and auth's logs" */
  it("fills the member copy as live delivery of the same facts would", async () => {
    const facts = membersLog();
    const worker = copiesDeploy({ events: facts });

    await worker.runAll();

    const rows = await membershipsOf(worker.repositories);
    expect(rows).toEqual(await liveMemberships(facts));
    expect(rows.find(({ userId }) => userId === "listed")).toMatchObject({ joinedAt: 500 });
    expect(rows.find(({ userId }) => userId === "sso")).toMatchObject({ joinedAt: 1_300 });
  });

  /** @scenario "Replaying the member copy twice leaves every row as it was" */
  it("leaves every row byte-identical when both member steps run again", async () => {
    const worker = copiesDeploy({ events: membersLog() });
    await worker.runAll();
    const first = JSON.stringify(await membershipsOf(worker.repositories));

    await worker.run(MEMBERS_STEP);
    await worker.run(AUTH_MEMBERS_STEP);

    expect(JSON.stringify(await membershipsOf(worker.repositories))).toBe(first);
  });

  /** @scenario "Every active member organization lists gets a member row, once" */
  it("gives each listed member a current membership, and a second run adds no row", async () => {
    const people = ["a", "b", "c"];
    const worker = copiesDeploy({
      events: [listed("a", 100), listed("b", 200), listed("c", 300, "org-2")],
    });

    await worker.runAll();
    const once = await membershipsOf(worker.repositories, people);
    await worker.run(MEMBERS_STEP);

    expect(once.map(({ userId, organizationId }) => [userId, organizationId])).toEqual([
      ["a", "org-1"],
      ["b", "org-1"],
      ["c", "org-2"],
    ]);
    expect(once.every(({ leftAt }) => leftAt === null)).toBe(true);
    expect(await membershipsOf(worker.repositories, people)).toEqual(once);
  });
});

describe("given the member facts delivered live", () => {
  /** @scenario "Nurturing keeps its own copy of an organization's members" */
  it("leaves the same rows in reverse order and when every fact is delivered twice", async () => {
    const facts = membersLog();
    const forward = await liveMemberships(facts);

    expect(await liveMemberships(facts.toReversed())).toEqual(forward);
    expect(await liveMemberships(facts.flatMap((fact) => [fact, fact]))).toEqual(forward);
  });
});

describe("given a member was erased", () => {
  const facts = () => [
    memberFact({ type: ORGANIZATION_SIGNED_UP_EVENT_TYPE, userId: "erased", occurredAt: 1_000 }),
    memberFact({ type: SSO_AUTO_ADDED_EVENT_TYPE, userId: "erased", occurredAt: 1_100 }),
    listed("erased", 400, "org-2"),
    memberFact({ type: ORGANIZATION_SIGNED_UP_EVENT_TYPE, userId: "kept", occurredAt: 1_200 }),
  ];

  /** @scenario "The deploy replay copies no member erased before the copy existed" */
  it("copies them into no organization when the steps run in the declared order", async () => {
    const worker = copiesDeploy({ events: [...facts(), userErasedFact("erased")] });

    await worker.runAll();

    await expect(membershipsOf(worker.repositories, ["erased"])).resolves.toEqual([]);
    await expect(membershipsOf(worker.repositories, ["kept"])).resolves.toHaveLength(1);
  });

  /** @scenario "The deploy replay copies no member erased before the copy existed" */
  it("leaves them in no organization when erased while the member steps replay", async () => {
    const repositories = MemoryNurturingRepositories.create();
    let erasedOnce = false;
    const worker = copiesDeploy({
      events: facts(),
      repositories,
      copies: {
        ...copiesOver(repositories),
        members: {
          findMembershipsOfMembers: (input) => repositories.members.findMembershipsOfMembers(input),
          findMembershipsOfUsers: (input) => repositories.members.findMembershipsOfUsers(input),
          forgetMember: (input) => repositories.members.forgetMember(input),
          recordMembershipChange: async (input) => {
            await repositories.members.recordMembershipChange(input);
            if (erasedOnce) return;
            erasedOnce = true;
            await repositories.members.forgetMember({ userId: "erased" });
          },
        },
      },
    });

    await worker.run(MEMBERS_STEP);
    await worker.run(AUTH_MEMBERS_STEP);

    await expect(membershipsOf(repositories, ["erased"])).resolves.toEqual([]);
  });

  /** @scenario "The deploy replay copies no member erased before the copy existed" */
  it("writes them nowhere when a member fact naming them lands live afterwards", async () => {
    const worker = copiesDeploy({ events: [userErasedFact("erased")] });
    await worker.runAll();
    const deliver = liveMapsOver(copiesOver(worker.repositories));

    for (const fact of facts()) await deliver(fact);

    await expect(membershipsOf(worker.repositories, ["erased"])).resolves.toEqual([]);
  });
});

describe("given a deployment with a Customer.io channel", () => {
  /** @scenario "Replaying the member copy sends nothing" */
  it("runs no sync when the member steps replay", async () => {
    const sync = {
      usageChanged: vi.fn(async () => undefined),
      tracesChanged: vi.fn(async () => undefined),
      organizationCreated: vi.fn(async () => undefined),
    };
    const worker = copiesDeploy({ events: membersLog(), sync });

    await worker.runAll();

    for (const call of Object.values(sync)) expect(call).not.toHaveBeenCalled();
    await expect(membershipsOf(worker.repositories)).resolves.not.toEqual([]);
  });
});
