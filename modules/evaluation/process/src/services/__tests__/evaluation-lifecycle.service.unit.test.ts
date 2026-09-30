/**
 * @vitest-environment node
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { EventingCommandSender } from "@langwatch/eventing";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import type {
  RecordEvaluationLifecycleCompletedCommandData,
  RecordEvaluationRanCommandData,
} from "../../eventing/evaluation-lifecycle.events.ts";
import { EvaluationLifecycleService } from "../evaluation-lifecycle.service.ts";

const run = {
  evaluationId: "eval-1",
  evaluatorType: "langevals/exact_match",
  score: 1,
  passed: true,
};

function recorder<Payload>(sent: Payload[]): EventingCommandSender<Payload> {
  return {
    send: async (payload) => {
      sent.push(payload);
    },
    sendBatch: async (payloads) => {
      sent.push(...payloads);
    },
    close: async () => {},
    waitUntilReady: async () => {},
  };
}

function serviceOver(input: { admin: string | null; counts: Record<string, number> }) {
  const completed: RecordEvaluationLifecycleCompletedCommandData[] = [];
  const counted: (readonly string[])[] = [];
  const service = EvaluationLifecycleService.create({
    projects: createApiFixture<ProjectApi>({
      resolveOrgAdmin: async () => ({
        userId: input.admin,
        organizationId: "org-1",
        firstMessage: false,
        onboardingVariant: null,
        organizationCreatedAt: null,
      }),
      listIdsByOrganization: async () => Object.keys(input.counts),
    }),
    runs: {
      countOrganizationRuns: async ({ tenantIds }) => {
        counted.push(tenantIds);
        return tenantIds.reduce((total, tenantId) => total + (input.counts[tenantId] ?? 0), 0);
      },
    },
  });
  service.connect({
    recordEvaluationRan: recorder<RecordEvaluationRanCommandData>([]),
    recordEvaluationLifecycleCompleted: recorder(completed),
  });
  return { service, completed, counted };
}

describe("EvaluationLifecycleService.completed", () => {
  it("records the settled evaluation against the admin with the organization's count", async () => {
    const { service, completed } = serviceOver({
      admin: "admin-1",
      counts: { "project-1": 2, "project-2": 3 },
    });

    await service.completed({
      projectId: "project-1",
      run,
      occurredAt: 1_700_000_000_000,
    });

    expect(completed).toEqual([
      {
        tenantId: "project-1",
        occurredAt: 1_700_000_000_000,
        userId: "admin-1",
        projectId: "project-1",
        organizationEvaluationCount: 5,
        ...run,
      },
    ]);
  });

  /** @scenario "An evaluation's organization count is read once, not once per project" */
  it("asks for the organization's count in one read naming every project", async () => {
    const { service, counted } = serviceOver({
      admin: "admin-1",
      counts: { "project-1": 2, "project-2": 3, "project-3": 0 },
    });

    await service.completed({ projectId: "project-1", run, occurredAt: 1 });

    expect(counted).toEqual([["project-1", "project-2", "project-3"]]);
  });

  it("records nothing for an organization with no admin", async () => {
    const { service, completed } = serviceOver({ admin: null, counts: { "project-1": 1 } });

    await service.completed({
      projectId: "project-1",
      run,
      occurredAt: 1,
    });

    expect(completed).toEqual([]);
  });
});
