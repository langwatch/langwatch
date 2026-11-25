// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The Security Lake written count against a real ClickHouse: an event written again sits as a
 * second row until a merge, so only the query can prove it counts once.
 *
 * Spec: enterprise/modules/governance/specs/security-lake-ingest.feature
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { Temporal } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OCSF_ACTIVITY, OCSF_SEVERITY } from "../../../rules/ocsf-codes.rules.ts";
import type { GovernanceOcsfEvent } from "../../governance.repositories.ts";
import { ClickHouseOcsfEventsRepository } from "../clickhouse.ocsf-events.repository.ts";

const enabled = Boolean(
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL,
);

const run = nanoid(8);
const tenantId = `gov-lake-count-${run}`;

let client: ClickHouseClient;
let repository: ClickHouseOcsfEventsRepository;

function lakeEvent({
  eventId,
  sourceId,
  sourceType = "security_lake",
}: {
  eventId: string;
  sourceId: string;
  sourceType?: string;
}): GovernanceOcsfEvent {
  return {
    tenantId,
    eventId,
    traceId: "",
    sourceId,
    sourceType,
    activityId: OCSF_ACTIVITY.INVOKE,
    severityId: OCSF_SEVERITY.INFO,
    eventTime: Temporal.Instant.from("2026-11-16T09:00:00.000Z"),
    actorUserId: "",
    actorEmail: "",
    actorEnduserId: "",
    actionName: "InvokeModel",
    targetName: "anthropic.claude-sonnet",
    anomalyAlertId: "",
    rawOcsfJson: "{}",
  };
}

describe.skipIf(!enabled)("the Security Lake written count against a real ClickHouse", () => {
  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "governance-security-lake-count",
      names: ["count"],
      environment: process.env,
    });
    if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for the count suite");

    await migrateTestClickHouseOnce({
      url: endpoint.url,
      migrate: async () => {
        // CLICKHOUSE_CLUSTER switches every engine to a Replicated form no test server can run.
        const previousCluster = process.env.CLICKHOUSE_CLUSTER;
        delete process.env.CLICKHOUSE_CLUSTER;
        try {
          await ClickHouseMigrateTask.createFromConfig({
            config: { buildTime: false, sharedUrl: endpoint.url, privateEndpoints: [] },
          }).execute();
        } finally {
          if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
        }
      },
    });

    client = createClient({
      url: endpoint.url,
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
    repository = ClickHouseOcsfEventsRepository.create(async () => client);
    await client.command({ query: "SYSTEM STOP MERGES governance_ocsf_events" });
  }, 180_000);

  afterAll(async () => {
    if (!client) return;
    await client.command({ query: "SYSTEM START MERGES governance_ocsf_events" });
    await client.command({
      query: "ALTER TABLE governance_ocsf_events DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
    await client.close();
  }, 60_000);

  /** @scenario The written count counts each event once when a file is read again */
  it("counts an event written twice once, and only this source's Security Lake events", async () => {
    await repository.insertEvents([
      lakeEvent({ eventId: "e1", sourceId: "lake" }),
      lakeEvent({ eventId: "e2", sourceId: "lake" }),
    ]);
    await repository.insertEvents([
      lakeEvent({ eventId: "e1", sourceId: "lake" }),
      lakeEvent({ eventId: "e3", sourceId: "other-lake" }),
      lakeEvent({ eventId: "e4", sourceId: "lake", sourceType: "ocsf_push" }),
    ]);

    expect(await repository.countSecurityLakeEvents({ tenantId, sourceId: "lake" })).toBe(2);
  });
});
