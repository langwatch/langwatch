/**
 * Every finished run tells nurturing, counted across the organization's
 * projects. @see modules/scenario/specs/simulation-run-finished-nurturing-signal.feature
 */
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId } from "@langwatch/eventing";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
  type SimulationRunFinishedEvent,
} from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { createSimulationRunFinishedNurturingSubscriber } from "../simulation-run-finished-nurturing.subscriber.ts";

function finished(
  data: Partial<SimulationRunFinishedEvent["data"]> = {},
): SimulationRunFinishedEvent {
  return {
    id: "event-1",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: createTenantId("project-1"),
    createdAt: 1_700_000_000_000,
    occurredAt: 1_700_000_000_000,
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    version: SIMULATION_EVENT_VERSIONS.FINISHED,
    data: { scenarioRunId: "run-1", ...data },
  };
}

const context = { tenantId: "project-1", aggregateId: "run-1", state: undefined };

function deps({
  userId = "admin-1",
  organizationId = "org-1",
  projectIds = ["project-1"],
  runCount = 6,
}: {
  userId?: string | null;
  organizationId?: string | null;
  projectIds?: string[];
  runCount?: number;
} = {}) {
  const recorded: NurturingSignal[] = [];
  return {
    recorded,
    resolveOrgAdmin: async () => ({
      userId,
      organizationId,
      firstMessage: true,
      onboardingVariant: null,
      organizationCreatedAt: null,
    }),
    listIdsByOrganization: async () => projectIds,
    countUsage: async () => runCount,
    build() {
      return createSimulationRunFinishedNurturingSubscriber({
        projects: {
          resolveOrgAdmin: this.resolveOrgAdmin,
          listIdsByOrganization: this.listIdsByOrganization,
        },
        simulations: { countUsage: this.countUsage },
        nurturing: {
          recordSignal: async (signal: NurturingSignal) => {
            recorded.push(signal);
          },
        },
      });
    },
  };
}

describe("the simulation-run-finished nurturing subscriber", () => {
  /** @scenario "A finished run tells nurturing the organization's run count so far" */
  it("tells nurturing the run against the admin, counted across the organization", async () => {
    const target = deps({ runCount: 6 });
    const subscriber = target.build();

    await subscriber.handler(finished(), context);

    expect(target.recorded).toEqual([
      {
        kind: "simulation_run_finished",
        sourceEventId: "event-1",
        tenantId: "project-1",
        occurredAt: 1_700_000_000_000,
        userId: "admin-1",
        projectId: "project-1",
        organizationRunCount: 6,
      },
    ]);
  });

  /** @scenario "A finished run in a project with no organization admin tells nurturing nothing" */
  it("tells nurturing nothing when no org admin resolves", async () => {
    const target = deps({ userId: null, organizationId: null });
    const subscriber = target.build();

    await subscriber.handler(finished(), context);

    expect(target.recorded).toEqual([]);
  });

  it("tells nurturing nothing when the organization has no admin", async () => {
    const target = deps({ organizationId: null });
    const subscriber = target.build();

    await subscriber.handler(finished(), context);

    expect(target.recorded).toEqual([]);
  });
});
