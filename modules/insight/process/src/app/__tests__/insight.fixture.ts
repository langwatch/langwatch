/**
 * Insight installed the way a process installs it, over the memory tier: the real module and
 * its real pipeline on an in-memory event store, so a write is folded before the next read.
 */

import { createTenantId, EventSourcing } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  type FileInsightInput,
  INSIGHT_AGGREGATE_TYPE,
  InsightApi,
} from "@langwatch/insight-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import { insightProcessModule } from "../../insight.module.ts";

export const PROJECT = "project-1";
export const OTHER_PROJECT = "project-2";

/** A filing with everything the form requires; a test overrides what it is about. */
export function filing(overrides: Partial<FileInsightInput> = {}): FileInsightInput {
  return {
    projectId: PROJECT,
    title: "Checkout errors doubled",
    body: "Checkout errors doubled overnight.",
    tone: "bad",
    validDays: 7,
    ...overrides,
  };
}

export async function installInsight({ isEnabled = true }: { isEnabled?: boolean } = {}) {
  const eventStore = EventStoreMemory.createForTesting();
  /** The projects the release gate was asked about: empty while no handler has run. */
  const gateAsks: string[] = [];
  const runtime = await createApp({ role: "worker" })
    .withModules([insightProcessModule])
    .withStores(memoryStores())
    .withEventing(new EventSourcing({ eventStore }))
    .provide({
      "feature-flag": createApiFixture<FeatureFlagApi>({ isEnabled: async () => isEnabled }),
      project: createApiFixture<ProjectApi>({
        getOrganizationId: async (projectId) => {
          gateAsks.push(projectId);
          return "organization-1";
        },
      }),
    })
    .boot();

  return {
    app: runtime.service(InsightApi),
    gateAsks,
    /** The types of the events one insight's stream holds, oldest first. */
    eventTypesOf: async ({ projectId, insightId }: { projectId: string; insightId: string }) => {
      const events = await eventStore.getEvents({
        aggregateId: insightId,
        aggregateType: INSIGHT_AGGREGATE_TYPE,
        context: { tenantId: createTenantId(projectId) },
      });
      return events.map((event) => event.type);
    },
    stop: () => runtime.stop(),
  };
}

export type InstalledInsight = Awaited<ReturnType<typeof installInsight>>;
