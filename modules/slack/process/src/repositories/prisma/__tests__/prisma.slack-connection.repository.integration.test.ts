/**
 * Slack connection storage against Postgres under the real tenancy guard: an
 * org-scoped query outside the guard's regime throws, which a memory twin
 * cannot notice. Covers the per-scope unique index and the claim foreign key.
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

import type { SlackConnectionRecord } from "../../slack-connection.repository.ts";
import { PrismaSlackConnectionClaimRepository } from "../prisma.slack-connection-claim.repository.ts";
import { PrismaSlackConnectionRepository } from "../prisma.slack-connection.repository.ts";

/** Hex, not a cipher: a stored column that spells out the plaintext fails the test. */
const hexEncryption = {
  encrypt: (value: string) => Buffer.from(value, "utf8").toString("hex"),
  decrypt: (value: string) => Buffer.from(value, "hex").toString("utf8"),
};

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-slack-connections-${randomUUID()}`;
const organizationId = `${namespace}-organization`;
const otherOrganizationId = `${namespace}-other-organization`;
const projectId = `${namespace}-project`;
const otherProjectId = `${namespace}-other-project`;

function record(overrides: Partial<SlackConnectionRecord> = {}): SlackConnectionRecord {
  return {
    name: "Connection",
    kind: "INCOMING_WEBHOOK",
    scopeType: "PROJECT",
    scopeId: projectId,
    organizationId,
    botToken: null,
    webhookUrl: "https://hooks.slack.test/services/T/B/token",
    secretFingerprint: `fp-${randomUUID()}`,
    secretHint: "abcd",
    slackTeamId: null,
    slackTeamName: null,
    ...overrides,
  };
}

describe.skipIf(!databaseUrl)("PrismaSlackConnectionRepository", () => {
  let connection: PrismaConnection;
  let connections: PrismaSlackConnectionRepository;
  let claims: PrismaSlackConnectionClaimRepository;

  const clear = async () => {
    for (const each of [organizationId, otherOrganizationId]) {
      await connection.client.slackConnectionClaim.deleteMany({ where: { organizationId: each } });
      await connection.client.slackIntegration.deleteMany({ where: { organizationId: each } });
    }
  };

  beforeAll(() => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:slack:test:connections"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    connections = PrismaSlackConnectionRepository.create({
      prisma: connection.client,
      encryption: hexEncryption,
    });
    claims = PrismaSlackConnectionClaimRepository.create(connection.client);
  });

  beforeEach(clear);

  afterAll(async () => {
    if (!connection) return;
    await clear();
    await connection.closeOnce();
  });

  describe("given organization, project and other-project connections", () => {
    /** @scenario "A project lists its own connections and its organization's" */
    it("lists the organization's and the project's own by name, not the other project's", async () => {
      await connections.create({
        record: record({ name: "B org", scopeType: "ORGANIZATION", scopeId: organizationId }),
        actorId: "user-1",
      });
      await connections.create({ record: record({ name: "A project" }), actorId: "user-1" });
      await connections.create({
        record: record({ name: "Other", scopeId: otherProjectId }),
        actorId: "user-1",
      });

      const listed = await connections.findAllUsableByProject({ organizationId, projectId });

      expect(listed.map((row) => row.name)).toEqual(["A project", "B org"]);
    });
  });

  describe("given a connection stored with its secret", () => {
    it("seals the secret at rest and opens it on read", async () => {
      const [created] = await connections.create({ record: record(), actorId: "user-1" });
      if (!created) throw new Error("the connection was not stored");

      const column = await connection.client.slackIntegration.findUniqueOrThrow({
        where: { id: created.id },
        select: { webhookUrlEncrypted: true },
      });
      const [read] = await connections.findById({ id: created.id });

      expect(column.webhookUrlEncrypted).toBe(
        hexEncryption.encrypt("https://hooks.slack.test/services/T/B/token"),
      );
      expect(read?.webhookUrl).toBe("https://hooks.slack.test/services/T/B/token");
    });
  });

  describe("given a fingerprint the scope already holds", () => {
    it("create answers empty instead of storing a second copy", async () => {
      await connections.create({
        record: record({ secretFingerprint: "same" }),
        actorId: "user-1",
      });

      const second = await connections.create({
        record: record({ secretFingerprint: "same", name: "Copy" }),
        actorId: "user-1",
      });

      expect(second).toEqual([]);
      const held = await connections.findAllByFingerprint({
        organizationId,
        secretFingerprint: "same",
        scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
      });
      expect(held.map((row) => row.name)).toEqual(["Connection"]);
    });

    it("update answers empty when the new fingerprint collides in the scope", async () => {
      await connections.create({
        record: record({ secretFingerprint: "taken" }),
        actorId: "user-1",
      });
      const [other] = await connections.create({ record: record(), actorId: "user-1" });
      if (!other) throw new Error("the second connection was not stored");

      await expect(
        connections.update({
          id: other.id,
          organizationId,
          changes: { secretFingerprint: "taken" },
          actorId: "user-1",
        }),
      ).resolves.toEqual([]);
    });
  });

  describe("given one fingerprint held in several scopes and organizations", () => {
    it("stores one copy per scope and reads only the scopes asked for", async () => {
      const scopes = [
        { scopeType: "ORGANIZATION", scopeId: organizationId },
        { scopeType: "PROJECT", scopeId: projectId },
        { scopeType: "PROJECT", scopeId: otherProjectId },
      ] as const;
      for (const scope of scopes) {
        const stored = await connections.create({
          record: record({ ...scope, secretFingerprint: "shared" }),
          actorId: "user-1",
        });
        expect(stored).toHaveLength(1);
      }
      const elsewhere = await connections.create({
        record: record({
          organizationId: otherOrganizationId,
          scopeType: "ORGANIZATION",
          scopeId: otherOrganizationId,
          secretFingerprint: "shared",
        }),
        actorId: "user-1",
      });
      expect(elsewhere).toHaveLength(1);

      const reachable = await connections.findAllByFingerprint({
        organizationId,
        secretFingerprint: "shared",
        scopes: scopes.slice(0, 2),
      });

      expect(reachable.map((row) => row.scopeId).toSorted()).toEqual(
        [organizationId, projectId].toSorted(),
      );
    });
  });

  describe("given a stored connection", () => {
    it("mints a slack KSUID for it", async () => {
      const [row] = await connections.create({ record: record(), actorId: "user-1" });

      expect(row?.id.startsWith("slackintegration")).toBe(true);
    });

    it("updates and deletes only within its organization", async () => {
      const [row] = await connections.create({ record: record(), actorId: "user-1" });
      if (!row) throw new Error("the connection was not stored");

      await connections.update({
        id: row.id,
        organizationId,
        changes: { name: "Renamed" },
        actorId: "user-2",
      });
      await connections.delete({ id: row.id, organizationId: otherOrganizationId });

      const kept = await connections.findById({ id: row.id });
      expect(kept.map((each) => each.name)).toEqual(["Renamed"]);

      await connections.delete({ id: row.id, organizationId });
      await expect(connections.findById({ id: row.id })).resolves.toEqual([]);
    });
  });

  describe("given a connection an automation claims", () => {
    it("the foreign key refuses a delete that skipped the service's claim check", async () => {
      const [row] = await connections.create({ record: record(), actorId: "user-1" });
      if (!row) throw new Error("the connection was not stored");
      await claims.upsert({
        connectionId: row.id,
        claimantId: "trigger-1",
        claimantLabel: "Errors to ops",
        organizationId,
        projectId,
      });

      await expect(connections.delete({ id: row.id, organizationId })).rejects.toMatchObject({
        code: "P2014",
      });
      await expect(connections.findById({ id: row.id })).resolves.toHaveLength(1);

      await claims.delete({ connectionId: row.id, claimantId: "trigger-1", projectId });
      await connections.delete({ id: row.id, organizationId });
      await expect(connections.findById({ id: row.id })).resolves.toEqual([]);
    });
  });
});
