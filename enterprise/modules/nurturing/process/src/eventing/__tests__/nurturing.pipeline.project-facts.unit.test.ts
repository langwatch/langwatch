// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-facts-copies.feature
 */
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import {
  PERSONAL_TEAM_CREATED_EVENT_TYPE,
  PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
} from "@langwatch/organization-contract";
import {
  PROJECT_FIRST_MESSAGE_LISTED_EVENT_TYPE,
  PROJECT_FIRST_MESSAGE_LISTED_EVENT_VERSION,
  PROJECT_PERSONAL_OWNER_LISTED_EVENT_TYPE,
  PROJECT_PERSONAL_OWNER_LISTED_EVENT_VERSION,
} from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { PROJECT_TRACED_EVENT_TYPE, PROJECT_TRACED_EVENT_VERSION } from "@langwatch/trace-contract";
import {
  USER_AGGREGATE_TYPE,
  USER_ERASED_EVENT_TYPE,
  USER_LIFECYCLE_EVENT_VERSION,
  type UserApi,
} from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { HttpCustomerIoChannel } from "../../channels/http/http.customer-io.channel.ts";
import { MemoryPostHogChannel } from "../../channels/memory/memory.posthog.channel.ts";
import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingOrganizationMemberRepository } from "../../repositories/memory/memory.nurturing-organization-member.repository.ts";
import { MemoryNurturingPersonalProjectRepository } from "../../repositories/memory/memory.nurturing-personal-project.repository.ts";
import { MemoryNurturingTracedProjectRepository } from "../../repositories/memory/memory.nurturing-traced-project.repository.ts";
import { unplacedMemberFacts } from "../../services/__tests__/nurturing-member-facts.test-helpers.ts";
import { NurturingDeliveryService } from "../../services/nurturing-delivery.service.ts";
import { NurturingProjectFactsService } from "../../services/nurturing-project-facts.service.ts";
import { NurturingUserErasureService } from "../../services/nurturing-user-erasure.service.ts";
import { NurturingService } from "../../services/nurturing.service.ts";
import { buildNurturingPipeline } from "../nurturing.pipeline.ts";

/**
 * Nurturing's pipeline as the app composes it, over its own memory copies, memory PostHog and a
 * recording Customer.io, so an assertion can read both the rows and every request either sink saw.
 */
function nurturingOverCopies() {
  const posthog = MemoryPostHogChannel.create();
  const customerIoFetch = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(null, { status: 200 }),
  );
  const seen = new Set<string>();
  const delivery = NurturingDeliveryService.create({
    memberFacts: unplacedMemberFacts(),
    claims: {
      claim: async (key: string) => !seen.has(key) && Boolean(seen.add(key)),
      release: async (key: string) => void seen.delete(key),
    },
    customerIo: NurturingService.create({
      channel: HttpCustomerIoChannel.create({
        config: { customerIoApiKey: "key", customerIoRegion: "us" },
        fetchFn: customerIoFetch,
      }),
    }),
    posthog,
    users: createApiFixture<UserApi>({}),
  });
  const personalProjects = MemoryNurturingPersonalProjectRepository.create();
  const tracedProjects = MemoryNurturingTracedProjectRepository.create();
  const organizations = MemoryNurturingMilestonesRepository.create();
  const { logger, lines } = createTestLogger();
  const projectFacts = NurturingProjectFactsService.create({
    personalProjects,
    tracedProjects,
    logger,
  });
  const members = MemoryNurturingOrganizationMemberRepository.create();
  const userErasure = NurturingUserErasureService.create({
    personalProjects,
    organizations,
    members,
  });
  const pipeline = buildNurturingPipeline({
    deliver: (input) => delivery.deliver(input),
    projectCreated: async () => undefined,
    guidedTurnFailed: (data) => delivery.deliverGuidedTurnFailed(data),
    usageReportReceived: (input) => delivery.deliverUsageReport(input),
    evaluationsCompleted: async () => undefined,
    simulationRunsFinished: async () => undefined,
    codingSessionsStored: async () => undefined,
    recordPersonalOwner: (input) => projectFacts.recordPersonalOwner(input),
    recordTracedProject: (input) => projectFacts.recordTracedProject(input),
    forgetErasedUser: (input) => userErasure.forgetUser(input),
  });
  const subscribers: EventSubscriberDefinition<Event>[] = [];
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({ registerEventSubscriber: (subscriber) => void subscribers.push(subscriber) });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  /** Hands one event to every nurturing peer subscriber on its type, as the worker would. */
  const deliverFact = async (event: Event) => {
    for (const subscriber of subscribers.filter(({ eventTypes }) =>
      eventTypes.includes(event.type),
    )) {
      await subscriber.handle(event, { tenantId: event.tenantId, aggregateId: event.aggregateId });
    }
  };
  /** Every request either sink saw, after the fire-and-forget sends settle. */
  const sinkRequests = async () => {
    for (let tick = 0; tick < 3; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
    return {
      customerIo: customerIoFetch.mock.calls.length,
      posthog: posthog.tracked.length + posthog.identified.length,
    };
  };
  return {
    personalProjects,
    tracedProjects,
    organizations,
    members,
    deliverFact,
    sinkRequests,
    logLines: lines,
  };
}

const NO_REQUESTS = { customerIo: 0, posthog: 0 };

function fact({
  type,
  aggregateType,
  aggregateId,
  version,
  data,
}: {
  type: string;
  aggregateType: string;
  aggregateId: string;
  version: string;
  data: Record<string, unknown>;
}): Event {
  return {
    id: `evt-${type}-${aggregateId}-${String(data.projectId)}`,
    aggregateId,
    aggregateType,
    tenantId: createTenantId(String(data.tenantId)),
    createdAt: 1_000,
    occurredAt: 1_000,
    type,
    version,
    data,
  } as Event;
}

/** Organization's fact that a member's personal team was created, naming its project. */
function personalTeamCreated({ projectId, userId }: { projectId: string; userId: string }) {
  return fact({
    type: PERSONAL_TEAM_CREATED_EVENT_TYPE,
    aggregateType: "organization",
    aggregateId: "org-1",
    version: "2026-10-09",
    data: {
      tenantId: "org-1",
      organizationId: "org-1",
      userId,
      teamId: "team-1",
      projectId,
      projectSlug: projectId,
      occurredAt: 1_000,
    },
  });
}

/** Organization's older fact that a personal workspace was provisioned. */
function personalWorkspaceProvisioned({
  projectId,
  userId,
}: {
  projectId: string;
  userId: string;
}) {
  return fact({
    type: PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
    aggregateType: "organization",
    aggregateId: "org-1",
    version: "2026-09-30",
    data: { tenantId: "org-1", organizationId: "org-1", userId, projectId, occurredAt: 1_000 },
  });
}

/** Trace's fact that a project received its first real trace. */
function projectTraced({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId: string | null;
}) {
  return fact({
    type: PROJECT_TRACED_EVENT_TYPE,
    aggregateType: "trace_project_milestone",
    aggregateId: projectId,
    version: PROJECT_TRACED_EVENT_VERSION,
    data: { tenantId: projectId, projectId, organizationId, occurredAt: 1_000 },
  });
}

/** Project's listed owner of a stored personal project. */
function personalOwnerListed({
  projectId,
  ownerUserId,
}: {
  projectId: string;
  ownerUserId: string;
}) {
  return fact({
    type: PROJECT_PERSONAL_OWNER_LISTED_EVENT_TYPE,
    aggregateType: "project",
    aggregateId: projectId,
    version: PROJECT_PERSONAL_OWNER_LISTED_EVENT_VERSION,
    data: {
      tenantId: projectId,
      projectId,
      organizationId: "org-1",
      ownerUserId,
      occurredAt: 1_000,
    },
  });
}

/** Project's listed project that already received its first message. */
function firstMessageListed({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId: string;
}) {
  return fact({
    type: PROJECT_FIRST_MESSAGE_LISTED_EVENT_TYPE,
    aggregateType: "project",
    aggregateId: projectId,
    version: PROJECT_FIRST_MESSAGE_LISTED_EVENT_VERSION,
    data: { tenantId: projectId, projectId, organizationId, occurredAt: 1_000 },
  });
}

/** User's fact that an account was erased; its tenant is the user's own id. */
function userErased({ userId }: { userId: string }) {
  return fact({
    type: USER_ERASED_EVENT_TYPE,
    aggregateType: USER_AGGREGATE_TYPE,
    aggregateId: userId,
    version: USER_LIFECYCLE_EVENT_VERSION,
    data: { tenantId: userId, userId, occurredAt: 2_000, organizationIds: ["org-1"] },
  });
}

describe("nurturing's copy of each personal project's owner", () => {
  describe("when organization records a personal team, delivered twice", () => {
    /** @scenario "A new personal workspace leaves one owner row naming its member" */
    it("keeps one owner for the project and calls neither sink", async () => {
      const { personalProjects, deliverFact, sinkRequests } = nurturingOverCopies();

      await deliverFact(personalTeamCreated({ projectId: "project-p1", userId: "user-1" }));
      await deliverFact(personalTeamCreated({ projectId: "project-p1", userId: "user-1" }));

      expect(personalProjects.storedRows()).toEqual([
        { projectId: "project-p1", organizationId: "org-1", ownerUserId: "user-1" },
      ]);
      await expect(personalProjects.findOwnerUserIds({ projectId: "project-p1" })).resolves.toEqual(
        ["user-1"],
      );
      await expect(sinkRequests()).resolves.toEqual(NO_REQUESTS);
    });
  });

  describe("when organization's older provisioned fact is replayed", () => {
    /** @scenario "A new personal workspace leaves one owner row naming its member" */
    it("records the owner it names", async () => {
      const { personalProjects, deliverFact, sinkRequests } = nurturingOverCopies();

      await deliverFact(
        personalWorkspaceProvisioned({ projectId: "project-p5", userId: "user-5" }),
      );

      await expect(personalProjects.findOwnerUserIds({ projectId: "project-p5" })).resolves.toEqual(
        ["user-5"],
      );
      await expect(sinkRequests()).resolves.toEqual(NO_REQUESTS);
    });
  });

  describe("when a second personal team fact for the same team names a new project id", () => {
    /** @scenario "A second personal team fact leaves the first owner row unchanged" */
    it("leaves the first row and writes an inert row for the id no project took", async () => {
      const { personalProjects, deliverFact, sinkRequests } = nurturingOverCopies();

      await deliverFact(personalTeamCreated({ projectId: "project-p1", userId: "user-1" }));
      await deliverFact(personalTeamCreated({ projectId: "project-p1-again", userId: "user-1" }));

      await expect(personalProjects.findOwnerUserIds({ projectId: "project-p1" })).resolves.toEqual(
        ["user-1"],
      );
      await expect(
        personalProjects.findOwnerUserIds({ projectId: "project-p1-again" }),
      ).resolves.toEqual(["user-1"]);
      await expect(sinkRequests()).resolves.toEqual(NO_REQUESTS);
    });
  });

  describe("when project lists an owner for a project already recorded live", () => {
    /** @scenario "Project's listed owners fill the owner rows, and a live row stays as it was" */
    it("keeps the live row and fills the listed one, calling neither sink", async () => {
      const { personalProjects, deliverFact, sinkRequests } = nurturingOverCopies();
      await deliverFact(personalTeamCreated({ projectId: "project-p4", userId: "user-4" }));

      await deliverFact(
        personalOwnerListed({ projectId: "project-p4", ownerUserId: "someone-else" }),
      );
      await deliverFact(personalOwnerListed({ projectId: "project-p1", ownerUserId: "user-1" }));

      await expect(personalProjects.findOwnerUserIds({ projectId: "project-p4" })).resolves.toEqual(
        ["user-4"],
      );
      await expect(personalProjects.findOwnerUserIds({ projectId: "project-p1" })).resolves.toEqual(
        ["user-1"],
      );
      await expect(sinkRequests()).resolves.toEqual(NO_REQUESTS);
    });
  });
});

describe("nurturing's copy of each traced project", () => {
  describe("when trace records a project traced in an organization with no admin", () => {
    /** @scenario "Trace's traced fact leaves one traced row for its organization" */
    it("records the organization as traced and calls neither sink", async () => {
      const { tracedProjects, deliverFact, sinkRequests } = nurturingOverCopies();

      await deliverFact(projectTraced({ projectId: "project-e1", organizationId: "org-e" }));
      await deliverFact(projectTraced({ projectId: "project-e1", organizationId: "org-e" }));

      await expect(tracedProjects.hasTraced({ organizationId: "org-e" })).resolves.toBe(true);
      await expect(tracedProjects.hasTraced({ organizationId: "org-d" })).resolves.toBe(false);
      await expect(sinkRequests()).resolves.toEqual(NO_REQUESTS);
    });
  });

  describe("when trace records a project traced with no organization", () => {
    /** @scenario "A traced fact with no organization writes no row" */
    it("writes no row and logs one line naming the project", async () => {
      const { tracedProjects, deliverFact, sinkRequests, logLines } = nurturingOverCopies();

      await deliverFact(projectTraced({ projectId: "project-o1", organizationId: null }));

      expect(tracedProjects.storedRows()).toEqual([]);
      expect(logLines.map((line) => line.projectId)).toEqual(["project-o1"]);
      await expect(sinkRequests()).resolves.toEqual(NO_REQUESTS);
    });
  });

  describe("when project lists projects that already received their first message", () => {
    /** @scenario "Project's listed first messages fill the traced rows, and a live row stays as it was" */
    it("records each listed organization as traced, once, calling neither sink", async () => {
      const { tracedProjects, deliverFact, sinkRequests } = nurturingOverCopies();
      await deliverFact(projectTraced({ projectId: "project-fl", organizationId: "org-l" }));

      await deliverFact(firstMessageListed({ projectId: "project-fl", organizationId: "org-l" }));
      await deliverFact(firstMessageListed({ projectId: "project-fa", organizationId: "org-a" }));

      expect(tracedProjects.storedRows()).toEqual([
        { projectId: "project-fl", organizationId: "org-l" },
        { projectId: "project-fa", organizationId: "org-a" },
      ]);
      await expect(tracedProjects.hasTraced({ organizationId: "org-a" })).resolves.toBe(true);
      await expect(sinkRequests()).resolves.toEqual(NO_REQUESTS);
    });
  });
});

describe("nurturing's rows naming an erased account", () => {
  /** Owner rows for user-1 in two organizations and one for user-2; user-1 and user-2 as admins. */
  async function nurturingHoldingTwoAccounts() {
    const nurturing = nurturingOverCopies();
    const { personalProjects, organizations } = nurturing;
    await personalProjects.recordOwner({
      projectId: "project-u1a",
      organizationId: "org-1",
      ownerUserId: "user-1",
    });
    await personalProjects.recordOwner({
      projectId: "project-u1b",
      organizationId: "org-2",
      ownerUserId: "user-1",
    });
    await personalProjects.recordOwner({
      projectId: "project-u2",
      organizationId: "org-1",
      ownerUserId: "user-2",
    });
    await organizations.recordOrganization({
      organizationId: "org-1",
      adminUserId: "user-1",
      seeded: false,
    });
    await organizations.recordOrganization({
      organizationId: "org-2",
      adminUserId: "user-2",
      seeded: false,
    });
    return nurturing;
  }

  const adminOf = async (
    organizations: MemoryNurturingMilestonesRepository,
    organizationId: string,
  ) => (await organizations.findOrganization({ organizationId })).map((row) => row.adminUserId);

  describe("when user records an account erased, delivered twice", () => {
    /** @scenario "An erased account's owner and admin rows are cleared, and nothing is sent" */
    it("deletes its owner rows in every organization, clears it as admin and calls neither sink", async () => {
      const { personalProjects, organizations, deliverFact, sinkRequests } =
        await nurturingHoldingTwoAccounts();

      await deliverFact(userErased({ userId: "user-1" }));
      await deliverFact(userErased({ userId: "user-1" }));

      expect(personalProjects.storedRows()).toEqual([
        { projectId: "project-u2", organizationId: "org-1", ownerUserId: "user-2" },
      ]);
      await expect(adminOf(organizations, "org-1")).resolves.toEqual([null]);
      await expect(adminOf(organizations, "org-2")).resolves.toEqual(["user-2"]);
      await expect(sinkRequests()).resolves.toEqual(NO_REQUESTS);
    });
  });

  describe("when user records an account erased that nurturing's member copy holds", () => {
    /** @scenario "An erased account leaves nurturing's member copy" */
    it("deletes its memberships in every organization and keeps the others'", async () => {
      const { members, deliverFact, sinkRequests } = nurturingOverCopies();
      const join = (organizationId: string, userId: string) =>
        members.recordMembershipChange({ organizationId, userId, change: "joined", at: 1_000 });
      await join("org-1", "user-1");
      await join("org-2", "user-1");
      await join("org-1", "user-2");

      await deliverFact(userErased({ userId: "user-1" }));
      await deliverFact(userErased({ userId: "user-1" }));

      const userIdsOf = async (organizationId: string) =>
        (await members.findMembershipsOfMembers({ organizationId })).map(({ userId }) => userId);
      await expect(userIdsOf("org-1")).resolves.toEqual(["user-2"]);
      await expect(userIdsOf("org-2")).resolves.toEqual([]);
      await expect(sinkRequests()).resolves.toEqual(NO_REQUESTS);
    });
  });

  describe("when user records erased an account no nurturing row names", () => {
    /** @scenario "An erasure of an account nurturing holds no row for changes nothing" */
    it("leaves every row as it was and calls neither sink", async () => {
      const { personalProjects, organizations, deliverFact, sinkRequests } =
        await nurturingHoldingTwoAccounts();

      await deliverFact(userErased({ userId: "user-9" }));

      expect(personalProjects.storedRows().map(({ projectId }) => projectId)).toEqual([
        "project-u1a",
        "project-u1b",
        "project-u2",
      ]);
      await expect(adminOf(organizations, "org-1")).resolves.toEqual(["user-1"]);
      await expect(adminOf(organizations, "org-2")).resolves.toEqual(["user-2"]);
      await expect(sinkRequests()).resolves.toEqual(NO_REQUESTS);
    });
  });
});
