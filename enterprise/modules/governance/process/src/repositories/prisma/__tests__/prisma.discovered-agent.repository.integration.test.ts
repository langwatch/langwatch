// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 * Per-source presence of discovered agents against Postgres.
 * Spec: enterprise/modules/governance/specs/cloud-agent-discovery.feature
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { type Instant, Temporal } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import { createGovernanceTestConnection } from "../../../app/__tests__/governance-database.fixture.ts";
import { PrismaDiscoveredAgentRepository } from "../prisma.discovered-agent.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl ? createGovernanceTestConnection(databaseUrl) : null;
const prisma = connection?.client as PrismaClient;

const T1 = Temporal.Instant.from("2026-11-16T10:00:00.000Z");
const T2 = Temporal.Instant.from("2026-11-16T11:00:00.000Z");
const T3 = Temporal.Instant.from("2026-11-16T12:00:00.000Z");

describe.skipIf(!databaseUrl)("PrismaDiscoveredAgentRepository presence", () => {
  const organizationId = `org-presence-${nanoid(8)}`;
  const repository = () => PrismaDiscoveredAgentRepository.create(prisma);
  const sight = ({ name, source, at }: { name: string; source?: string; at: Instant }) =>
    repository().recordAgentSighting({
      organizationId,
      provider: "aws_bedrock_agents",
      rawAgentId: `arn:aws:bedrock:eu-west-1:111122223333:agent/${name}`,
      displayText: name,
      metadata: { platform: "aws_bedrock" },
      seenAt: at,
      ...(source === undefined ? {} : { ingestionSourceId: source }),
    });
  const listed = async () =>
    (await repository().findForRegistry({ organizationId }))
      .map((row) => row.displayText)
      .toSorted();

  afterAll(async () => {
    await prisma.discoveredAgentListing.deleteMany({ where: { organizationId } });
    await prisma.discoveredAgent.deleteMany({ where: { organizationId } });
  });

  it("keeps an agent while any source lists it, and drops it once every source stopped", async () => {
    await sight({ name: "shared", source: "source-a", at: T1 });
    await sight({ name: "only-a", source: "source-a", at: T1 });
    await sight({ name: "shared", source: "source-b", at: T2 });
    await sight({ name: "older-sighting", at: T1 });

    await repository().markUnlistedGone({
      organizationId,
      ingestionSourceId: "source-a",
      listedAt: T3,
    });
    expect(await listed()).toEqual(["older-sighting", "shared"]);

    await repository().markUnlistedGone({
      organizationId,
      ingestionSourceId: "source-b",
      listedAt: T3,
    });
    expect(await listed()).toEqual(["older-sighting"]);

    await sight({ name: "shared", source: "source-a", at: T3.add({ hours: 1 }) });
    expect(await listed()).toEqual(["older-sighting", "shared"]);
  });

  it("keeps a disappearance when an older sighting arrives late, and clears it on a newer one", async () => {
    await sight({ name: "late", source: "source-c", at: T1 });
    await repository().markUnlistedGone({
      organizationId,
      ingestionSourceId: "source-c",
      listedAt: T3,
    });

    await sight({ name: "late", source: "source-c", at: T2 });
    expect(await listed()).not.toContain("late");

    await sight({ name: "late", source: "source-c", at: T3.add({ hours: 2 }) });
    expect(await listed()).toContain("late");
  });
});
