// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Spec: specs/ai-gateway/governance/anomaly-rules.feature
 */
import { fromDate, toDate } from "@langwatch/time";
import type { CreateWebhookEndpointCommand } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MemoryAnomalyRuleRepository } from "../../repositories/memory/memory.anomaly-rule.repository.ts";
import { MemoryGovernanceStore } from "../../repositories/memory/memory.governance.store.ts";
import { AnomalyWebhookDestinationMigrationService } from "../anomaly-webhook-destination-migration.service.ts";

const ALERT = "governance.anomaly_alert.triggered";
const ORGANIZATIONS = ["org_a", "org_b"];

/** The destination reader of a release older than the migration: inline webhooks only. */
const olderReleaseReader = z.object({
  destinations: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("webhook"),
        url: z.string().url(),
        sharedSecret: z.string().min(1).optional(),
      }),
    ]),
  ),
});

async function harness({
  beforeWrite,
  loseFirstReply = false,
}: { beforeWrite?: () => Promise<void>; loseFirstReply?: boolean } = {}) {
  const store = MemoryGovernanceStore.create();
  const rules = MemoryAnomalyRuleRepository.create(store);
  const created: CreateWebhookEndpointCommand[] = [];
  const archived: string[] = [];
  const byKey = new Map<string, string>();
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
    rules: {
      findAll: (organizationId) => rules.findAll(organizationId),
      findById: (id) => rules.findById(id),
      updateIfUnchanged: async (input) => {
        await beforeWrite?.();
        return rules.updateIfUnchanged(input);
      },
    },
    organizationIds: async ({ after }) => {
      const ids = ORGANIZATIONS.filter((id) => after === undefined || id > after);
      return { ids: ids.slice(0, 1), next: ids.length > 1 ? (ids[0] ?? null) : null };
    },
    createEndpoint: async (command) => {
      const existing = byKey.get(command.idempotencyKey ?? "");
      if (existing !== undefined) return { endpoint: { id: existing } };
      created.push(command);
      const id = `whep_${created.length}`;
      if (command.idempotencyKey !== undefined) byKey.set(command.idempotencyKey, id);
      if (loseFirstReply && created.length === 1) throw new Error("stopped after creation");
      return { endpoint: { id } };
    },
    archiveEndpoint: async ({ endpointId }) => {
      archived.push(endpointId);
    },
    alertEventType: ALERT,
  });
  const ruleOf = async (organizationId: string) => (await rules.findAll(organizationId))[0];
  const destinationsOf = async (organizationId: string) =>
    (await ruleOf(organizationId))?.destinationConfig;
  return { store, created, archived, migration, destinationsOf, ruleOf };
}

describe("AnomalyWebhookDestinationMigrationService", () => {
  describe("given rules with inline webhook destinations in two organisations", () => {
    /** @scenario "The destination migration run twice creates each endpoint once" */
    it("creates one legacy-scheme endpoint per inline destination and annotates the rules once", async () => {
      const { created, migration, destinationsOf, ruleOf } = await harness();
      const ruleA = (await ruleOf("org_a"))?.id;
      const ruleB = (await ruleOf("org_b"))?.id;

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
          idempotencyKey: `anomaly-rule:${ruleA}:0`,
        },
        {
          organizationId: "org_b",
          destinationKind: "http",
          url: "https://b.example.test/hook",
          enabledEvents: [ALERT],
          signatureScheme: "legacy_sha256",
          idempotencyKey: `anomaly-rule:${ruleB}:0`,
        },
      ]);
      expect(await destinationsOf("org_a")).toEqual({
        destinations: [
          {
            type: "webhook",
            url: "https://a.example.test/hook",
            sharedSecret: "rule-secret",
            endpointId: "whep_1",
          },
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

    /** @scenario "A rule edited while the destination migration runs keeps the edit" */
    it("keeps the edit and archives the endpoint made from the rule as it was read", async () => {
      let edited = false;
      const { store, created, archived, migration, destinationsOf } = await harness({
        beforeWrite: async () => {
          if (edited) return;
          edited = true;
          const index = store.anomalyRules.findIndex((rule) => rule.organizationId === "org_a");
          const rule = store.anomalyRules[index]!;
          store.anomalyRules[index] = {
            ...rule,
            destinationConfig: {
              destinations: [{ type: "webhook_endpoint", endpointId: "whep_chosen" }],
            },
            updatedAt: toDate(fromDate(rule.updatedAt).add({ milliseconds: 1 })),
          };
        },
      });

      await migration.migrate();

      expect(await destinationsOf("org_a")).toEqual({
        destinations: [{ type: "webhook_endpoint", endpointId: "whep_chosen" }],
      });
      expect(archived).toEqual(["whep_1"]);
      expect(created.map((command) => command.organizationId)).toEqual(["org_a", "org_b"]);
    });

    /** @scenario "A destination migration stopped between endpoint creation and the rule write makes no second endpoint" */
    it("reuses the endpoint when the rule write fails, so the retry makes no second one", async () => {
      let failed = false;
      const { created, archived, migration, destinationsOf } = await harness({
        beforeWrite: async () => {
          if (failed) return;
          failed = true;
          throw new Error("rule write failed");
        },
      });

      await expect(migration.migrate()).rejects.toThrow("rule write failed");
      await migration.migrate();

      expect(created.map((command) => command.organizationId)).toEqual(["org_a", "org_b"]);
      expect(archived).toEqual([]);
      expect(await destinationsOf("org_a")).toMatchObject({
        destinations: [
          { type: "webhook", endpointId: "whep_1" },
          { type: "webhook_endpoint", endpointId: "whep_existing" },
        ],
      });
    });

    /** @scenario "A destination migration stopped between endpoint creation and the rule write makes no second endpoint" */
    it("names the endpoint the stopped run created and creates no second one", async () => {
      const { created, archived, migration, destinationsOf } = await harness({
        loseFirstReply: true,
      });

      await expect(migration.migrate()).rejects.toThrow("stopped after creation");
      await migration.migrate();

      expect(created.map((command) => command.organizationId)).toEqual(["org_a", "org_b"]);
      expect(archived).toEqual([]);
      expect(await destinationsOf("org_a")).toMatchObject({
        destinations: [{ type: "webhook", endpointId: "whep_1" }, { type: "webhook_endpoint" }],
      });
    });

    /** @scenario "A release rolled back after the destination migration still delivers each rule's alerts" */
    it("old reader still finds the inline form", async () => {
      const { migration, destinationsOf } = await harness();

      await migration.migrate();

      expect(olderReleaseReader.parse(await destinationsOf("org_b"))).toEqual({
        destinations: [{ type: "webhook", url: "https://b.example.test/hook" }],
      });
    });
  });
});
