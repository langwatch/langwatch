/**
 * @vitest-environment node
 * The connection and claim storage contract, stated once and run against the
 * memory twin and, when a test database is configured, the Postgres repositories.
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { afterAll, describe, expect, it } from "vitest";

import { MemorySlackConnectionClaimRepository } from "../memory/memory.slack-connection-claim.repository.ts";
import { MemorySlackConnectionRepository } from "../memory/memory.slack-connection.repository.ts";
import { PrismaSlackConnectionClaimRepository } from "../prisma/prisma.slack-connection-claim.repository.ts";
import { PrismaSlackConnectionRepository } from "../prisma/prisma.slack-connection.repository.ts";
import type { SlackConnectionClaimRepository } from "../slack-connection-claim.repository.ts";
import type {
  SlackConnectionRecord,
  SlackConnectionRepository,
} from "../slack-connection.repository.ts";

type Backend = {
  name: string;
  create: () => {
    connections: SlackConnectionRepository;
    claims: SlackConnectionClaimRepository;
    organizationId: string;
    projectId: string;
    otherProjectId: string;
    cleanup: () => Promise<void>;
  };
};

const hexEncryption = {
  encrypt: (value: string) => Buffer.from(value, "utf8").toString("hex"),
  decrypt: (value: string) => Buffer.from(value, "hex").toString("utf8"),
};

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const closers: (() => Promise<void>)[] = [];

const memory: Backend = {
  name: "memory",
  create: () => ({
    connections: MemorySlackConnectionRepository.create(),
    claims: MemorySlackConnectionClaimRepository.create(),
    organizationId: "org-contract",
    projectId: "project-contract",
    otherProjectId: "project-other",
    cleanup: () => Promise.resolve(),
  }),
};

const postgres: Backend = {
  name: "postgres",
  create: () => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required");
    const connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:slack:test:contract"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    closers.push(() => connection.closeOnce());
    const namespace = `test-slack-contract-${randomUUID()}`;
    const organizationId = `${namespace}-organization`;
    return {
      connections: PrismaSlackConnectionRepository.create({
        prisma: connection.client,
        encryption: hexEncryption,
      }),
      claims: PrismaSlackConnectionClaimRepository.create(connection.client),
      organizationId,
      projectId: `${namespace}-project`,
      otherProjectId: `${namespace}-other-project`,
      cleanup: async () => {
        await connection.client.slackConnectionClaim.deleteMany({ where: { organizationId } });
        await connection.client.slackIntegration.deleteMany({ where: { organizationId } });
      },
    };
  },
};

const backends: readonly Backend[] = databaseUrl ? [memory, postgres] : [memory];

afterAll(async () => {
  await Promise.all(closers.map((close) => close()));
});

describe.each(backends)("given the $name Slack connection repositories", ({ create }) => {
  const record = (
    world: { organizationId: string; projectId: string },
    overrides: Partial<SlackConnectionRecord> = {},
  ): SlackConnectionRecord => ({
    name: "Connection",
    kind: "INCOMING_WEBHOOK",
    scopeType: "PROJECT",
    scopeId: world.projectId,
    organizationId: world.organizationId,
    botToken: null,
    webhookUrl: "https://hooks.slack.test/services/T/B/token",
    secretFingerprint: `fp-${randomUUID()}`,
    secretHint: "abcd",
    slackTeamId: null,
    slackTeamName: null,
    ...overrides,
  });

  describe("when a connection is stored", () => {
    it("reads it back by id with its secret opened", async () => {
      const world = create();
      try {
        const [created] = await world.connections.create({
          record: record(world),
          actorId: "user-1",
        });
        if (!created) throw new Error("the connection was not stored");

        const [read] = await world.connections.findById({ id: created.id });

        expect(read).toMatchObject({
          id: created.id,
          name: "Connection",
          webhookUrl: "https://hooks.slack.test/services/T/B/token",
        });
      } finally {
        await world.cleanup();
      }
    });
  });

  describe("when a project asks which connections it may use", () => {
    it("lists its organization's and its own by name, not another project's", async () => {
      const world = create();
      try {
        await world.connections.create({
          record: record(world, {
            name: "B org",
            scopeType: "ORGANIZATION",
            scopeId: world.organizationId,
          }),
          actorId: "user-1",
        });
        await world.connections.create({
          record: record(world, { name: "A project" }),
          actorId: "user-1",
        });
        await world.connections.create({
          record: record(world, { name: "Other", scopeId: world.otherProjectId }),
          actorId: "user-1",
        });

        const listed = await world.connections.findAllUsableByProject({
          organizationId: world.organizationId,
          projectId: world.projectId,
        });

        expect(listed.map((row) => row.name)).toEqual(["A project", "B org"]);
      } finally {
        await world.cleanup();
      }
    });
  });

  describe("when a scope already holds a fingerprint", () => {
    it("answers empty to a second create instead of storing a copy", async () => {
      const world = create();
      try {
        await world.connections.create({
          record: record(world, { secretFingerprint: "same" }),
          actorId: "user-1",
        });

        const second = await world.connections.create({
          record: record(world, { secretFingerprint: "same", name: "Copy" }),
          actorId: "user-1",
        });

        expect(second).toEqual([]);
      } finally {
        await world.cleanup();
      }
    });

    it("answers empty to an edit that would collide, and changes nothing", async () => {
      const world = create();
      try {
        await world.connections.create({
          record: record(world, { secretFingerprint: "taken" }),
          actorId: "user-1",
        });
        const [other] = await world.connections.create({
          record: record(world, { name: "Other", secretFingerprint: "free" }),
          actorId: "user-1",
        });
        if (!other) throw new Error("the connection was not stored");

        const edited = await world.connections.update({
          id: other.id,
          organizationId: world.organizationId,
          changes: { secretFingerprint: "taken" },
          actorId: "user-1",
        });

        expect(edited).toEqual([]);
        const [read] = await world.connections.findById({ id: other.id });
        expect(read?.secretFingerprint).toBe("free");
      } finally {
        await world.cleanup();
      }
    });
  });

  describe("when a connection is edited and then deleted", () => {
    it("answers the edited row, then no row", async () => {
      const world = create();
      try {
        const [created] = await world.connections.create({
          record: record(world),
          actorId: "user-1",
        });
        if (!created) throw new Error("the connection was not stored");

        const [edited] = await world.connections.update({
          id: created.id,
          organizationId: world.organizationId,
          changes: { name: "Renamed" },
          actorId: "user-1",
        });
        await world.connections.delete({ id: created.id, organizationId: world.organizationId });

        expect(edited?.name).toBe("Renamed");
        await expect(world.connections.findById({ id: created.id })).resolves.toEqual([]);
      } finally {
        await world.cleanup();
      }
    });
  });

  describe("when automations claim a connection", () => {
    it("holds one claim per claimant, refreshing the label on a repeat", async () => {
      const world = create();
      try {
        const [created] = await world.connections.create({
          record: record(world),
          actorId: "user-1",
        });
        if (!created) throw new Error("the connection was not stored");
        const claim = {
          connectionId: created.id,
          claimantId: "automation-1",
          claimantLabel: "Old label",
          organizationId: world.organizationId,
          projectId: world.projectId,
        };

        await world.claims.upsert(claim);
        await world.claims.upsert({ ...claim, claimantLabel: "New label" });

        const held = await world.claims.findByConnections({
          organizationId: world.organizationId,
          ids: [created.id],
        });
        expect(held).toEqual([{ ...claim, claimantLabel: "New label" }]);
      } finally {
        await world.cleanup();
      }
    });

    it("leaves out the asking project's own claims when told to", async () => {
      const world = create();
      try {
        const [created] = await world.connections.create({
          record: record(world, {
            scopeType: "ORGANIZATION",
            scopeId: world.organizationId,
          }),
          actorId: "user-1",
        });
        if (!created) throw new Error("the connection was not stored");
        const base = {
          connectionId: created.id,
          claimantLabel: "Automation",
          organizationId: world.organizationId,
        };
        await world.claims.upsert({ ...base, claimantId: "mine", projectId: world.projectId });
        await world.claims.upsert({
          ...base,
          claimantId: "theirs",
          projectId: world.otherProjectId,
        });

        const others = await world.claims.findByConnections({
          organizationId: world.organizationId,
          ids: [created.id],
          exceptProjectId: world.projectId,
        });

        expect(others.map((claim) => claim.claimantId)).toEqual(["theirs"]);
      } finally {
        await world.cleanup();
      }
    });

    it("lets a claimant release only its own project's claim", async () => {
      const world = create();
      try {
        const [created] = await world.connections.create({
          record: record(world),
          actorId: "user-1",
        });
        if (!created) throw new Error("the connection was not stored");
        await world.claims.upsert({
          connectionId: created.id,
          claimantId: "automation-1",
          claimantLabel: "Automation",
          organizationId: world.organizationId,
          projectId: world.projectId,
        });

        await world.claims.delete({
          connectionId: created.id,
          claimantId: "automation-1",
          projectId: world.otherProjectId,
        });
        const stillHeld = await world.claims.findByConnections({
          organizationId: world.organizationId,
          ids: [created.id],
        });
        await world.claims.delete({
          connectionId: created.id,
          claimantId: "automation-1",
          projectId: world.projectId,
        });
        const released = await world.claims.findByConnections({
          organizationId: world.organizationId,
          ids: [created.id],
        });

        expect(stillHeld).toHaveLength(1);
        expect(released).toEqual([]);
      } finally {
        await world.cleanup();
      }
    });
  });
});
