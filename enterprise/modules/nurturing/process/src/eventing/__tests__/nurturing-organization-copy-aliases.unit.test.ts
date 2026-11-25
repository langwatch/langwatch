// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Jobs the previous release queued under a retired copy subscriber's key reach the peer map that
 * replaced it, on a worker running the usage pipeline over memory stores.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import { SSO_AUTO_ADDED_EVENT_TYPE } from "@langwatch/auth-contract";
import { type Event, EventSourcing, type ReplayEvent } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import {
  INVITE_ACCEPTED_EVENT_TYPE,
  ORGANIZATION_AGGREGATE_TYPE,
  ORGANIZATION_CREATED_EVENT_TYPE,
  ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
  ORGANIZATION_SIGNED_UP_EVENT_TYPE,
  PERSONAL_TEAM_CREATED_EVENT_TYPE,
  PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
} from "@langwatch/organization-contract";
import {
  PROJECT_AGGREGATE_TYPE,
  PROJECT_CREATED_EVENT_TYPE,
  PROJECT_FIRST_MESSAGE_LISTED_EVENT_TYPE,
  PROJECT_PERSONAL_OWNER_LISTED_EVENT_TYPE,
} from "@langwatch/project-contract";
import { PROJECT_TRACED_EVENT_TYPE } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import type { NurturingRepositories } from "../../repositories/nurturing.repositories.ts";
import { buildNurturingProjectUsagePipeline } from "../nurturing-project-usage.pipeline.ts";
import {
  copiesOver,
  liveEventOf,
  ownerFact,
} from "./nurturing-organization-copies.test-helpers.ts";
import { allNurturingOwnerStandIns } from "./nurturing-owner-stand-ins.test-helpers.ts";

/** A worker of the new release: the copy owners and the usage pipeline, consuming. */
function worker() {
  const repositories = MemoryNurturingRepositories.create();
  const eventStore = EventStoreMemory.createForTesting();
  const eventing = new EventSourcing({ eventStore });
  // Every peer lane's owner must be registered, or starting consumers refuses the lane.
  for (const owner of allNurturingOwnerStandIns()) {
    owner.open((definition) => eventing.register(definition));
  }
  eventing.register(
    buildNurturingProjectUsagePipeline({
      store: repositories.projectUsage,
      evaluationDays: repositories.evaluationDays,
      traceDays: repositories.traceDays,
      copies: copiesOver(repositories),
      plans: { store: repositories.plans, deliver: async () => undefined },
      sync: undefined,
    }),
  );
  eventing.startConsumers();
  return { eventing, eventStore, repositories };
}

/** A job as the previous release queued it: the owner's event under the retired lane's key. */
async function queuedByPreviousRelease({
  eventing,
  key,
  event,
}: Readonly<{ eventing: EventSourcing; key: string; event: Event }>): Promise<void> {
  const [pipeline, jobType, ...name] = key.split(":");
  await eventing.globalQueue?.send({
    ...event,
    __pipelineName: pipeline,
    __jobType: jobType,
    __jobName: name.join(":"),
  });
}

const projectCreated = (): ReplayEvent =>
  ownerFact({
    type: PROJECT_CREATED_EVENT_TYPE,
    aggregateType: PROJECT_AGGREGATE_TYPE,
    aggregateId: "project-1",
    tenantId: "project-1",
    data: {
      tenantId: "project-1",
      projectId: "project-1",
      organizationId: "org-1",
      adminUserId: "admin-1",
      occurredAt: 1_000,
    },
  });

const organizationCreated = (): ReplayEvent =>
  ownerFact({
    type: ORGANIZATION_CREATED_EVENT_TYPE,
    aggregateType: ORGANIZATION_AGGREGATE_TYPE,
    aggregateId: "org-1",
    tenantId: "org-1",
    data: {
      tenantId: "org-1",
      organizationId: "org-1",
      organizationName: "Acme",
      userId: "user-1",
      occurredAt: 500,
    },
  });

type Case = Readonly<{
  key: string;
  fact: () => ReplayEvent;
  copied: (repositories: NurturingRepositories) => Promise<unknown>;
  expected: unknown;
}>;

const cases: [string, Case][] = [
  [
    "placement",
    {
      key: "global:subscriber:nurturing_project_usage.projectPlacement",
      fact: projectCreated,
      copied: (repositories) => repositories.placements.getPlacement({ projectId: "project-1" }),
      expected: { outcome: "known", organizationId: "org-1" },
    },
  ],
  [
    "organization creation",
    {
      key: "global:subscriber:nurturing_project_usage.organizationCreated",
      fact: organizationCreated,
      copied: (repositories) =>
        repositories.organizationsCreated.findOrganizationCreatedAt({ organizationId: "org-1" }),
      expected: { organizationCreatedAt: 500 },
    },
  ],
  [
    "admin",
    {
      key: "global:subscriber:nurturing.projectCreated",
      fact: projectCreated,
      copied: async (repositories) =>
        (await repositories.milestones.findOrganization({ organizationId: "org-1" })).map(
          ({ adminUserId, seeded }) => ({ adminUserId, seeded }),
        ),
      expected: [{ adminUserId: "admin-1", seeded: false }],
    },
  ],
];

/** Extra data a member fact's schema requires, and its aggregate when not an organization. */
type FactFields = Readonly<Record<string, string>>;

/** A member fact of user-1 in org-1, with what its owner's schema requires. */
const memberFact =
  (type: string, { aggregateType = ORGANIZATION_AGGREGATE_TYPE, ...extra }: FactFields = {}) =>
  (): ReplayEvent =>
    ownerFact({
      type,
      aggregateType,
      aggregateId: aggregateType === ORGANIZATION_AGGREGATE_TYPE ? "org-1" : "user-1",
      tenantId: "org-1",
      data: {
        tenantId: "org-1",
        organizationId: "org-1",
        userId: "user-1",
        organizationName: "Acme",
        occurredAt: 600,
        ...extra,
      },
    });

type MembershipTimes = Partial<Record<"joinedAt" | "leftAt" | "returnedAt", number>>;

/** A retired member lane, a fact its successor map takes, and user-1's row it leaves. */
function memberCase(lane: string, fact: () => ReplayEvent, times: MembershipTimes): [string, Case] {
  return [
    `${lane} member`,
    {
      key: `global:subscriber:nurturing_project_usage.${lane}`,
      fact,
      copied: (repositories) =>
        repositories.members.findMembershipsOfUsers({ userIds: ["user-1"] }),
      expected: [
        {
          organizationId: "org-1",
          userId: "user-1",
          joinedAt: null,
          leftAt: null,
          returnedAt: null,
          ...times,
        },
      ],
    },
  ];
}

const memberCases = [
  memberCase("memberFoundedOrganization", organizationCreated, { joinedAt: 500 }),
  memberCase("memberSignedUp", memberFact(ORGANIZATION_SIGNED_UP_EVENT_TYPE), { joinedAt: 600 }),
  memberCase(
    "memberInviteAccepted",
    memberFact(INVITE_ACCEPTED_EVENT_TYPE, { inviteId: "invite-1", role: "MEMBER" }),
    { joinedAt: 600 },
  ),
  memberCase(
    "memberSsoAutoAdded",
    memberFact(SSO_AUTO_ADDED_EVENT_TYPE, { aggregateType: "user" }),
    { joinedAt: 600 },
  ),
  memberCase("memberRemoved", memberFact(ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE), {
    leftAt: 600,
  }),
  memberCase("memberDisabled", memberFact(ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE), {
    leftAt: 600,
  }),
  memberCase("memberEnabled", memberFact(ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE), {
    returnedAt: 600,
  }),
];

/** A personal-project or traced-project fact of project-1 in org-1, with what its schema requires. */
const projectLaneFact =
  (type: string, aggregateType: string, extra: FactFields = {}) =>
  (): ReplayEvent =>
    ownerFact({
      type,
      aggregateType,
      aggregateId: aggregateType === ORGANIZATION_AGGREGATE_TYPE ? "org-1" : "project-1",
      tenantId: aggregateType === ORGANIZATION_AGGREGATE_TYPE ? "org-1" : "project-1",
      data: {
        tenantId: aggregateType === ORGANIZATION_AGGREGATE_TYPE ? "org-1" : "project-1",
        organizationId: "org-1",
        projectId: "project-1",
        occurredAt: 700,
        ...extra,
      },
    });

const personalOwnerCopied = (repositories: NurturingRepositories) =>
  repositories.personalProjects.findOwnerUserIds({ projectId: "project-1" });
const tracedCopied = (repositories: NurturingRepositories) =>
  repositories.tracedProjects.hasTraced({ organizationId: "org-1" });

/** A retired personal-project or traced-project lane, its successor's fact, and the row it writes. */
function projectLaneCase(
  lane: string,
  fact: () => ReplayEvent,
  copied: Case["copied"],
  expected: unknown,
): [string, Case] {
  return [
    `${lane} project`,
    { key: `global:subscriber:nurturing.${lane}`, fact, copied, expected },
  ];
}

const projectCases = [
  projectLaneCase(
    "personalTeamCreated",
    projectLaneFact(PERSONAL_TEAM_CREATED_EVENT_TYPE, ORGANIZATION_AGGREGATE_TYPE, {
      userId: "user-1",
      teamId: "team-1",
      projectSlug: "project-1",
    }),
    personalOwnerCopied,
    ["user-1"],
  ),
  projectLaneCase(
    "personalWorkspaceProvisioned",
    projectLaneFact(PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE, ORGANIZATION_AGGREGATE_TYPE, {
      userId: "user-1",
    }),
    personalOwnerCopied,
    ["user-1"],
  ),
  projectLaneCase(
    "personalOwnerListed",
    projectLaneFact(PROJECT_PERSONAL_OWNER_LISTED_EVENT_TYPE, PROJECT_AGGREGATE_TYPE, {
      ownerUserId: "user-1",
    }),
    personalOwnerCopied,
    ["user-1"],
  ),
  projectLaneCase(
    "projectTraced",
    projectLaneFact(PROJECT_TRACED_EVENT_TYPE, "trace_project_milestone"),
    tracedCopied,
    true,
  ),
  projectLaneCase(
    "firstMessageListed",
    projectLaneFact(PROJECT_FIRST_MESSAGE_LISTED_EVENT_TYPE, PROJECT_AGGREGATE_TYPE),
    tracedCopied,
    true,
  ),
];

describe("given a job the previous release queued under a retired copy subscriber's key", () => {
  /** @scenario "Copy jobs the previous release queued reach the peer map that replaced their lane" */
  it.each([...cases, ...memberCases, ...projectCases])(
    "routes the %s job to its successor map, which writes the copy",
    async (_name, { key, fact, copied, expected }) => {
      const { eventing, eventStore, repositories } = worker();
      const event = liveEventOf(fact());
      await eventStore.seed({ events: [event] });

      await queuedByPreviousRelease({ eventing, key, event });

      await vi.waitFor(async () => expect(await copied(repositories)).toEqual(expected));
      await eventing.close();
    },
  );
});
