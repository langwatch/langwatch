/**
 * @vitest-environment node
 * log_processing declares each tenant's retention from data retention (ARCHITECTURE §9).
 * Spec: packages/eventing/specs/pipeline-retention.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { createApp } from "@langwatch/kernel";
import { LOG_PROCESSING_PIPELINE_NAME } from "@langwatch/log-contract";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { logServer } from "../../log.server.ts";

const RETAINED = { traces: 365, scenarios: 30, experiments: 30 };

describe("log app installation", () => {
  describe("when its pipeline registers", () => {
    /** @scenario "A module's pipeline declares each tenant's retention from data retention" */
    it("declares each tenant's retention as data retention resolves it", async () => {
      const eventing = new EventSourcing({
        enabled: false,
        processStore: InMemoryProcessStore.createForTesting(),
      });
      const runtime = await createApp({ role: "worker" })
        .withModules([logServer])
        .withAnalytical(createApiFixture<ClickHouseQueryClient>())
        .withConfig({ log: { processingShards: void 0 } })
        .withEventing(eventing)
        .provide({
          "data-privacy": createApiFixture<DataPrivacyApi>({}),
          trace: createApiFixture<TraceApi>({}),
          "data-retention": createApiFixture<DataRetentionApi>({
            getResolvedForProject: async () => RETAINED,
          }),
        })
        .boot();

      try {
        const pipeline = eventing.definitions.find(
          (definition) => definition.metadata.name === LOG_PROCESSING_PIPELINE_NAME,
        );

        await expect(
          pipeline?.open((definition) => definition.retentionPolicyResolver?.resolve("project-1")),
        ).resolves.toEqual(RETAINED);
      } finally {
        await runtime.stop();
      }
    });
  });
});
