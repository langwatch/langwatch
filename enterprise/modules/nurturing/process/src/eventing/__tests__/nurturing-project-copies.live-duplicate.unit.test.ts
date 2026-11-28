// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The personal-project, traced-project and last-trace maps, fed one fact twice through the live
 * path (each lane's parse, then its store): the rows match a single delivery and no channel is told.
 * Spec: enterprise/modules/nurturing/specs/project-facts-copies.feature
 */
import type { ReplayEvent } from "@langwatch/eventing";
import { PERSONAL_TEAM_CREATED_EVENT_TYPE } from "@langwatch/organization-contract";
import { PROJECT_PERSONAL_OWNER_LISTED_EVENT_TYPE } from "@langwatch/project-contract";
import { PROJECT_TRACED_EVENT_TYPE, TRACE_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemoryPostHogChannel } from "../../channels/memory/memory.posthog.channel.ts";
import type { MemoryNurturingPersonalProjectRepository } from "../../repositories/memory/memory.nurturing-personal-project.repository.ts";
import type { MemoryNurturingTracedProjectRepository } from "../../repositories/memory/memory.nurturing-traced-project.repository.ts";
import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import {
  copiesOver,
  liveMapsOver,
  ownerFact,
} from "./nurturing-organization-copies.test-helpers.ts";
import { RecordingCustomerIoChannel } from "./recording-customer-io-channel.test-helpers.ts";

const OCCURRED_AT = 1_700_000_000_000;

const personalTeamCreated = (): ReplayEvent =>
  ownerFact({
    type: PERSONAL_TEAM_CREATED_EVENT_TYPE,
    aggregateType: "organization",
    aggregateId: "org-1",
    tenantId: "org-1",
    data: {
      tenantId: "org-1",
      organizationId: "org-1",
      userId: "user-1",
      teamId: "team-1",
      projectId: "project-p1",
      projectSlug: "project-p1",
      occurredAt: OCCURRED_AT,
    },
  });

const personalOwnerListed = (): ReplayEvent =>
  ownerFact({
    type: PROJECT_PERSONAL_OWNER_LISTED_EVENT_TYPE,
    aggregateType: "project",
    aggregateId: "project-p2",
    tenantId: "project-p2",
    data: {
      tenantId: "project-p2",
      projectId: "project-p2",
      organizationId: "org-1",
      ownerUserId: "user-2",
      occurredAt: OCCURRED_AT,
    },
  });

const projectTraced = (): ReplayEvent =>
  ownerFact({
    type: PROJECT_TRACED_EVENT_TYPE,
    aggregateType: "trace_project_milestone",
    aggregateId: "project-t1",
    tenantId: "project-t1",
    data: {
      tenantId: "project-t1",
      projectId: "project-t1",
      organizationId: "org-1",
      occurredAt: OCCURRED_AT,
    },
  });

const traceReceived = (): ReplayEvent =>
  ownerFact({
    type: TRACE_RECEIVED_EVENT_TYPE,
    aggregateType: "trace_project_milestone",
    aggregateId: "project-t1",
    tenantId: "project-t1",
    data: {
      tenantId: "project-t1",
      projectId: "project-t1",
      userId: "admin-1",
      organizationId: "org-1",
      occurredAt: OCCURRED_AT,
    },
  });

/**
 * The copies' rows and every request the channel fakes recorded, after the facts are delivered live
 * the given number of times each. The channels sit beside the copies: nothing in them is reachable.
 */
async function afterDelivering(fact: ReplayEvent, times: number) {
  const repositories = MemoryNurturingRepositories.create();
  const customerIo = new RecordingCustomerIoChannel();
  const posthog = MemoryPostHogChannel.create();
  const deliver = liveMapsOver(copiesOver(repositories));
  for (let delivery = 0; delivery < times; delivery++) await deliver(fact);
  return {
    personal: (
      repositories.personalProjects as MemoryNurturingPersonalProjectRepository
    ).storedRows(),
    traced: (repositories.tracedProjects as MemoryNurturingTracedProjectRepository).storedRows(),
    lastTraceAt: await repositories.milestones.findLastTraceAt({ organizationId: "org-1" }),
    channels: {
      customerIo: customerIo.requests,
      posthogTracked: posthog.tracked,
      posthogIdentified: posthog.identified,
    },
  };
}

describe("given a fact delivered live twice", () => {
  describe.each([
    ["organization's personal team fact", personalTeamCreated],
    ["project's personal owner listing", personalOwnerListed],
  ])("when it is %s", (_name, make) => {
    /** @scenario "A personal owner's facts delivered again or in reverse order leave the same row" */
    it("leaves the personal-project rows a single delivery leaves", async () => {
      const fact = make();

      const once = await afterDelivering(fact, 1);
      const twice = await afterDelivering(fact, 2);

      expect(twice.personal).toEqual(once.personal);
    });

    it("stores an owner row from the first delivery", async () => {
      expect((await afterDelivering(make(), 1)).personal).toHaveLength(1);
    });

    it("records nothing in the memory channels", async () => {
      expect((await afterDelivering(make(), 2)).channels).toEqual({
        customerIo: [],
        posthogTracked: [],
        posthogIdentified: [],
      });
    });
  });

  describe("when it is trace's project traced fact", () => {
    /** @scenario "A traced fact delivered again or in reverse order leaves the same rows" */
    it("leaves the traced-project rows a single delivery leaves", async () => {
      const fact = projectTraced();

      const once = await afterDelivering(fact, 1);
      const twice = await afterDelivering(fact, 2);

      expect(twice.traced).toEqual(once.traced);
    });

    it("stores a traced row from the first delivery", async () => {
      expect((await afterDelivering(projectTraced(), 1)).traced).toHaveLength(1);
    });

    it("records nothing in the memory channels", async () => {
      expect((await afterDelivering(projectTraced(), 2)).channels).toEqual({
        customerIo: [],
        posthogTracked: [],
        posthogIdentified: [],
      });
    });
  });

  describe("when it is trace's trace received fact", () => {
    it("leaves the organization's last trace time a single delivery leaves", async () => {
      const fact = traceReceived();

      const once = await afterDelivering(fact, 1);
      const twice = await afterDelivering(fact, 2);

      expect(twice.lastTraceAt).toBe(once.lastTraceAt);
    });

    it("stores the fact's time from the first delivery", async () => {
      expect((await afterDelivering(traceReceived(), 1)).lastTraceAt).toBe(OCCURRED_AT);
    });

    it("records nothing in the memory channels", async () => {
      expect((await afterDelivering(traceReceived(), 2)).channels).toEqual({
        customerIo: [],
        posthogTracked: [],
        posthogIdentified: [],
      });
    });
  });
});
