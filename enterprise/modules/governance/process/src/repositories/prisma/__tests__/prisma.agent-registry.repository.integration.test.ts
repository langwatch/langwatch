// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see specs/agent-registry.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { Temporal, type Instant } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import type { RegistryDraft } from "../../../features/registry/rules/registry-entry.rules.ts";
import { planRegistryChanges } from "../../../features/registry/rules/registry-reconcile.rules.ts";
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
    deliveryRecordedAt,
  }: {
    organizationId: string;
    drafts: RegistryDraft[];
    at: string;
    deliveryRecordedAt?: Instant;
  }) =>
    repository().applyChanges({
      organizationId,
      plan: (stored) =>
        planRegistryChanges({ stored, drafts, now: Temporal.Instant.from(at), newId }),
      ...(deliveryRecordedAt ? { deliveryRecordedAt } : {}),
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

    it("lists undelivered events until their fan-out is marked", async () => {
      const organizationId = await seeded();

      const pending = await repository().findUndeliveredEvents({ organizationId, limit: 10 });
      expect(pending).toHaveLength(4);

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

  describe("given a reconcile that writes its events as already pushed", () => {
    /** @scenario A seed's events are written as pushed in the same commit that appends them */
    it("appends them with no undelivered event left", async () => {
      const organizationId = newOrganization();

      const appended = await reconcile({
        organizationId,
        drafts: [draft("alpha")],
        at: "2026-11-10T00:00:00Z",
        deliveryRecordedAt: Temporal.Instant.from("2026-11-10T00:00:00Z"),
      });

      expect(appended.map((event) => event.type)).toEqual(["governance.agent.registered"]);
      await expect(
        repository().findUndeliveredEvents({ organizationId, limit: 10 }),
      ).resolves.toEqual([]);
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
});
