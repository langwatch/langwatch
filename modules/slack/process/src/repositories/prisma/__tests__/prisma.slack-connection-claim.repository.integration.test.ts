/**
 * Slack connection claims against Postgres under the real tenancy guard: a
 * claim is idempotent on (connectionId, claimantId), a project releases only
 * its own claim, and reads stay inside one organization.
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaSlackConnectionClaimRepository } from "../prisma.slack-connection-claim.repository.ts";
import { PrismaSlackConnectionRepository } from "../prisma.slack-connection.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-slack-claims-${randomUUID()}`;
const organizationId = `${namespace}-organization`;
const otherOrganizationId = `${namespace}-other-organization`;
const projectId = `${namespace}-project`;
const otherProjectId = `${namespace}-other-project`;

describe.skipIf(!databaseUrl)("PrismaSlackConnectionClaimRepository", () => {
  let connection: PrismaConnection;
  let connections: PrismaSlackConnectionRepository;
  let claims: PrismaSlackConnectionClaimRepository;

  const clear = async () => {
    for (const each of [organizationId, otherOrganizationId]) {
      await connection.client.slackConnectionClaim.deleteMany({ where: { organizationId: each } });
      await connection.client.slackIntegration.deleteMany({ where: { organizationId: each } });
    }
  };

  /** An organization connection, so claims from either project may hold it. */
  const stored = async ({ organization = organizationId }: { organization?: string } = {}) => {
    const [row] = await connections.create({
      record: {
        name: `Connection ${randomUUID()}`,
        kind: "INCOMING_WEBHOOK",
        scopeType: "ORGANIZATION",
        scopeId: organization,
        organizationId: organization,
        botTokenEncrypted: null,
        webhookUrlEncrypted: "iv:ciphertext:tag",
        secretFingerprint: `fp-${randomUUID()}`,
        secretHint: "abcd",
        slackTeamId: null,
        slackTeamName: null,
      },
      actorId: "user-1",
    });
    if (!row) throw new Error("the connection was not stored");
    return row;
  };

  const claim = ({
    connectionId,
    claimantId,
    label = "Errors to ops",
    project = projectId,
    organization = organizationId,
  }: {
    connectionId: string;
    claimantId: string;
    label?: string;
    project?: string;
    organization?: string;
  }) =>
    claims.upsert({
      connectionId,
      claimantId,
      claimantLabel: label,
      organizationId: organization,
      projectId: project,
    });

  beforeAll(() => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:slack:test:claims"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    connections = PrismaSlackConnectionRepository.create(connection.client);
    claims = PrismaSlackConnectionClaimRepository.create(connection.client);
  });

  beforeEach(clear);

  afterAll(async () => {
    if (!connection) return;
    await clear();
    await connection.closeOnce();
  });

  describe("given an automation claiming a connection twice", () => {
    /** @scenario "Saving an automation on a connection claims it" */
    it("holds one claim carrying the latest label", async () => {
      const { id } = await stored();

      await claim({ connectionId: id, claimantId: "trigger-1", label: "Old name" });
      await claim({ connectionId: id, claimantId: "trigger-1", label: "Errors to ops" });

      await expect(claims.findByConnections({ organizationId, ids: [id] })).resolves.toEqual([
        {
          connectionId: id,
          claimantId: "trigger-1",
          claimantLabel: "Errors to ops",
          organizationId,
          projectId,
        },
      ]);
    });
  });

  describe("given claims from two projects", () => {
    it("leaves out the excepted project's claims, as the narrowing count needs", async () => {
      const { id } = await stored();
      await claim({ connectionId: id, claimantId: "trigger-here" });
      await claim({ connectionId: id, claimantId: "trigger-there", project: otherProjectId });

      const outside = await claims.findByConnections({
        organizationId,
        ids: [id],
        exceptProjectId: projectId,
      });

      expect(outside.map((each) => each.claimantId)).toEqual(["trigger-there"]);
    });

    it("lets a project release only its own claim", async () => {
      const { id } = await stored();
      await claim({ connectionId: id, claimantId: "trigger-there", project: otherProjectId });

      await claims.delete({ connectionId: id, claimantId: "trigger-there", projectId });

      await expect(claims.findByConnections({ organizationId, ids: [id] })).resolves.toHaveLength(
        1,
      );
    });
  });

  describe("given a claim that is released", () => {
    /** @scenario "Pausing or deleting an automation releases its connection" */
    it("drops the claim, and releasing it again is fine", async () => {
      const { id } = await stored();
      await claim({ connectionId: id, claimantId: "trigger-1" });

      await claims.delete({ connectionId: id, claimantId: "trigger-1", projectId });
      await expect(
        claims.delete({ connectionId: id, claimantId: "trigger-1", projectId }),
      ).resolves.toBeUndefined();

      await expect(claims.findByConnections({ organizationId, ids: [id] })).resolves.toEqual([]);
    });
  });

  describe("given claims in another organization", () => {
    it("never reads them", async () => {
      const mine = await stored();
      const theirs = await stored({ organization: otherOrganizationId });
      await claim({ connectionId: mine.id, claimantId: "trigger-mine" });
      await claim({
        connectionId: theirs.id,
        claimantId: "trigger-theirs",
        organization: otherOrganizationId,
      });

      const read = await claims.findByConnections({ organizationId, ids: [mine.id, theirs.id] });

      expect(read.map((each) => each.claimantId)).toEqual(["trigger-mine"]);
    });

    it("answers no claims for no connections without querying", async () => {
      await expect(claims.findByConnections({ organizationId, ids: [] })).resolves.toEqual([]);
    });
  });

  describe("given a claim on a connection that does not exist", () => {
    it("is refused by the foreign key", async () => {
      await expect(
        claim({ connectionId: `${namespace}-missing`, claimantId: "trigger-1" }),
      ).rejects.toThrow(/foreign key/i);
    });
  });
});
