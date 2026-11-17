// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/agent-registry.feature
 */
import type {
  AgentStopView,
  AgentStopWebhookEventType,
} from "@langwatch/enterprise-governance-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type { WebhookApi, WebhookEndpointView } from "@langwatch/webhook-contract";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import type { AgentRegistryDeliveryIntent } from "../../../features/registry/eventing/agent-registry-delivery.process.ts";
import type { RegistryDraft } from "../../../features/registry/rules/registry-entry.rules.ts";
import { planRegistryChanges } from "../../../features/registry/rules/registry-reconcile.rules.ts";
import { AgentRegistryService } from "../../../features/registry/services/agent-registry.service.ts";
import { MemoryGovernanceRepositories } from "../../memory/memory.governance.repositories.ts";
import { PrismaAgentRegistryRepository } from "../prisma.agent-registry.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const connection = DB_URL
  ? PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:governance:test:agent-registry"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL, log: ["error"] }))
  : undefined;

function draft(name: string): RegistryDraft {
  return {
    sourceKey: `langwatch:${name}`,
    source: "langwatch",
    management: "managed",
    shadow: false,
    kind: "connected",
    name,
    description: null,
    source_version: null,
    project_id: "project-1",
    environment: null,
    owner: null,
    endpoints: [],
    model: { provider: "openai", model: "gpt-5", parameters: {} },
    instructions: null,
    capabilities: ["connected"],
    tools: [],
    firstSeenAt: Temporal.Instant.from("2026-11-01T00:00:00Z"),
    lastSeenAt: null,
  };
}

function stopView({ agentId, status }: { agentId: string; status: AgentStopView["status"] }) {
  return {
    id: "agentstop-1",
    agentId,
    agentName: "alpha",
    status,
    severity: "high",
    approval: "required",
    trigger: "user",
    reason: "leaking prices",
    requestedBy: { userId: "user-ops", apiKeyId: null },
    decidedByUserId: null,
    restoredByUserId: null,
    targets: [],
    requestedAt: "2026-11-12T00:00:00.000Z",
    decidedAt: null,
    quarantinedAt: null,
    restoreRequestedAt: null,
    restoredAt: null,
  } satisfies AgentStopView;
}

function governanceEndpoint(organizationId: string): WebhookEndpointView {
  return {
    id: "hook-governance",
    organizationId,
    destinationKind: "http",
    url: "https://hooks.acme.test/governance",
    sqs: null,
    enabledEvents: ["governance.agent.*"],
    status: "ACTIVE",
    disabledReason: null,
    disabledAt: null,
    failingSince: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    maxBatchSize: 1,
    maxBatchDelayMs: 0,
    maxInFlight: 1,
    allowSelfSignedCertificate: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe.skipIf(!connection)("PrismaAgentRegistryRepository", () => {
  const ns = `agent-registry-${nanoid(8)}`;
  const organizations: string[] = [];
  let ids = 0;
  const newId = () => `${ns}-${++ids}`;
  /** A fresh organisation per test, so each test runs alone as well as in the file. */
  const newOrganization = () => {
    const organizationId = `org-${ns}-${organizations.length}`;
    organizations.push(organizationId);
    return organizationId;
  };

  const prisma = () => {
    if (!connection) throw new Error("no test database");
    return connection.client;
  };
  const repository = () => PrismaAgentRegistryRepository.create(prisma());

  const reconcile = ({
    organizationId,
    drafts,
    at,
  }: {
    organizationId: string;
    drafts: RegistryDraft[];
    at: string;
  }) =>
    repository().applyChanges({
      organizationId,
      plan: (stored) =>
        planRegistryChanges({ stored, drafts, now: Temporal.Instant.from(at), newId }),
      baselineAt: Temporal.Instant.from(at),
    });

  /** alpha and beta registered on the 10th; alpha versioned and beta removed on the 11th. */
  const seeded = async () => {
    const organizationId = newOrganization();
    await reconcile({
      organizationId,
      drafts: [draft("alpha"), draft("beta")],
      at: "2026-11-10T00:00:00Z",
    });
    await reconcile({
      organizationId,
      drafts: [
        { ...draft("alpha"), model: { provider: "openai", model: "gpt-5-mini", parameters: {} } },
      ],
      at: "2026-11-11T00:00:00Z",
    });
    return organizationId;
  };

  afterAll(async () => {
    const organizationId = { in: organizations };
    await prisma().agentRegistryEvent.deleteMany({ where: { organizationId } });
    await prisma().agentRegistryEntry.deleteMany({ where: { organizationId } });
    await prisma().agentRegistryBaseline.deleteMany({ where: { organizationId } });
  });

  describe("given reconciles that register, version and remove agents", () => {
    it("stores entries and appends ordered events under the tenant guard", async () => {
      const organizationId = await seeded();

      const entries = await repository().findEntries({ organizationId, limit: 100 });
      expect(entries.map((entry) => [entry.name, entry.status, entry.version])).toEqual([
        ["beta", "removed", 2],
        ["alpha", "active", 2],
      ]);

      const events = await repository().findEventsAfter({ organizationId, limit: 10 });
      expect(events.map((event) => event.type)).toEqual([
        "governance.agent.registered",
        "governance.agent.registered",
        "governance.agent.versioned",
        "governance.agent.removed",
      ]);
      const after = await repository().findEventsAfter({
        organizationId,
        after: BigInt(events[1]?.sequence ?? "0"),
        limit: 10,
      });
      expect(after.map((event) => event.type)).toEqual([
        "governance.agent.versioned",
        "governance.agent.removed",
      ]);
    });

    it("pages entries by keyset and filters by last change", async () => {
      const organizationId = await seeded();

      const first = await repository().listEntries({ organizationId, limit: 1 });
      expect(first.hasMore).toBe(true);
      const last = first.entries[0];
      const second = await repository().listEntries({
        organizationId,
        limit: 1,
        ...(last ? { after: { updatedAt: last.updated_at, id: last.id } } : {}),
      });
      expect([...first.entries, ...second.entries].map((entry) => entry.name).toSorted()).toEqual([
        "alpha",
        "beta",
      ]);

      const recent = await repository().listEntries({
        organizationId,
        limit: 10,
        updatedSince: Temporal.Instant.from("2026-11-10T12:00:00Z"),
      });
      expect(recent.entries.map((entry) => entry.version)).toEqual([2, 2]);
    });

    /** @scenario An entry another release wrote with a source this release does not know is left out of every list */
    it("leaves an entry with an unknown source out of every list and pages past it", async () => {
      const organizationId = await seeded();
      const [alpha] = (await repository().findEntries({ organizationId, limit: 100 })).filter(
        (entry) => entry.name === "alpha",
      );
      if (!alpha) throw new Error("alpha not seeded");
      await prisma().agentRegistryEntry.updateMany({
        where: { organizationId, id: alpha.id },
        data: { entry: JSON.parse(JSON.stringify({ ...alpha, source: "a_newer_release_source" })) },
      });

      const listed = await repository().findEntries({ organizationId, limit: 100 });
      expect(listed.map((entry) => entry.name)).toEqual(["beta"]);

      const names: string[] = [];
      let page = await repository().listEntries({ organizationId, limit: 1 });
      for (let reads = 1; ; reads++) {
        names.push(...page.entries.map((entry) => entry.name));
        if (!page.hasMore || !page.last || reads > 3) break;
        page = await repository().listEntries({ organizationId, limit: 1, after: page.last });
      }
      expect(names).toEqual(["beta"]);
      expect(page.hasMore).toBe(false);
    });

    it("lists undelivered events after the baseline until their fan-out is marked", async () => {
      const organizationId = await seeded();

      const pending = await repository().findUndeliveredEvents({ organizationId, limit: 10 });
      expect(pending.map((event) => event.type)).toEqual([
        "governance.agent.versioned",
        "governance.agent.removed",
      ]);

      await repository().markDeliveryRecorded({
        organizationId,
        eventIds: pending.map((event) => event.id),
        at: Temporal.Instant.from("2026-11-11T00:00:01Z"),
      });

      await expect(
        repository().findUndeliveredEvents({ organizationId, limit: 10 }),
      ).resolves.toEqual([]);
      const held = await repository().findOrganizationIds({
        after: `org-${ns.slice(0, -1)}`,
        limit: 1000,
      });
      expect(held).toContain(organizationId);
    });
  });

  describe("given an organisation's first reconcile", () => {
    /** @scenario An organisation's baseline and its first events are written as pushed in one commit */
    it("writes the baseline and leaves no undelivered event", async () => {
      const organizationId = newOrganization();

      const appended = await reconcile({
        organizationId,
        drafts: [draft("alpha")],
        at: "2026-11-10T00:00:00Z",
      });

      expect(appended.map((event) => event.type)).toEqual(["governance.agent.registered"]);
      await expect(
        repository().findUndeliveredEvents({ organizationId, limit: 10 }),
      ).resolves.toEqual([]);
      await expect(
        prisma().agentRegistryBaseline.findUnique({ where: { organizationId } }),
      ).resolves.toMatchObject({ baselinedAt: new Date("2026-11-10T00:00:00Z") });
    });

    it("writes the baseline even when nothing changed", async () => {
      const organizationId = newOrganization();

      await reconcile({ organizationId, drafts: [], at: "2026-11-10T00:00:00Z" });
      await reconcile({ organizationId, drafts: [draft("alpha")], at: "2026-11-11T00:00:00Z" });

      const pending = await repository().findUndeliveredEvents({ organizationId, limit: 10 });
      expect(pending.map((event) => event.type)).toEqual(["governance.agent.registered"]);
    });
  });

  describe("given more active entries than the ARD read takes", () => {
    /** @scenario The ARD manifest past its cap lists the agents changed most recently */
    it("answers the most recently changed active entries", async () => {
      const organizationId = newOrganization();
      await reconcile({
        organizationId,
        drafts: [draft("alpha"), draft("gamma")],
        at: "2026-11-12T00:00:00Z",
      });
      await reconcile({
        organizationId,
        drafts: [draft("alpha"), { ...draft("gamma"), description: "changed" }],
        at: "2026-11-13T00:00:00Z",
      });

      const entries = await repository().findEntries({
        organizationId,
        status: "active",
        limit: 1,
      });

      expect(entries.map((entry) => entry.name)).toEqual(["gamma"]);
    });
  });

  describe("given a kill switch milestone appended twice at once with one event id", () => {
    /** @scenario "A kill switch milestone is appended to the registry feed once however often it is announced" */
    it("stores one event carrying the stop and answers both calls with it", async () => {
      const organizationId = await seeded();
      const [alpha] = await repository().findEntries({
        organizationId,
        status: "active",
        limit: 1,
      });
      if (!alpha) throw new Error("no seeded entry");
      const append = () =>
        repository().appendStopEvent({
          organizationId,
          event: {
            id: `${ns}-stop-requested`,
            type: "governance.agent.stop_requested",
            entryId: alpha.id,
            occurredAt: Temporal.Instant.from("2026-11-12T00:00:00Z"),
            stop: stopView({ agentId: alpha.id, status: "pending_approval" }),
          },
        });

      const [first, second] = await Promise.all([append(), append()]);

      expect(second).toEqual(first);
      const feed = await repository().findEventsAfter({ organizationId, limit: 10 });
      const stops = feed.filter((event) => event.type === "governance.agent.stop_requested");
      expect(stops).toHaveLength(1);
      expect(stops[0]?.stop).toMatchObject({ id: "agentstop-1", status: "pending_approval" });
      expect(Number(stops[0]?.sequence)).toBeGreaterThan(Number(feed[0]?.sequence));
    });
  });

  describe("given each kill switch milestone of one stop announced through the registry", () => {
    /** @scenario "Each kill switch milestone reaches the registry feed and each subscribed webhook once" */
    it("appends one feed event and records one webhook intent per milestone, once", async () => {
      const organizationId = await seeded();
      const [alpha] = await repository().findEntries({
        organizationId,
        status: "active",
        limit: 1,
      });
      if (!alpha) throw new Error("no seeded entry");
      const intents: AgentRegistryDeliveryIntent[] = [];
      const registry = AgentRegistryService.create({
        registry: repository(),
        discoveredAgents: MemoryGovernanceRepositories.create().discoveredAgents,
        agents: createApiFixture({}),
        projects: createApiFixture({}),
        organizations: createApiFixture({}),
        traces: createApiFixture({}),
        webhooks: createApiFixture<WebhookApi>({
          getAll: async () => [governanceEndpoint(organizationId)],
        }),
        entitlements: { hasEnterprisePlan: async () => true },
        outbox: () => ({
          record: async (batch) => {
            intents.push(...batch);
          },
        }),
        publicBaseUrl: "https://app.langwatch.test",
        logger: createTestLogger().logger,
        now: () => Temporal.Instant.from("2026-11-12T00:00:00Z"),
      });
      await registry.fanOutPending({ organizationId });
      intents.length = 0;
      const milestones: [AgentStopWebhookEventType, AgentStopView["status"]][] = [
        ["governance.agent.stop_requested", "pending_approval"],
        ["governance.agent.quarantined", "quarantined"],
        ["governance.agent.restored", "restored"],
      ];
      const announce = ([milestone, status]: [
        AgentStopWebhookEventType,
        AgentStopView["status"],
      ]) =>
        registry.announceStop({
          organizationId,
          eventId: `${ns}-${milestone}`,
          milestone,
          stop: stopView({ agentId: alpha.id, status }),
        });

      for (const milestone of milestones) await announce(milestone);
      for (const milestone of milestones) await announce(milestone);

      const feed = await repository().findEventsAfter({ organizationId, limit: 20 });
      expect(feed.filter((event) => event.stop).map((event) => event.type)).toEqual(
        milestones.map(([milestone]) => milestone),
      );
      expect(intents.map((intent) => [intent.endpointId, intent.eventType])).toEqual(
        milestones.map(([milestone]) => ["hook-governance", milestone]),
      );
      await expect(
        repository().findUndeliveredEvents({ organizationId, limit: 10 }),
      ).resolves.toEqual([]);
    });
  });
});
