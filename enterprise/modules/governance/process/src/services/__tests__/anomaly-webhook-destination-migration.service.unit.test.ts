// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Spec: specs/ai-gateway/governance/anomaly-rules.feature
 */
import type { CreateWebhookEndpointCommand } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

import { MemoryAnomalyRuleRepository } from "../../repositories/memory/memory.anomaly-rule.repository.ts";
import { MemoryGovernanceStore } from "../../repositories/memory/memory.governance.store.ts";
import { AnomalyWebhookDestinationMigrationService } from "../anomaly-webhook-destination-migration.service.ts";

const ALERT = "governance.anomaly_alert.triggered";
const ORGANIZATIONS = ["org_a", "org_b"];

async function harness() {
  const rules = MemoryAnomalyRuleRepository.create(MemoryGovernanceStore.create());
  const created: CreateWebhookEndpointCommand[] = [];
  const seed = (organizationId: string, destinations: Record<string, string>[]) =>
    rules.create({
      organizationId,
      scope: "organization",
      scopeId: organizationId,
      name: "Spend spike",
      description: null,
      severity: "warning",
      ruleType: "spend_spike",
      thresholdConfig: {},
      destinationConfig: { destinations },
      status: "active",
      createdById: null,
    });
  await seed("org_a", [
    { type: "webhook", url: "https://a.example.test/hook", sharedSecret: "rule-secret" },
    { type: "webhook_endpoint", endpointId: "whep_existing" },
  ]);
  await seed("org_b", [{ type: "webhook", url: "https://b.example.test/hook" }]);
  const migration = AnomalyWebhookDestinationMigrationService.create({
    rules,
    organizationIds: async ({ after }) => {
      const ids = ORGANIZATIONS.filter((id) => after === undefined || id > after);
      return { ids: ids.slice(0, 1), next: ids.length > 1 ? (ids[0] ?? null) : null };
    },
    createEndpoint: async (command) => {
      created.push(command);
      return { endpoint: { id: `whep_${created.length}` } };
    },
    alertEventType: ALERT,
  });
  const destinationsOf = async (organizationId: string) =>
    (await rules.findAll(organizationId))[0]?.destinationConfig;
  return { created, migration, destinationsOf };
}

describe("AnomalyWebhookDestinationMigrationService", () => {
  describe("given rules with inline webhook destinations in two organisations", () => {
    /** @scenario "The destination migration run twice creates each endpoint once" */
    it("creates one legacy-scheme endpoint per inline destination and rewrites the rules once", async () => {
      const { created, migration, destinationsOf } = await harness();

      const first = await migration.migrate();
      const second = await migration.migrate();

      expect(first).toMatchObject({ organizations: 2, rules: 2, endpoints: 2 });
      expect(second).toMatchObject({ organizations: 2, rules: 0, endpoints: 0 });
      expect(created).toEqual([
        {
          organizationId: "org_a",
          destinationKind: "http",
          url: "https://a.example.test/hook",
          enabledEvents: [ALERT],
          signatureScheme: "legacy_sha256",
          sharedSecret: "rule-secret",
        },
        {
          organizationId: "org_b",
          destinationKind: "http",
          url: "https://b.example.test/hook",
          enabledEvents: [ALERT],
          signatureScheme: "legacy_sha256",
        },
      ]);
      expect(await destinationsOf("org_a")).toEqual({
        destinations: [
          { type: "webhook_endpoint", endpointId: "whep_1" },
          { type: "webhook_endpoint", endpointId: "whep_existing" },
        ],
      });
    });

    /** @scenario "A dry run of the destination migration counts and changes nothing" */
    it("reports the counts and creates or rewrites nothing on a dry run", async () => {
      const { created, migration, destinationsOf } = await harness();

      const report = await migration.migrate({ dryRun: true });

      expect(report).toMatchObject({ organizations: 2, rules: 2, endpoints: 2 });
      expect(created).toEqual([]);
      expect(await destinationsOf("org_b")).toEqual({
        destinations: [{ type: "webhook", url: "https://b.example.test/hook" }],
      });
    });

    /** @scenario "The destination migration resumes after its checkpoint" */
    it("starts after the saved organisation and saves each completed page", async () => {
      const { created, migration, destinationsOf } = await harness();
      const saves: { afterOrganizationId: string }[] = [];

      const report = await migration.migrate({
        after: "org_a",
        onPage: async (page) => {
          saves.push(page);
        },
      });

      expect(report).toMatchObject({ afterOrganizationId: "org_b", organizations: 1, rules: 1 });
      expect(saves).toEqual([{ afterOrganizationId: "org_b" }]);
      expect(created.map((command) => command.organizationId)).toEqual(["org_b"]);
      expect(await destinationsOf("org_a")).toMatchObject({
        destinations: [{ type: "webhook" }, { type: "webhook_endpoint" }],
      });
    });
  });
});
