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
import { Temporal } from "@langwatch/time";
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
  const ORG = `org-${ns}`;
  let ids = 0;
  const newId = () => `${ns}-${++ids}`;

  const prisma = () => {
    if (!connection) throw new Error("no test database");
    return connection.client;
  };
  const repository = () => PrismaAgentRegistryRepository.create(prisma());

  const reconcile = (drafts: RegistryDraft[], at: string) =>
    repository().applyChanges({
      organizationId: ORG,
      plan: (stored) =>
        planRegistryChanges({ stored, drafts, now: Temporal.Instant.from(at), newId }),
    });

  afterAll(async () => {
    await prisma().agentRegistryEvent.deleteMany({ where: { organizationId: ORG } });
    await prisma().agentRegistryEntry.deleteMany({ where: { organizationId: ORG } });
  });

  describe("given reconciles that register, version and remove agents", () => {
    it("stores entries and appends ordered events under the tenant guard", async () => {
      await reconcile([draft("alpha"), draft("beta")], "2026-11-10T00:00:00Z");
      await reconcile(
        [{ ...draft("alpha"), model: { provider: "openai", model: "gpt-5-mini", parameters: {} } }],
        "2026-11-11T00:00:00Z",
      );

      const entries = await repository().findEntries({ organizationId: ORG, limit: 100 });
      expect(entries.map((entry) => [entry.name, entry.status, entry.version])).toEqual([
        ["beta", "removed", 2],
        ["alpha", "active", 2],
      ]);

      const events = await repository().findEventsAfter({ organizationId: ORG, limit: 10 });
      expect(events.map((event) => event.type)).toEqual([
        "governance.agent.registered",
        "governance.agent.registered",
        "governance.agent.versioned",
        "governance.agent.removed",
      ]);
      const after = await repository().findEventsAfter({
        organizationId: ORG,
        after: BigInt(events[1]?.sequence ?? "0"),
        limit: 10,
      });
      expect(after.map((event) => event.type)).toEqual([
        "governance.agent.versioned",
        "governance.agent.removed",
      ]);
    });

    it("pages entries by keyset and filters by last change", async () => {
      const first = await repository().listEntries({ organizationId: ORG, limit: 1 });
      expect(first.hasMore).toBe(true);
      const last = first.entries[0];
      const second = await repository().listEntries({
        organizationId: ORG,
        limit: 1,
        ...(last ? { after: { updatedAt: last.updated_at, id: last.id } } : {}),
      });
      expect([...first.entries, ...second.entries].map((entry) => entry.name).toSorted()).toEqual([
        "alpha",
        "beta",
      ]);

      const recent = await repository().listEntries({
        organizationId: ORG,
        limit: 10,
        updatedSince: Temporal.Instant.from("2026-11-10T12:00:00Z"),
      });
      expect(recent.entries.map((entry) => entry.version)).toEqual([2, 2]);
    });

    it("lists undelivered events until their fan-out is marked", async () => {
      const pending = await repository().findUndeliveredEvents({ organizationId: ORG, limit: 10 });
      expect(pending).toHaveLength(4);

      await repository().markDeliveryRecorded({
        organizationId: ORG,
        eventIds: pending.map((event) => event.id),
        at: Temporal.Instant.from("2026-11-11T00:00:01Z"),
      });

      await expect(
        repository().findUndeliveredEvents({ organizationId: ORG, limit: 10 }),
      ).resolves.toEqual([]);
      const organizations = await repository().findOrganizationIds({
        after: `org-${ns.slice(0, -1)}`,
        limit: 1000,
      });
      expect(organizations).toContain(ORG);
    });
  });

  describe("given more active entries than the ARD read takes", () => {
    /** @scenario The ARD manifest past its cap lists the agents changed most recently */
    it("answers the most recently changed active entries", async () => {
      await reconcile([draft("alpha"), draft("gamma")], "2026-11-12T00:00:00Z");
      await reconcile(
        [draft("alpha"), { ...draft("gamma"), description: "changed" }],
        "2026-11-13T00:00:00Z",
      );

      const entries = await repository().findEntries({
        organizationId: ORG,
        status: "active",
        limit: 1,
      });

      expect(entries.map((entry) => entry.name)).toEqual(["gamma"]);
    });
  });
});
