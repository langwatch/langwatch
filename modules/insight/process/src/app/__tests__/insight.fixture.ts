/**
 * Insight installed the way a process installs it, over the memory tier: the real module and
 * its real pipeline on an in-memory event store, so a write is folded before the next read.
 */

import type { AnalyticsApi } from "@langwatch/analytics-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DashboardApi } from "@langwatch/dashboard-contract";
import { createTenantId, EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  type FileInsightInput,
  INSIGHT_AGGREGATE_TYPE,
  INSIGHT_PIPELINE_NAME,
  InsightApi,
  type InsightFiledEventData,
} from "@langwatch/insight-contract";
import { generate, KSUID_RESOURCES } from "@langwatch/ksuid";
import type { LangyApi } from "@langwatch/langy-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";

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

/** The peers a daily run asks. The inbox calls none, so each defaults to one that throws. */
export type InsightRunPeers = Readonly<{
  project?: Partial<ProjectApi>;
  user?: UserApi;
  authz?: AuthzApi;
  dashboard?: DashboardApi;
  langy?: LangyApi;
  analytics?: AnalyticsApi;
}>;

export async function installInsight({
  isEnabled = true,
  peers = {},
}: {
  /** A function is asked on every check, so a test can turn the flag off between two acts. */
  isEnabled?: boolean | (() => boolean);
  peers?: InsightRunPeers;
} = {}) {
  const eventStore = EventStoreMemory.createForTesting();
  const processStore = InMemoryProcessStore.createForTesting();
  const eventing = new EventSourcing({ eventStore, processStore });
  /** The projects the release gate was asked about: empty while no handler has run. */
  const gateAsks: string[] = [];
  const runtime = await createApp({ role: "worker" })
    .withModules([insightProcessModule])
    .withStores(memoryStores())
    .withEventing(eventing)
    .provide({
      "feature-flag": createApiFixture<FeatureFlagApi>({
        isEnabled: async () => (typeof isEnabled === "function" ? isEnabled() : isEnabled),
      }),
      project: createApiFixture<ProjectApi>({
        getOrganizationId: async (projectId) => {
          gateAsks.push(projectId);
          return "organization-1";
        },
        ...peers.project,
      }),
      user: peers.user ?? createApiFixture<UserApi>(),
      authz: peers.authz ?? createApiFixture<AuthzApi>(),
      dashboard: peers.dashboard ?? createApiFixture<DashboardApi>(),
      langy: peers.langy ?? createApiFixture<LangyApi>(),
      analytics: peers.analytics ?? createApiFixture<AnalyticsApi>(),
    })
    .boot();

  return {
    app: runtime.service(InsightApi),
    eventing,
    eventStore,
    processStore,
    gateAsks,
    /**
     * Files an insight the way the scheduled run will: through the pipeline's own command,
     * for a named owner and with no person who saved it. No door does this yet.
     */
    fileByRun: async ({ ownerUserId }: { ownerUserId: string }): Promise<string> => {
      const { fileInsight } = eventing.getPipeline(INSIGHT_PIPELINE_NAME).commands;
      if (!fileInsight) throw new Error("The insight pipeline registered no fileInsight command");
      const { projectId, ...filed } = filing();
      const data: InsightFiledEventData = {
        ...filed,
        insightId: generate(KSUID_RESOURCES.INSIGHT).toString(),
        topic: null,
        lwql: null,
        replay: null,
        source: null,
        board: null,
        filedVia: "run",
        ownerUserId,
        filedByUserId: null,
      };
      await fileInsight.send({
        tenantId: projectId,
        occurredAt: nowInstant().epochMilliseconds,
        ...data,
      });
      return data.insightId;
    },
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
